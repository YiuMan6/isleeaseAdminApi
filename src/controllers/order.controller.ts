import { Request, Response } from "express";
import { z } from "zod";
import {
  createOrderService,
  getAllOrdersService,
  getOrderByIdService, // 👈 新增
  deleteOrder,
  updateOrderStatusService,
} from "../services/order.service";

// —— 按你的 schema（小写枚举）——
export const PaymentStatus = ["unpaid", "paid", "refunded"] as const;
export const OrderStatus = [
  "pending",
  "confirmed",
  "paid",
  "packed",
  "shipped",
  "completed",
  "cancelled",
] as const;

const PatchBodySchema = z
  .object({
    paymentStatus: z.enum(PaymentStatus).optional(),
    orderStatus: z.enum(OrderStatus).optional(),
    note: z.string().max(200).optional(),
  })
  .refine((d) => d.paymentStatus || d.orderStatus, {
    message: "Nothing to update",
  });

export const createOrder = async (req: Request, res: Response) => {
  try {
    const order = await createOrderService(req.body);
    res.status(201).json({ message: "Order created successfully", order });
  } catch (error: any) {
    console.error("Create order error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getAllOrders = async (_req: Request, res: Response) => {
  try {
    const orders = await getAllOrdersService();
    res.json({ success: true, data: orders });
  } catch (error) {
    console.error("Get all orders error:", error);
    res.status(500).json({ success: false, message: "Failed to get orders" });
  }
};

// ✅ 新增：GET /orders/:id
export const getOrderById = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid order id" });

  try {
    const order = await getOrderByIdService(id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json({ success: true, data: order });
  } catch (error) {
    console.error("Get order by id error:", error);
    res.status(500).json({ message: "Failed to get order" });
  }
};

export const deleteOrderHandler = async (req: Request, res: Response) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (Number.isNaN(orderId)) {
      return res.status(400).json({ error: "Invalid order ID" });
    }
    await deleteOrder(orderId);
    res.status(204).send();
  } catch (error) {
    console.error("Delete order failed:", error);
    res.status(500).json({ error: "Failed to delete order" });
  }
};

// PATCH /orders/:id/status —— 修改支付状态/订单状态
export const patchOrderStatus = async (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  if (!orderId) return res.status(400).json({ message: "Invalid order id" });

  const parsed = PatchBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid body", issues: parsed.error.flatten() });
  }

  try {
    const actorId = (req as any).user?.id as number | undefined; // 若用了 requireAuth
    const updated = await updateOrderStatusService(orderId, {
      paymentStatus: parsed.data.paymentStatus,
      orderStatus: parsed.data.orderStatus,
      note: parsed.data.note,
      actorId,
    });
    res.json({ success: true, data: updated });
  } catch (e: any) {
    if (e?.code === "P2025") {
      return res.status(404).json({ message: "Order not found" });
    }
    console.error("Patch order status error:", e);
    res.status(400).json({ message: e?.message || "Failed to update order" });
  }
};
