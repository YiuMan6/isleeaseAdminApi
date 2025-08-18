import { Router } from "express";
import {
  createOrder,
  getAllOrders,
  getOrderById,
  deleteOrderHandler,
  patchOrderUnified,   
} from "../controllers/order.controller";
import { requireAuth, requireAdminLevel } from "../middlewares/auth.middleware";

const router = Router();

router.post("/", requireAuth, createOrder);
router.get("/", requireAuth, getAllOrders);
router.get("/:id", requireAuth, getOrderById);

router.delete(
  "/:id",
  requireAuth,
  requireAdminLevel("ADMIN"),
  deleteOrderHandler
);

router.patch(
  "/:id",
  requireAuth,
  requireAdminLevel("ADMIN"),
  patchOrderUnified
);


export default router;
