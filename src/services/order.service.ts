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

  const ordersWithTotals = orders.map((order) => {
    const totalDec = order.items.reduce((sum, item) => {
      const price = (item.product?.price ??
        new Prisma.Decimal(0)) as Prisma.Decimal;
      return sum.add(price.mul(item.quantity));
    }, new Prisma.Decimal(0));

    const gstDec = totalDec.mul(0.1);
    const totalWithGSTDec = totalDec.add(gstDec);

    return {
      ...order,
      total: Number(totalDec.toFixed(2)),
      gst: Number(gstDec.toFixed(2)),
      totalWithGST: Number(totalWithGSTDec.toFixed(2)),
    };
  });

  return ordersWithTotals;
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
