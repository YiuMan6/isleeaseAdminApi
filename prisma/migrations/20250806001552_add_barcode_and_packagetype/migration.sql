/*
  Warnings:

  - Added the required column `packageType` to the `Order` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."PackageType" AS ENUM ('boxes', 'opp');

-- AlterTable
ALTER TABLE "public"."Order" ADD COLUMN     "barcodeAll" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "packageType" "public"."PackageType" NOT NULL;
