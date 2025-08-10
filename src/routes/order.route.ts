import { Router } from "express";
import {
  createOrder,
  getAllOrders,
  getOrderById, // 👈 新增
  deleteOrderHandler,
  patchOrderStatus,
} from "../controllers/order.controller";
import { requireAuth, requireAdminLevel } from "../middlewares/auth.middleware";

const router = Router();

router.post("/", requireAuth, createOrder);
router.get("/", requireAuth, getAllOrders);
router.get("/:id", requireAuth, getOrderById); // ✅ 新增

router.delete(
  "/:id",
  requireAuth,
  requireAdminLevel("ADMIN"),
  deleteOrderHandler
);

// 修改状态（建议管理员权限）
router.patch(
  "/:id/status",
  requireAuth,
  requireAdminLevel("ADMIN"),
  patchOrderStatus
);

export default router;
