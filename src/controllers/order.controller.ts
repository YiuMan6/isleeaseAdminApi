import { Request, Response } from "express";
import { z } from "zod";
import {
  createOrderService,
  getAllOrdersService,
  getOrderByIdService,
  deleteOrder,
  updateOrderUnifiedService,
} from "../services/order.service";

// —— 枚举：去掉 'paid' —— //
export const PaymentStatus = ["unpaid", "paid", "refunded"] as const;
export const OrderStatus = [
  "pending",
  "confirmed",
  "packed",
  "shipped",
  "completed",
  "cancelled",
] as const;

/** 创建 */
export const createOrder = async (req: Request, res: Response) => {
  try {
    const order = await createOrderService(req.body);
    res.status(201).json({ message: "Order created successfully", order });
  } catch (error: any) {
    console.error("Create order error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** 列表 */
export const getAllOrders = async (_req: Request, res: Response) => {
  try {
    const orders = await getAllOrdersService();
    res.json({ success: true, data: orders });
  } catch (error) {
    console.error("Get all orders error:", error);
    res.status(500).json({ success: false, message: "Failed to get orders" });
  }
};

/** 单个 */
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

/** 删除 */
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

/** 统一更新 */
const UnifiedUpdateSchema = z
  .object({
    expectedUpdatedAt: z.string().datetime().optional(),

    // 基本
    customerName: z.string().min(1).optional(),
    customerEmail: z.string().email().optional(),
    customerPhone: z.string().min(1).optional(),
    shippingAddress: z.string().min(1).optional(),
    position: z.string().optional(),
    note: z.string().max(500).nullable().optional(),
    barcodeAll: z.boolean().optional(),
    packageType: z.enum(["boxes", "opp"]).optional(),

    // —— 状态（无 'paid'）——
    orderStatus: z.enum(OrderStatus).optional(),

    // 支付（独立）
    paymentStatus: z.enum(PaymentStatus).optional(),

    // 运费
    shippingCartons: z.coerce.number().int().min(0).optional().nullable(),
    shippingCost: z.union([z.coerce.number(), z.null()]).optional(),
    shippingGstIncl: z.boolean().optional().nullable(),
    shippingNote: z.string().optional().nullable(),

    // 明细
    items: z
      .array(
        z.object({
          productId: z.number().int().positive(),
          quantity: z.number().int().min(0),
          backorder: z.number().int().min(0).optional(),
        })
      )
      .optional(),
  })
  .refine(
    (d) =>
      Object.keys(d).some(
        (k) => k !== "expectedUpdatedAt" && (d as any)[k] !== undefined
      ),
    { message: "Nothing to update" }
  );

export const patchOrderUnified = async (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  if (!orderId) return res.status(400).json({ message: "Invalid order id" });

  const parsed = UnifiedUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid body", issues: parsed.error.flatten() });
  }

  try {
    const updated = await updateOrderUnifiedService(orderId, parsed.data);
    return res.json({ success: true, data: updated });
  } catch (e: any) {
    if (e?.code === "P2025") {
      return res.status(404).json({ message: "Order not found" });
    }
    if (e?.message === "ORDER_VERSION_CONFLICT") {
      return res
        .status(409)
        .json({ message: "Order has been modified, please refresh and retry." });
    }
    console.error("Patch order unified error:", e);
    return res
      .status(e?.status || 500)
      .json({ message: e?.message || "Failed to update order" });
  }
};

const ShippingOnlySchema = z.object({
  shippingCartons: z.coerce.number().int().min(0).optional().nullable(),
  shippingCost: z.union([z.coerce.number(), z.null()]).optional(),
  shippingGstIncl: z.boolean().optional().nullable(),
  shippingNote: z.string().optional().nullable(),
});
