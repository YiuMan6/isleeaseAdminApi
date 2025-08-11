-- CreateEnum
CREATE TYPE "UserLabel" AS ENUM ('RETAILER', 'DISTRIBUTOR', 'INTERNAL');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "label" "UserLabel";
