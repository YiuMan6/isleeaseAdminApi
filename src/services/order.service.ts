import { prisma } from "../config/db";
import { Prisma } from "@prisma/client";

interface OrderItemInput {
  productId: number;
  quantity: number;
}

interface CreateOrderInput {
  userId?: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: string;
  position: string;
  note?: string;
  barcodeAll: boolean;
  packageType: "boxes" | "opp";
  items: OrderItemInput[];
}

type UpdateShippingInput = {
  shippingCartons?: number | null;
  shippingCost?: number | null;
  shippingGstIncl?: boolean | null;
  shippingNote?: string | null;
};

// Decimal 保留 2 位再转 number
const toNum2 = (d: Prisma.Decimal | number) =>
  Number(new Prisma.Decimal(d).toFixed(2));

function calcOrderMoney(order: any) {
  // 产品小计（未税）
  const productSubtotalDec = order.items.reduce(
    (sum: Prisma.Decimal, it: any) => {
      const price = (it.product?.price ??
        new Prisma.Decimal(0)) as Prisma.Decimal;
      return sum.add(price.mul(it.quantity));
    },
    new Prisma.Decimal(0)
  );

  // 运费
  const shippingCostDec =
    (order.shippingCost as Prisma.Decimal | null) ?? new Prisma.Decimal(0);
  const shippingGstIncl = order.shippingGstIncl ?? true;

  const shippingExGstDec = shippingGstIncl
    ? shippingCostDec.div(1.1)
    : shippingCostDec;

  const gstOnProductsDec = productSubtotalDec.mul(0.1);
  const gstOnShippingDec = shippingExGstDec.mul(0.1);

  const subtotalExGstDec = productSubtotalDec.add(shippingExGstDec);
  const gstTotalDec = gstOnProductsDec.add(gstOnShippingDec);
  const grandTotalDec = subtotalExGstDec.add(gstTotalDec);

  return {
    money: {
      productSubtotal: toNum2(productSubtotalDec),
      shippingExGst: toNum2(shippingExGstDec),
      gstOnProducts: toNum2(gstOnProductsDec),
      gstOnShipping: toNum2(gstOnShippingDec),
      subtotalExGst: toNum2(subtotalExGstDec),
      gstTotal: toNum2(gstTotalDec),
      totalWithGST: toNum2(grandTotalDec),
    },
  };
}

export async function updateOrderShippingService(
  orderId: number,
  input: UpdateShippingInput
) {
  // 组装 update 数据；只改传入的字段
  const data: Prisma.OrderUpdateInput = {};

  if (input.shippingCartons !== undefined) {
    const cartons =
      input.shippingCartons === null
        ? 0
        : Math.max(0, Math.trunc(Number(input.shippingCartons) || 0));
    (data as any).shippingCartons = cartons;
  }

  if (input.shippingCost !== undefined) {
    // Decimal 字段：null 表示清空；数值转字符串
    (data as any).shippingCost =
      input.shippingCost === null ? null : String(Number(input.shippingCost));
  }

  if (input.shippingGstIncl !== undefined) {
    (data as any).shippingGstIncl =
      input.shippingGstIncl === null ? true : !!input.shippingGstIncl;
  }

  if (input.shippingNote !== undefined) {
    (data as any).shippingNote = input.shippingNote; // 允许 null 置空
  }

  const updated = await prisma.order.update({
    where: { id: orderId },
    data,
    include: {
      user: true,
      customer: true,
      items: { include: { product: true } },
    },
  });

  // 返回时带金额汇总（含运费）
  const { money } = calcOrderMoney(updated);
  return { ...updated, ...money };
}

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
    include: {
      items: { include: { product: true } },
    },
  });

  return orders.map((order) => {
    // 1) 价格数字化（方便前端展示）
    const items = order.items.map((it) => {
      const priceDec = (it.product?.price ??
        new Prisma.Decimal(0)) as Prisma.Decimal;
      return {
        ...it,
        product: {
          ...it.product,
          price: toNum2(priceDec),
        },
      };
    });

    // 2) 金额汇总（含运费拆税）
    const { money } = calcOrderMoney(order);

    return {
      ...order,
      items,
      ...money, // -> productSubtotal, shippingExGst, gstOnProducts, gstOnShipping, subtotalExGst, gstTotal, totalWithGST
    };
  });
};

// 单个订单（前面已给，如果已有就保留）
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
    const priceDec = (it.product?.price ??
      new Prisma.Decimal(0)) as Prisma.Decimal;
    return {
      ...it,
      product: {
        ...it.product,
        price: Number(priceDec.toFixed(2)),
      },
    };
  });

  return { ...order, items };
};

