import { Router } from "express";
import {
  createOrder,
  getAllOrders,
  getOrderById,
  deleteOrderHandler,
  patchOrderStatus,
  updateOrderSnapshot, // ← 新增
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

// 修改状态
router.patch(
  "/:id/status",
  requireAuth,
  requireAdminLevel("ADMIN"),
  patchOrderStatus
);

// ✅ 新增：编辑快照（地址/客户信息/items）
router.patch(
  "/:id",
  requireAuth,
  requireAdminLevel("ADMIN"),
  updateOrderSnapshot
);

export default router;
