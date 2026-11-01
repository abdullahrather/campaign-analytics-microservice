-- CreateEnum
CREATE TYPE "CreativeStatus" AS ENUM ('PROCESSING', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'FAILED');

-- AlterTable
ALTER TABLE "metrics" ADD COLUMN     "first_quartiles" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "midpoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "third_quartiles" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "shows" ADD COLUMN     "video_key" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "creatives" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "click_url" TEXT NOT NULL,
    "status" "CreativeStatus" NOT NULL DEFAULT 'PROCESSING',
    "original_key" TEXT NOT NULL DEFAULT '',
    "video_key" TEXT NOT NULL DEFAULT '',
    "poster_key" TEXT NOT NULL DEFAULT '',
    "duration_seconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "size_bytes" INTEGER NOT NULL DEFAULT 0,
    "failure_reason" TEXT NOT NULL DEFAULT '',
    "rejection_reason" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "creatives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "creatives_campaign_id_status_idx" ON "creatives"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "creatives_status_created_at_idx" ON "creatives"("status", "created_at");

-- AddForeignKey
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
