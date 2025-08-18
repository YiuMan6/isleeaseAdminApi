// src/services/order.service.ts
import { prisma } from "../config/db";
import {
  Prisma,
  OrderStatus,
  PaymentStatus,
  StockMoveType,
} from "@prisma/client";
import { CreateOrderInput, UpdateOrderUnifiedInput } from "../types/ordert";
import { calcOrderMoney, toDec, toNum2 } from "../tools/order";

/** 辅助：把行项数组聚合成 { productId -> { qty, back } } */
function foldItems(
  items: Array<{ productId: number; quantity: number; backorder?: number }>
) {
  const m = new Map<number, { qty: number; back: number }>();
  for (const it of items) {
    const prev = m.get(it.productId) ?? { qty: 0, back: 0 };
    m.set(it.productId, {
      qty: prev.qty + (it.quantity ?? 0),
      back: prev.back + (it.backorder ?? 0),
    });
  }
  return m;
}

/** ========= 统一更新服务（含库存流转） =========
 *  - 单事务 & 乐观锁
 *  - 付款：paidAt 维护
 *  - items：整单替换（upsert + 删除缺席项）
 *  - 库存流转规则：
 *      paid:   记录 ALLOCATE（审计），不改 onHand
 *      unpaid/refunded/cancelled（从 paid 来）：记录 DEALLOCATE（审计），不改 onHand
 *      shipped: 按 (quantity - backorder) 记录 SHIP，并减少 Product.stockOnHand
 *      completed: 不改库存（货已在 shipped 扣过）
 *  - 返回金额汇总
 */
