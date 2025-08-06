// src/services/order.service.ts
import { prisma } from '../config/db';

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
  note?:string;
  barcodeAll: boolean;         // ✅ 新增
  packageType: "boxes" | "opp"; // ✅ 新增
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
    items
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
    barcodeAll,     // ✅ 新增
    packageType,    // ✅ 新增
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
      include: {
        product: true,
      },
    },
  },
});
};

export const getAllOrdersService = async () => {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      items: {
        include: {
          product: true, // 获取产品信息（含价格）
        },
      },
    },
  });

  // 为每个订单计算总价、GST、含税总价
  const ordersWithTotals = orders.map((order) => {
    const total = order.items.reduce((sum, item) => {
      const price = item.product?.price ?? 0;
      return sum + price * item.quantity;
    }, 0);

    const gst = total * 0.1;
    const totalWithGST = total + gst;

    return {
      ...order,
      total,
      gst,
      totalWithGST,
    };
  });

  return ordersWithTotals;
};
