-- CreateEnum
CREATE TYPE "public"."AdminLevel" AS ENUM ('SUPER', 'ADMIN');

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "adminLevel" "public"."AdminLevel";
