// scripts/backfillBackorder.ts
import { PrismaClient, OrderStatus, StockMoveType } from "@prisma/client";
const prisma = new PrismaClient();

// 想要记录一条库存流水，设为 true；否则 false
const WRITE_MOVEMENT = false;

// 未完成订单状态
const OPEN_STATUSES: OrderStatus[] = ["pending", "confirmed", "packed"];

async function backfillOneProduct(productId: number) {
  return prisma.$transaction(async (tx) => {
    // 1) 拉产品现货
    const prod = await tx.product.findUnique({
      where: { id: productId },
      select: { id: true, title: true, stockOnHand: true },
    });
    if (!prod) return { productId, title: "", allocated: 0, touched: 0 };

    // 2) 拉该产品的未完成订单项，按订单时间升序（FIFO）
    const items = await tx.orderItem.findMany({
      where: {
        productId,
        order: { status: { in: OPEN_STATUSES } },
      },
      select: {
        id: true,
        quantity: true,
        backorder: true,
        order: { select: { id: true, createdAt: true } },
      },
      orderBy: [{ order: { createdAt: "asc" } }, { id: "asc" }],
    });

    if (items.length === 0) {
      // 没有未完成订单：占用应为 0
      await tx.product.update({
        where: { id: productId },
        data: { stockAllocated: 0 },
      });
      return { productId, title: prod.title, allocated: 0, touched: 0 };
    }

    // 3) 分配逻辑
    let remaining = prod.stockOnHand; // 现货池
    let totalAllocated = 0;
    let touched = 0;

    for (const it of items) {
      const canAlloc = Math.max(0, Math.min(remaining, it.quantity));
      const bo = it.quantity - canAlloc;

      // 只在需要变更时更新
      if (it.backorder !== bo) {
        await tx.orderItem.update({
          where: { id: it.id },
          data: { backorder: bo },
        });
        touched++;
      }

      remaining -= canAlloc;
      totalAllocated += canAlloc;
    }

    // 4) 回写产品的已分配
    await tx.product.update({
      where: { id: productId },
      data: { stockAllocated: totalAllocated },
    });

    // 5) 可选：写一条汇总库存流水（避免按 item 爆量）
    if (WRITE_MOVEMENT) {
      await tx.stockMovement.create({
        data: {
          productId,
          type: StockMoveType.ADJUST, // 或 ALLOCATE，按你的审计口径
          qty: 0, // 不改变物理库存，这里只是校准 backorder/allocated
          reason: `backfill allocated=${totalAllocated} by script`,
        },
      });
    }

    return { productId, title: prod.title, allocated: totalAllocated, touched };
  });
}

async function main() {
  // 分批处理所有产品，避免一次性拉太多（你也可以按 title 搜索或 id 范围）
  const batchSize = 200;
  let skip = 0;

  while (true) {
    const products = await prisma.product.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
      skip,
      take: batchSize,
    });
    if (products.length === 0) break;

    for (const p of products) {
      const res = await backfillOneProduct(p.id);
      console.log(
        `[backfill] pid=${res.productId} "${res.title}" allocated=${res.allocated} updatedItems=${res.touched}`
      );
    }

    skip += batchSize;
  }
}

main()
  .then(() => {
    console.log("Backfill completed.");
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
