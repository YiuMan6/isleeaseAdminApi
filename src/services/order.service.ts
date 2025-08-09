// src/services/order.service.ts
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
  barcodeAll: boolean; // ✅ 新增
  packageType: "boxes" | "opp"; // ✅ 新增（与 enum PackageType 一致）
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
      items: {
        include: { product: true },
      },
    },
  });
};

export const getAllOrdersService = async () => {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        include: {
          product: true, // 含 price(Decimal)
        },
      },
    },
  });

  // 计算每个订单：total/gst/totalWithGST（用 Decimal，返回 number）
  const ordersWithTotals = orders.map((order) => {
    const totalDec = order.items.reduce((sum, item) => {
      // item.product!.price 是 Prisma.Decimal
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

export const deleteOrder = async (orderId: number) => {
  return await prisma.$transaction([
    prisma.orderItem.deleteMany({ where: { orderId } }),
    prisma.order.delete({ where: { id: orderId } }),
  ]);
};
