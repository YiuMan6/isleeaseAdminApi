// src/services/order.service.ts
import { prisma } from '../config/db';

interface OrderItemInput {
  productId: number;
  quantity: number;
}

interface CreateOrderInput {
  userId?: number; // 可选
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: string;
  position: string;
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
    items
  } = data;

  return prisma.order.create({
    data: {
      userId: userId ?? undefined, // 可选关联
      customerName,
      customerEmail,
      customerPhone,
      shippingAddress,
      position,
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