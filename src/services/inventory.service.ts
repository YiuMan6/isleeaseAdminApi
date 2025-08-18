// src/services/inventory.service.ts
import { prisma } from "../config/db";
import { OrderStatus, PaymentStatus } from "@prisma/client";

// 仍在流程中的订单状态（用于 allocated 与 demand_open）
const OPEN_STATUSES: OrderStatus[] = ["pending", "confirmed", "packed"];

export type InventoryRow = {
  productId: number;
  title: string;

  // —— 库存三件套 —— //
  onHand: number; // 实物库存（Product.stockOnHand）
  allocated: number; // 已付款且仍在进行中的总下单量（真正“还在占用”的部分）
  available: number; // = max(0, onHand - allocated)

  // —— 需求口径（均为 Σ(quantity)）—— //
  demand_all: number; // 所有订单总需求（不看付款/状态）
  demand_paid: number; // 已付款总需求（不看状态；历史视图）
  demand_unpaid: number; // 未付款总需求（不看状态）
  demand_open: number; // 进行中（pending/confirmed/packed）总需求（不看付款）
  open_unpaid: number; // 进行中但未付款 = demand_open - allocated

  // —— 采购建议 —— //
  need_to_buy_for_open: number; // 满足“所有进行中”需补多少
};

export async function getInventoryOverview(params?: {
  q?: string; // 模糊搜标题
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, params?.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, params?.pageSize ?? 100));
  const skip = (page - 1) * pageSize;

  // 1) 产品条件
  const where = params?.q
    ? { title: { contains: params.q, mode: "insensitive" as const } }
    : undefined;

  // 2) 分页取产品
  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      select: { id: true, title: true, stockOnHand: true },
      orderBy: { title: "asc" },
      skip,
      take: pageSize,
    }),
  ]);

  const ids = products.map((p) => p.id);
  if (ids.length === 0) {
    return { page, pageSize, total, items: [] as InventoryRow[] };
  }

  // 3) 需求聚合
  const [allGrouped, paidGrouped, unpaidGrouped, openGrouped, paidOpenGrouped] =
    await Promise.all([
      // 所有订单
      prisma.orderItem.groupBy({
        by: ["productId"],
        _sum: { quantity: true },
        where: { productId: { in: ids } },
      }),
      // 已付款（不看状态）→ demand_paid
      prisma.orderItem.groupBy({
        by: ["productId"],
        _sum: { quantity: true },
        where: {
          productId: { in: ids },
          order: { paymentStatus: PaymentStatus.paid },
        },
      }),
      // 未付款（不看状态）→ demand_unpaid
      prisma.orderItem.groupBy({
        by: ["productId"],
        _sum: { quantity: true },
        where: {
          productId: { in: ids },
          order: { paymentStatus: PaymentStatus.unpaid },
        },
      }),
      // 进行中（不看付款）→ demand_open
      prisma.orderItem.groupBy({
        by: ["productId"],
        _sum: { quantity: true },
        where: {
          productId: { in: ids },
          order: { status: { in: OPEN_STATUSES } },
        },
      }),
      // ✅ 已付款 且 进行中 → allocated（发货/完成后会自动下降）
      prisma.orderItem.groupBy({
        by: ["productId"],
        _sum: { quantity: true },
        where: {
          productId: { in: ids },
          order: {
            paymentStatus: PaymentStatus.paid,
            status: { in: OPEN_STATUSES },
          },
        },
      }),
    ]);

  const toMap = (
    arr: { productId: number; _sum: { quantity: number | null } }[]
  ) =>
    new Map<number, number>(
      arr.map((g) => [g.productId, g._sum.quantity ?? 0])
    );

  const allMap = toMap(allGrouped);
  const paidMap = toMap(paidGrouped);
  const unpaidMap = toMap(unpaidGrouped);
  const openMap = toMap(openGrouped);
  const paidOpenMap = toMap(paidOpenGrouped); // 用于 allocated

  // 4) 组装返回
  const items: InventoryRow[] = products.map((p) => {
    const onHand = p.stockOnHand;

    const demand_all = allMap.get(p.id) ?? 0;
    const demand_paid = paidMap.get(p.id) ?? 0; // 历史已付款总需求（不看状态）
    const demand_unpaid = unpaidMap.get(p.id) ?? 0;
    const demand_open = openMap.get(p.id) ?? 0;

    const allocated = paidOpenMap.get(p.id) ?? 0; // 仍在占用：已付款 + 进行中
    const available = Math.max(0, onHand - allocated);

    const open_unpaid = Math.max(0, demand_open - allocated);

    return {
      productId: p.id,
      title: p.title,

      onHand, // 我手上有多少
      allocated, // 已付款订单的产品需求
      available, // // 总库存 扣除 已付款产品的数量，因为付款的要锁住

      demand_all, // 该产品的历史所有需求
      demand_paid, // 该产品的历史所有已经付款的
      demand_unpaid, // 该产品还没付款的数量
      demand_open, // 目前还在进行的订单，该产品的总需求量
      open_unpaid, // 总需求里面还没付款的那部分

      need_to_buy_for_open: Math.max(0, demand_open - onHand), // 所有未处理的订单，我继续采购多少个
    };
  });

  return { page, pageSize, total, items };
}
