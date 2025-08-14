// src/controllers/inventory.controller.ts
import { Request, Response } from "express";
import { getInventoryOverview } from "../services/inventory.service";

export async function getInventoryOverviewController(
  req: Request,
  res: Response
) {
  try {
    const page = req.query.page ? Number(req.query.page) : undefined;
    const pageSize = req.query.pageSize
      ? Number(req.query.pageSize)
      : undefined;
    const q = req.query.q ? String(req.query.q) : undefined;

    const data = await getInventoryOverview({ page, pageSize, q });
    res.json(data);
  } catch (err: any) {
    console.error(err);
    res
      .status(500)
      .json({ message: err.message ?? "inventory overview failed" });
  }
}
