// src/services/inventory.service.ts
import { prisma } from "../config/db";
import { OrderStatus } from "@prisma/client";

const OPEN_STATUSES: OrderStatus[] = ["pending", "confirmed", "packed"];

export type InventoryRow = {
  productId: number;
  title: string;
  onHand: number;
  fromOpenOrders: number; // Σ(quantity - backorder) on open orders
  shortage: number; // Σ(backorder) on open orders
  available: number; // onHand - fromOpenOrders
};

export async function getInventoryOverview(params?: {
  q?: string; // 模糊搜标题
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, params?.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, params?.pageSize ?? 100));
  const skip = (page - 1) * pageSize;

  const where = params?.q
    ? { title: { contains: params.q, mode: "insensitive" as const } }
    : undefined;

  // 1) 取产品分页
  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      select: {
        id: true,
        title: true,
        stockOnHand: true,
        stockAllocated: true, // 先留着，后面你要展示可以直接加上
      },
      orderBy: { title: "asc" },
      skip,
      take: pageSize,
    }),
  ]);

  const ids = products.map((p) => p.id);
  if (ids.length === 0) {
    return { page, pageSize, total, items: [] as InventoryRow[] };
  }

  // 2) 统计 open orders 上每个 productId 的 Σquantity 与 Σbackorder
  const grouped = await prisma.orderItem.groupBy({
    by: ["productId"],
    _sum: { quantity: true, backorder: true },
    where: {
      productId: { in: ids },
      order: { status: { in: OPEN_STATUSES } },
    },
  });

  const sumByPid = new Map<number, { sumQty: number; sumBackorder: number }>(
    grouped.map((g) => [
      g.productId,
      {
        sumQty: g._sum.quantity ?? 0,
        sumBackorder: g._sum.backorder ?? 0,
      },
    ])
  );

  // 3) 组装返回
  const items: InventoryRow[] = products.map((p) => {
    const agg = sumByPid.get(p.id) ?? { sumQty: 0, sumBackorder: 0 };
    const fromOpenOrders = Math.max(0, agg.sumQty - agg.sumBackorder);
    const shortage = Math.max(0, agg.sumBackorder);
    const onHand = p.stockOnHand;
    const available = onHand - fromOpenOrders;

    return {
      productId: p.id,
      title: p.title,
      onHand,
      fromOpenOrders,
      shortage,
      available,
    };
  });

  return { page, pageSize, total, items };
}
