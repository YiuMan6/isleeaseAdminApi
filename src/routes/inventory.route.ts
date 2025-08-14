// src/routes/inventory.route.ts
import { Router } from "express";
import { getInventoryOverviewController } from "../controllers/inventory.controller";

const router = Router();

// GET /api/inventory/overview?q=Cheese&page=1&pageSize=100
router.get("/", getInventoryOverviewController);

export default router;
