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
      userId: userId ?? undefined,
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

// ✅ 新增：查询单个订单，顺带把每个 item.product.price 转成 number
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
        price: Number(priceDec.toFixed(2)), // 前端好做计算
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
  // 先取当前支付状态与 paidAt，便于维护 paidAt
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

  // 订单状态
  if (input.orderStatus) {
    data.status = input.orderStatus; // 列名就是 status
  }

  // 支付状态 + paidAt 自动维护
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
