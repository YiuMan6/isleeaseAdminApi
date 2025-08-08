import { Router } from "express";
import {
  createOrder,
  getAllOrders,
  deleteOrderHandler,
} from "../controllers/order.controller";

const router = Router();

router.post("/", createOrder);
router.get("/", getAllOrders);
router.delete("/:id", deleteOrderHandler);

export default router;