export const deleteOrder = async (orderId: number) => {
  return await prisma.$transaction([
    prisma.orderItem.deleteMany({ where: { orderId } }),
    prisma.order.delete({ where: { id: orderId } }),
  ]);
};

// ========== 修改订单/支付状态 ==========
type UpdateStatusInput = {
  paymentStatus?: "unpaid" | "paid" | "refunded";
  orderStatus?:
    | "pending"
    | "confirmed"
    | "paid"
    | "packed"
    | "shipped"
    | "completed"
    | "cancelled";
  note?: string;
  actorId?: number;
};

export async function updateOrderStatusService(
  orderId: number,
  input: UpdateStatusInput
) {
  const current = await prisma.order.findUnique({
    where: { id: orderId },
    select: { paymentStatus: true, paidAt: true },
  });
  if (!current) {
    const err: any = new Error("Order not found");
    err.code = "P2025";
    throw err;
  }

  const data: any = {};

  if (input.orderStatus) {
    data.status = input.orderStatus;
  }

  if (input.paymentStatus) {
    data.paymentStatus = input.paymentStatus;

    if (input.paymentStatus === "paid" && !current.paidAt) {
      data.paidAt = new Date();
    } else if (input.paymentStatus !== "paid" && current.paidAt) {
      data.paidAt = null;
    }
  }

  const updated = await prisma.order.update({
    where: { id: orderId },
    data,
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      paidAt: true,
      updatedAt: true,
    },
  });

  return updated;
}

/** ========== 新增：编辑快照（地址/客户信息/items 等） ==========
 * 传 items 则“替换整单 items”；不传 items 则不动
 * 支持乐观锁：expectedUpdatedAt（ISO）
 */
type UpdateSnapshotInput = {
  expectedUpdatedAt?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  shippingAddress?: string;
  position?: string;
  note?: string | null;
  barcodeAll?: boolean;
  packageType?: "boxes" | "opp";
  items?: Array<{ productId: number; quantity: number }>;
};

export async function updateOrderSnapshotService(
  orderId: number,
  input: UpdateSnapshotInput
) {
  return await prisma.$transaction(async (tx) => {
    const current = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, updatedAt: true },
    });
    if (!current) {
      const err: any = new Error("Order not found");
      err.code = "P2025";
      throw err;
    }

    // 乐观锁
    if (input.expectedUpdatedAt) {
      const expected = new Date(input.expectedUpdatedAt);
      if (current.updatedAt.getTime() !== expected.getTime()) {
        throw new Error("ORDER_VERSION_CONFLICT");
      }
    }

    // 基本字段
    const baseData: Prisma.OrderUpdateInput = {};
    if (typeof input.customerName === "string")
      baseData.customerName = input.customerName;
    if (typeof input.customerEmail === "string")
      baseData.customerEmail = input.customerEmail;
    if (typeof input.customerPhone === "string")
      baseData.customerPhone = input.customerPhone;
    if (typeof input.shippingAddress === "string")
      baseData.shippingAddress = input.shippingAddress;
    if (typeof input.position === "string") baseData.position = input.position;
    if (typeof input.note !== "undefined") baseData.note = input.note;
    if (typeof input.barcodeAll === "boolean")
      (baseData as any).barcodeAll = input.barcodeAll;
    if (typeof input.packageType === "string")
      (baseData as any).packageType = input.packageType;

    await tx.order.update({
      where: { id: orderId },
      data: baseData,
    });

    // items：若传则替换整单
    if (Array.isArray(input.items)) {
      // 合并重复 productId
      const merged = new Map<number, number>();
      for (const it of input.items) {
        merged.set(it.productId, (merged.get(it.productId) || 0) + it.quantity);
      }
      const productIds = Array.from(merged.keys());

      // 删掉不存在的项
      await tx.orderItem.deleteMany({
        where: { orderId, productId: { notIn: productIds } },
      });

      // upsert 每一项
      for (const [productId, quantity] of merged) {
        await tx.orderItem.upsert({
          where: { orderId_productId: { orderId, productId } }, // 依赖 @@unique([orderId, productId])
          update: { quantity },
          create: { orderId, productId, quantity },
        });
      }
    }

    // 返回最新订单（带价格 number 化）
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        user: true,
        customer: true,
        items: { include: { product: true } },
      },
    });

    if (!order) return null;

    const items = order.items.map((it) => {
      const priceDec = (it.product?.price ??
        new Prisma.Decimal(0)) as Prisma.Decimal;
      return {
        ...it,
        product: {
          ...it.product,
          price: Number(priceDec.toFixed(2)),
        },
      };
    });

    return { ...order, items };
  });
}
