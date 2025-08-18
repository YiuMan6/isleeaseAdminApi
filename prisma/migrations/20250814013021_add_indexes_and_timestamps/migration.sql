-- AlterTable
ALTER TABLE "public"."Order" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "shippedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "OrderItem_backorder_idx" ON "public"."OrderItem"("backorder");

-- CreateIndex
CREATE INDEX "OrderItem_productId_orderId_idx" ON "public"."OrderItem"("productId", "orderId");

-- CreateIndex
CREATE INDEX "Product_title_idx" ON "public"."Product"("title");
