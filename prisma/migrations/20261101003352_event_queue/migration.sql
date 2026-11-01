-- CreateTable
CREATE TABLE "processed_batches" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "filtered_events" (
    "bucket" TIMESTAMPTZ(3) NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "filtered_events_pkey" PRIMARY KEY ("bucket","campaign_id","reason")
);

-- CreateIndex
CREATE INDEX "processed_batches_created_at_idx" ON "processed_batches"("created_at");

-- CreateIndex
CREATE INDEX "filtered_events_campaign_id_idx" ON "filtered_events"("campaign_id");
