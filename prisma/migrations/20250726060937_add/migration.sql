/*
  Warnings:

  - The values [DISTRIBUTOR] on the enum `UserLabel` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `address` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[email]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `email` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `password` to the `User` table without a default value. This is not possible if the table is not empty.
  - Made the column `label` on table `User` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "RetailerTier" AS ENUM ('TIER_1', 'TIER_2', 'TIER_3');

-- AlterEnum
BEGIN;
CREATE TYPE "UserLabel_new" AS ENUM ('RETAILER', 'INTERNAL', 'VIP');
ALTER TABLE "User" ALTER COLUMN "label" TYPE "UserLabel_new" USING ("label"::text::"UserLabel_new");
ALTER TYPE "UserLabel" RENAME TO "UserLabel_old";
ALTER TYPE "UserLabel_new" RENAME TO "UserLabel";
DROP TYPE "UserLabel_old";
COMMIT;

-- DropIndex
DROP INDEX "User_userId_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "address",
DROP COLUMN "name",
DROP COLUMN "phone",
DROP COLUMN "userId",
ADD COLUMN     "email" TEXT NOT NULL,
ADD COLUMN     "password" TEXT NOT NULL,
ADD COLUMN     "retailerTier" "RetailerTier",
ALTER COLUMN "label" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