export async function updateOrderUnifiedService(
  orderId: number,
  input: UpdateOrderUnifiedInput
) {
  return prisma.$transaction(async (tx) => {
    // 1) 取当前订单（带关键字段 + 行项），做存在性/乐观锁校验
    const current = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          select: { productId: true, quantity: true, backorder: true },
        },
      },
    });

    if (!current) {
      const err: any = new Error("Order not found");
      err.code = "P2025";
      throw err;
    }
    if (input.expectedUpdatedAt) {
      const expected = new Date(input.expectedUpdatedAt);
      if (current.updatedAt.getTime() !== expected.getTime()) {
        const err: any = new Error("ORDER_VERSION_CONFLICT");
        err.status = 409;
        throw err;
      }
    }

    const prevStatus: OrderStatus = current.status as OrderStatus;
    const prevPay: PaymentStatus = current.paymentStatus as PaymentStatus;

    // 2) 组装订单更新字段
    const data: Prisma.OrderUpdateInput = {};

    // 基本信息
    if (typeof input.customerName === "string")
      data.customerName = input.customerName;
    if (typeof input.customerEmail === "string")
      data.customerEmail = input.customerEmail;
    if (typeof input.customerPhone === "string")
      data.customerPhone = input.customerPhone;
    if (typeof input.shippingAddress === "string")
      data.shippingAddress = input.shippingAddress;
    if (typeof input.position === "string") data.position = input.position;
    if (typeof input.note !== "undefined") data.note = input.note;
    if (typeof input.barcodeAll === "boolean")
      (data as any).barcodeAll = input.barcodeAll;
    if (typeof input.packageType === "string")
      (data as any).packageType = input.packageType;

    // 状态
    const nextStatus: OrderStatus =
      (input.orderStatus as OrderStatus) ?? prevStatus;
    if (input.orderStatus) (data as any).status = input.orderStatus;

    // 支付（维护 paidAt）
    const nextPay: PaymentStatus =
      (input.paymentStatus as PaymentStatus) ?? prevPay;
    if (input.paymentStatus) {
      (data as any).paymentStatus = input.paymentStatus;
      (data as any).paidAt = input.paymentStatus === "paid" ? new Date() : null;
    }

    // 运费
    if (input.shippingCartons !== undefined) {
      const cartons =
        input.shippingCartons === null
          ? 0
          : Math.max(0, Math.trunc(Number(input.shippingCartons) || 0));
      (data as any).shippingCartons = cartons;
    }
    if (input.shippingCost !== undefined) {
      (data as any).shippingCost =
        input.shippingCost === null ? null : String(Number(input.shippingCost));
    }
    if (input.shippingGstIncl !== undefined) {
      (data as any).shippingGstIncl =
        input.shippingGstIncl === null ? true : !!input.shippingGstIncl;
    }
    if (input.shippingNote !== undefined) {
      (data as any).shippingNote = input.shippingNote;
    }

    // 先更新订单头
    await tx.order.update({ where: { id: orderId }, data });

    // 3) items 整单替换（upsert + 删除缺席）
    if (Array.isArray(input.items)) {
      // 校验 & 合并
      const merged = new Map<
        number,
        { quantity: number; backorder?: number }
      >();
      for (const it of input.items) {
        if (it.quantity < 0)
          throw new Error(`quantity must be >= 0 for product ${it.productId}`);
        if (it.backorder !== undefined && it.backorder < 0)
          throw new Error(`backorder must be >= 0 for product ${it.productId}`);

        const prev = merged.get(it.productId) || { quantity: 0, backorder: 0 };
        merged.set(it.productId, {
          quantity: prev.quantity + it.quantity,
          backorder:
            it.backorder !== undefined
              ? (prev.backorder || 0) + it.backorder
              : prev.backorder,
        });
      }

      const productIds = Array.from(merged.keys());

      // 删除缺席项
      await tx.orderItem.deleteMany({
        where: { orderId, productId: { notIn: productIds } },
      });

      // upsert
      for (const [productId, val] of merged.entries()) {
        await tx.orderItem.upsert({
          where: { orderId_productId: { orderId, productId } },
          update: {
            quantity: val.quantity,
            ...(typeof val.backorder === "number"
              ? { backorder: val.backorder }
              : {}),
          },
          create: {
            orderId,
            productId,
            quantity: val.quantity,
            ...(typeof val.backorder === "number"
              ? { backorder: val.backorder }
              : {}),
          },
        });
      }
    }

    // 4) 取“最新行项”用于库存动作计算
    const fresh = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: { select: { productId: true, quantity: true, backorder: true } },
        user: true,
        customer: true,
      },
    });
    if (!fresh) return null;

    const nowItems = fresh.items.map((it) => ({
      productId: it.productId,
      quantity: it.quantity,
      backorder: it.backorder || 0,
    }));

    const foldedNow = foldItems(nowItems); // productId -> { qty, back }

    // 5) 库存动作（只根据“状态/支付”的前后变化执行一次性动作）
    const becamePaid = prevPay !== "paid" && nextPay === "paid";
    const becameUnpaidOrRefunded =
      prevPay === "paid" && (nextPay === "unpaid" || nextPay === "refunded");

    const becameCancelled =
      prevStatus !== "cancelled" && nextStatus === "cancelled";
    const becameShipped = prevStatus !== "shipped" && nextStatus === "shipped";
    // completed：不做任何库存动作（货已在 shipped 扣过）

    // 5.1 付款 -> 锁定（审计记录，不改 onHand）
    if (becamePaid) {
      const toAlloc: Array<Prisma.StockMovementCreateManyInput> = [];
      for (const [pid, v] of foldedNow.entries()) {
        // 你的口径：只要 paid，就按下单量全部锁定；backorder 不影响 allocated 的定义
        const qty = v.qty;
        if (qty > 0) {
          toAlloc.push({
            productId: pid,
            orderId: orderId,
            type: "ALLOCATE",
            qty, // 审计记录用，正数
            reason: "Order paid → allocate",
            createdAt: new Date(),
          } as Prisma.StockMovementCreateManyInput);
        }
      }
      if (toAlloc.length) await tx.stockMovement.createMany({ data: toAlloc });
    }

    // 5.2 从 paid → unpaid/refunded 或 订单取消（释放锁定；不改 onHand）
    if (becameUnpaidOrRefunded || becameCancelled) {
      const toDealloc: Array<Prisma.StockMovementCreateManyInput> = [];
      for (const [pid, v] of foldedNow.entries()) {
        const qty = v.qty;
        if (qty > 0) {
          toDealloc.push({
            productId: pid,
            orderId: orderId,
            type: "DEALLOCATE",
            qty: -qty, // 释放占用，负数
            reason: becameCancelled
              ? "Order cancelled → deallocate"
              : "Payment reversed → deallocate",
            createdAt: new Date(),
          } as Prisma.StockMovementCreateManyInput);
        }
      }
      if (toDealloc.length)
        await tx.stockMovement.createMany({ data: toDealloc });
    }

    // 5.3 发货 -> 扣实物库存（onHand）并记录流水
    if (becameShipped) {
      const shipMovs: Array<Prisma.StockMovementCreateManyInput> = [];
      for (const [pid, v] of foldedNow.entries()) {
        const shipQty = Math.max(0, v.qty - v.back); // 只发得出的部分
        if (shipQty > 0) {
          // 减 product.stockOnHand
          await tx.product.update({
            where: { id: pid },
            data: { stockOnHand: { decrement: shipQty } },
          });

          // 记流水（负数 = 出库）
          shipMovs.push({
            productId: pid,
            orderId: orderId,
            type: "SHIP",
            qty: -shipQty,
            reason: "Order shipped → deduct onHand",
            createdAt: new Date(),
          } as Prisma.StockMovementCreateManyInput);
        }
      }
      if (shipMovs.length)
        await tx.stockMovement.createMany({ data: shipMovs });
    }

    // 6) 价格 number 化 + 金额汇总并返回
    const final = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        user: true,
        customer: true,
        items: { include: { product: true } },
      },
    });
    if (!final) return null;

    const items = final.items.map((it) => {
      const priceDec = toDec(it?.product?.price);
      return {
        ...it,
        product: { ...it.product, price: Number(priceDec.toFixed(2)) },
      };
    });

    const { money } = calcOrderMoney({ ...final, items });
    return { ...final, items, ...money };
  });
}

