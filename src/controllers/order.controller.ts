import { Request, Response } from "express";
import {
  createOrderService,
  getAllOrdersService,
  deleteOrder,
} from "../services/order.service";

export const createOrder = async (req: Request, res: Response) => {
  try {
    const order = await createOrderService(req.body);
    res.status(201).json({ message: "Order created successfully", order });
  } catch (error: any) {
    console.error("Create order error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getAllOrders = async (req: Request, res: Response) => {
  try {
    const orders = await getAllOrdersService();
    res.json({ success: true, data: orders });
  } catch (error) {
    console.error("Get all orders error:", error);
    res.status(500).json({ success: false, message: "Failed to get orders" });
  }
};

export const deleteOrderHandler = async (req: Request, res: Response) => {
  try {
    const orderId = parseInt(req.params.id);
    if (isNaN(orderId)) {
      return res.status(400).json({ error: "Invalid order ID" });
    }

    await deleteOrder(orderId);
    res.status(204).send(); // No Content
  } catch (error) {
    console.error("Delete order failed:", error);
    res.status(500).json({ error: "Failed to delete order" });
  }
};
