-- AlterTable
ALTER TABLE "users" ADD COLUMN     "two_factor_failures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "two_factor_locked_until" TIMESTAMPTZ(3);
