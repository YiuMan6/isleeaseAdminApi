-- AlterTable
ALTER TABLE "public"."Order" ADD COLUMN     "shippingCartons" INTEGER DEFAULT 0,
ADD COLUMN     "shippingCost" DECIMAL(12,2),
ADD COLUMN     "shippingGstIncl" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "shippingNote" TEXT;
