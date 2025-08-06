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
  return prisma.order.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      items: {
        include: {
          product: true, // 拿到产品信息
        },
      },
    },
  });
};