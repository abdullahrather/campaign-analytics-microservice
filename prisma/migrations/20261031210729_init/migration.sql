-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'ADVERTISER');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AdSlot" AS ENUM ('PRE_ROLL', 'MID_ROLL', 'POST_ROLL');

-- CreateEnum
CREATE TYPE "Device" AS ENUM ('CTV', 'MOBILE', 'WEB', 'TABLET');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'ADVERTISER',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shows" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "genre" TEXT NOT NULL,

    CONSTRAINT "shows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "advertiser" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'ACTIVE',
    "budget_cents" INTEGER NOT NULL,
    "cpm_cents" INTEGER NOT NULL,
    "impression_goal" INTEGER NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "target_countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "target_genres" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "target_devices" "Device"[] DEFAULT ARRAY[]::"Device"[],
    "target_slots" "AdSlot"[] DEFAULT ARRAY[]::"AdSlot"[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrics" (
    "campaign_id" TEXT NOT NULL,
    "show_id" TEXT NOT NULL,
    "slot" "AdSlot" NOT NULL,
    "country" CHAR(2) NOT NULL,
    "device" "Device" NOT NULL,
    "bucket" TIMESTAMPTZ(3) NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "completions" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "metrics_pkey" PRIMARY KEY ("campaign_id","bucket","show_id","slot","country","device")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "shows_title_key" ON "shows"("title");

-- CreateIndex
CREATE INDEX "campaigns_user_id_idx" ON "campaigns"("user_id");

-- CreateIndex
CREATE INDEX "campaigns_status_starts_at_ends_at_idx" ON "campaigns"("status", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "metrics_bucket_idx" ON "metrics"("bucket");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_show_id_fkey" FOREIGN KEY ("show_id") REFERENCES "shows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