/** ========== 其余：创建/查询/删除（原样） ========== */

export const createOrderService = async (data: CreateOrderInput) => {
  const {
    userId,
    customerName,
    customerEmail,
    customerPhone,
    shippingAddress,
    position,
    note,
    barcodeAll,
    packageType,
    items,
  } = data;

  return prisma.order.create({
    data: {
      userId: userId ?? null,
      customerName,
      customerEmail,
      customerPhone,
      shippingAddress,
      position,
      note,
      barcodeAll,
      packageType,
      items: {
        create: items.map((item) => ({
          product: { connect: { id: item.productId } },
          quantity: item.quantity,
        })),
      },
    },
    include: {
      user: true,
      items: { include: { product: true } },
    },
  });
};

export const getAllOrdersService = async () => {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    include: { items: { include: { product: true } } },
  });

  return orders.map((order) => {
    const items = order.items.map((it) => {
      const priceDec = toDec(it?.product?.price);
      return { ...it, product: { ...it.product, price: toNum2(priceDec) } };
    });
    const { money } = calcOrderMoney({ ...order, items });
    return { ...order, items, ...money };
  });
};

export const getOrderByIdService = async (id: number) => {
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      user: true,
      customer: true,
      items: { include: { product: true } },
    },
  });
  if (!order) return null;

  const items = order.items.map((it) => {
    const priceDec = toDec(it?.product?.price);
    return {
      ...it,
      product: { ...it.product, price: Number(priceDec.toFixed(2)) },
    };
  });

  return { ...order, items };
};

export const deleteOrder = async (orderId: number) => {
  // 简化：直接删。若需要“删除前释放锁定/回滚发货”，可按需要补充。
  return await prisma.$transaction([
    prisma.orderItem.deleteMany({ where: { orderId } }),
    prisma.order.delete({ where: { id: orderId } }),
  ]);
};
