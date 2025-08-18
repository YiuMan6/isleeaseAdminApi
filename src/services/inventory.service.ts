// // src/services/inventory.service.ts
// import { prisma } from "../config/db";
// import { PaymentStatus } from "@prisma/client";

// export type InventoryRow = {
//   productId: number;
//   title: string;
//   onHand: number; // 实物库存（stockOnHand）
//   allocated: number; // 已付款订单的总下单量（无视 backorder、无视订单状态）
//   available: number; // 可用库存 = max(0, onHand - allocated)
// };

// export async function getInventoryOverview(params?: {
//   q?: string; // 模糊搜标题
//   page?: number;
//   pageSize?: number;
// }) {
//   const page = Math.max(1, params?.page ?? 1);
//   const pageSize = Math.min(200, Math.max(10, params?.pageSize ?? 100));
//   const skip = (page - 1) * pageSize;

//   // 1) 产品查询条件
//   const where = params?.q
//     ? { title: { contains: params.q, mode: "insensitive" as const } }
//     : undefined;

//   // 2) 分页取产品
//   const [total, products] = await Promise.all([
//     prisma.product.count({ where }),
//     prisma.product.findMany({
//       where,
//       select: { id: true, title: true, stockOnHand: true },
//       orderBy: { title: "asc" },
//       skip,
//       take: pageSize,
//     }),
//   ]);

//   const ids = products.map((p) => p.id);
//   if (ids.length === 0) {
//     return { page, pageSize, total, items: [] as InventoryRow[] };
//   }

//   // 3) 聚合统计：只要已付款（不看订单状态，不看 backorder）
//   const paidGrouped = await prisma.orderItem.groupBy({
//     by: ["productId"],
//     _sum: { quantity: true },
//     where: {
//       productId: { in: ids },
//       order: { paymentStatus: PaymentStatus.paid },
//     },
//   });

//   const allocatedMap = new Map<number, number>(
//     paidGrouped.map((g) => [g.productId, g._sum.quantity ?? 0])
//   );

//   // 4) 组装返回
//   const items: InventoryRow[] = products.map((p) => {
//     const onHand = p.stockOnHand;
//     const allocated = allocatedMap.get(p.id) ?? 0; // = Σ(quantity where paid)
//     const available = Math.max(0, onHand - allocated); // 不允许负数，对外展示为 0

//     return {
//       productId: p.id,
//       title: p.title,
//       onHand,
//       allocated,
//       available,
//     };
//   });

//   return { page, pageSize, total, items };
// }

// src/services/inventory.service.ts
import { prisma } from "../config/db";
import { OrderStatus, PaymentStatus } from "@prisma/client";

// “进行中”定义（仅用于 demand_open 口径）
const OPEN_STATUSES: OrderStatus[] = ["pending", "confirmed", "packed"];

export type InventoryRow = {
  productId: number;
  title: string;

  // —— 库存三件套 —— //
  onHand: number; // 实物库存（Product.stockOnHand）
  allocated: number; // 已付款总下单量（= demand_paid）
  available: number; // = max(0, onHand - allocated)

  // —— 需求口径（都是 Σ(quantity)）—— //
  demand_all: number; // 所有订单总需求
  demand_paid: number; // 已付款总需求（= allocated）
  demand_unpaid: number; // 未付款总需求
  demand_open: number; // 进行中（pending/confirmed/packed）总需求（不看付款）

  // —— 采购建议（不同视角）—— //
  need_to_buy_for_paid: number; // 满足“已付款全部需求”需补多少
  need_to_buy_for_open: number; // 满足“进行中全部需求”需补多少
  need_to_buy_for_all: number; // 满足“所有历史订单需求”需补多少
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

  // 2) 分页产品
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

  // 3) 需求聚合（一次性按 productId 分组，避免 N+1）
  const [allGrouped, paidGrouped, unpaidGrouped, openGrouped] =
    await Promise.all([
      // 所有订单
      prisma.orderItem.groupBy({
        by: ["productId"],
        _sum: { quantity: true },
        where: { productId: { in: ids } },
      }),
      // 已付款（你的“锁定口径”）
      prisma.orderItem.groupBy({
        by: ["productId"],
        _sum: { quantity: true },
        where: {
          productId: { in: ids },
          order: { paymentStatus: PaymentStatus.paid },
        },
      }),
      // 未付款
      prisma.orderItem.groupBy({
        by: ["productId"],
        _sum: { quantity: true },
        where: {
          productId: { in: ids },
          order: { paymentStatus: PaymentStatus.unpaid },
        },
      }),
      // 进行中（不看付款）
      prisma.orderItem.groupBy({
        by: ["productId"],
        _sum: { quantity: true },
        where: {
          productId: { in: ids },
          order: { status: { in: OPEN_STATUSES } },
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

  // 4) 组装返回
  const items: InventoryRow[] = products.map((p) => {
    const onHand = p.stockOnHand;

    const demand_all = allMap.get(p.id) ?? 0;
    const demand_paid = paidMap.get(p.id) ?? 0; // = allocated
    const demand_unpaid = unpaidMap.get(p.id) ?? 0;
    const demand_open = openMap.get(p.id) ?? 0;

    const allocated = demand_paid; // 按你的规则：只要 paid 就全部锁
    const available = Math.max(0, onHand - allocated);

    const need_to_buy_for_paid = Math.max(0, demand_paid - onHand);
    const need_to_buy_for_open = Math.max(0, demand_open - onHand);
    const need_to_buy_for_all = Math.max(0, demand_all - onHand);

    return {
      productId: p.id,
      title: p.title,

      onHand,
      allocated,
      available,

      demand_all,
      demand_paid,
      demand_unpaid,
      demand_open,

      need_to_buy_for_paid,
      need_to_buy_for_open,
      need_to_buy_for_all,
    };
  });

  return { page, pageSize, total, items };
}
