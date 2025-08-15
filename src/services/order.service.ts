// src/services/order.service.ts
import { prisma } from "../config/db";
import { Prisma } from "@prisma/client";
import { CreateOrderInput, UpdateOrderUnifiedInput } from "../types/ordert";
import { calcOrderMoney, toDec, toNum2 } from "../tools/order";

/** ========= 统一更新服务 =========
 * - 单事务
 * - 乐观锁（expectedUpdatedAt）
 * - 维护 paidAt（paid 设置/取消）
 * - items 整单替换（upsert + 删除缺席项）
 * - 返回金额汇总
 */
export async function updateOrderUnifiedService(
  orderId: number,
  input: UpdateOrderUnifiedInput
) {
  return prisma.$transaction(async (tx) => {
    // 1) 存在性 + 乐观锁
    const current = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, updatedAt: true, paidAt: true },
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

    // 2) 组装订单字段
    const data: Prisma.OrderUpdateInput = {};

    // 基本
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

    // 状态（方案二）
    if (input.orderStatus) (data as any).status = input.orderStatus;

    // 支付（独立，维护 paidAt）
    if (input.paymentStatus) {
      (data as any).paymentStatus = input.paymentStatus;
      if (input.paymentStatus === "paid") {
        (data as any).paidAt = new Date();
      } else {
        (data as any).paidAt = null;
      }
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

    // 3) items：整单替换
    if (Array.isArray(input.items)) {
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

      // upsert 每项
      for (const [productId, val] of merged.entries()) {
        await tx.orderItem.upsert({
          where: { orderId_productId: { orderId, productId } }, // 依赖 @@unique([orderId, productId])
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

    // 4) 返回最新 + 金额
    const fresh = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        user: true,
        customer: true,
        items: { include: { product: true } },
      },
    });
    if (!fresh) return null;

    // 价格 number 化（getAll/getById 保持一致）
    const items = fresh.items.map((it) => {
      const priceDec = toDec(it?.product?.price);
      return {
        ...it,
        product: { ...it.product, price: Number(priceDec.toFixed(2)) },
      };
    });

    const { money } = calcOrderMoney({ ...fresh, items });
    return { ...fresh, items, ...money };
  });
}
/** ========== 其余保留：创建/查询/删除（原样） ========== */

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
    // 或者：price: toNum2(priceDec)
  });

  return { ...order, items };
};

export const deleteOrder = async (orderId: number) => {
  return await prisma.$transaction([
    prisma.orderItem.deleteMany({ where: { orderId } }),
    prisma.order.delete({ where: { id: orderId } }),
  ]);
};
