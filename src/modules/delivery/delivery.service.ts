/**
 * src/modules/delivery/delivery.service.ts
 *
 * The ad server side: choosing which ad to play, and recording what happened.
 *
 * Events are not stored one by one. A batch is rolled up in memory and written
 * as a single upsert into the hourly metrics table, which keeps ingestion cheap
 * and the table small enough for dashboards to read quickly.
 */
import { CreativeStatus, Prisma, type Creative } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { AdDecisionQuery, AdEvent } from './delivery.schema';

const HOUR_MS = 3_600_000;

export interface AdDecision {
  campaignId: string;
  title: string;
  advertiser: string;
  /** Set when the caller asked for a campaign that has a playable ad. */
  creative?: Creative;
}

export interface IngestResult {
  received: number;
  rollups: number;
  ignored: number;
}

interface Rollup {
  campaignId: string;
  showId: string;
  slot: string;
  country: string;
  device: string;
  bucket: string;
  impressions: number;
  clicks: number;
  firstQuartiles: number;
  midpoints: number;
  thirdQuartiles: number;
  completions: number;
}

const rollUp = (events: AdEvent[]): Rollup[] => {
  const rollups = new Map<string, Rollup>();

  for (const event of events) {
    const time = event.occurredAt?.getTime() ?? Date.now();
    const bucket = new Date(Math.floor(time / HOUR_MS) * HOUR_MS).toISOString();
    const { campaignId, showId, slot, country, device } = event;
    const key = [campaignId, bucket, showId, slot, country, device].join('|');

    const rollup = rollups.get(key) ?? {
      campaignId,
      showId,
      slot,
      country,
      device,
      bucket,
      impressions: 0,
      clicks: 0,
      firstQuartiles: 0,
      midpoints: 0,
      thirdQuartiles: 0,
      completions: 0,
    };
    if (event.type === 'IMPRESSION') rollup.impressions += 1;
    if (event.type === 'CLICK') rollup.clicks += 1;
    if (event.type === 'FIRST_QUARTILE') rollup.firstQuartiles += 1;
    if (event.type === 'MIDPOINT') rollup.midpoints += 1;
    if (event.type === 'THIRD_QUARTILE') rollup.thirdQuartiles += 1;
    if (event.type === 'COMPLETION') rollup.completions += 1;
    rollups.set(key, rollup);
  }

  return [...rollups.values()];
};

export class DeliveryService {
  /**
   * Picks the eligible campaign that is furthest behind its delivery schedule.
   * Ties go to the higher CPM. Returns null when nothing can run here.
   */
  async decide(
    query: AdDecisionQuery,
    { requireCreative = false }: { requireCreative?: boolean } = {},
  ): Promise<AdDecision | null> {
    const hasCreative = requireCreative
      ? Prisma.sql`EXISTS (
          SELECT 1 FROM creatives cr
          WHERE cr.campaign_id = c.id AND cr.status = 'APPROVED'
        )`
      : Prisma.sql`TRUE`;

    const rows = await prisma.$queryRaw<AdDecision[]>(Prisma.sql`
      SELECT c.id AS "campaignId", c.title, c.advertiser
      FROM campaigns c
      JOIN shows s ON s.id = ${query.showId}
      CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(m.impressions), 0) AS delivered
        FROM metrics m
        WHERE m.campaign_id = c.id
      ) d
      WHERE c.status = 'ACTIVE'
        AND ${hasCreative}
        AND now() >= c.starts_at AND now() < c.ends_at
        AND d.delivered < c.impression_goal
        AND d.delivered * c.cpm_cents / 1000 < c.budget_cents
        AND (cardinality(c.target_countries) = 0 OR ${query.country} = ANY(c.target_countries))
        AND (cardinality(c.target_genres) = 0 OR s.genre = ANY(c.target_genres))
        AND (cardinality(c.target_devices) = 0
          OR ${query.device}::"Device" = ANY(c.target_devices))
        AND (cardinality(c.target_slots) = 0 OR ${query.slot}::"AdSlot" = ANY(c.target_slots))
      ORDER BY
        d.delivered / GREATEST(
          c.impression_goal
            * EXTRACT(EPOCH FROM now() - c.starts_at)
            / EXTRACT(EPOCH FROM c.ends_at - c.starts_at),
          1
        ) ASC,
        c.cpm_cents DESC
      LIMIT 1
    `);

    const decision = rows[0];
    if (!decision || !requireCreative) return decision ?? null;

    const creatives = await prisma.creative.findMany({
      where: { campaignId: decision.campaignId, status: CreativeStatus.APPROVED },
    });
    const creative = creatives[Math.floor(Math.random() * creatives.length)];
    return creative ? { ...decision, creative } : null;
  }

  /**
   * Stores a batch of events. Replaying a batch counts it twice, so callers
   * should send each batch once. Events for unknown campaigns or shows are ignored.
   */
  async ingest(events: AdEvent[]): Promise<IngestResult> {
    const rollups = rollUp(events);
    const column = <K extends keyof Rollup>(key: K): Array<Rollup[K]> =>
      rollups.map((rollup) => rollup[key]);

    const written = await prisma.$executeRaw(Prisma.sql`
      INSERT INTO metrics
        (campaign_id, show_id, slot, country, device, bucket, impressions, clicks,
         first_quartiles, midpoints, third_quartiles, completions)
      SELECT t.campaign_id, t.show_id, t.slot::"AdSlot", t.country, t.device::"Device",
        t.bucket::timestamptz, t.impressions, t.clicks,
        t.first_quartiles, t.midpoints, t.third_quartiles, t.completions
      FROM unnest(
        ${column('campaignId')}::text[],
        ${column('showId')}::text[],
        ${column('slot')}::text[],
        ${column('country')}::text[],
        ${column('device')}::text[],
        ${column('bucket')}::text[],
        ${column('impressions')}::int[],
        ${column('clicks')}::int[],
        ${column('firstQuartiles')}::int[],
        ${column('midpoints')}::int[],
        ${column('thirdQuartiles')}::int[],
        ${column('completions')}::int[]
      ) AS t(campaign_id, show_id, slot, country, device, bucket, impressions, clicks,
             first_quartiles, midpoints, third_quartiles, completions)
      JOIN campaigns c ON c.id = t.campaign_id
      JOIN shows s ON s.id = t.show_id
      ON CONFLICT (campaign_id, bucket, show_id, slot, country, device) DO UPDATE SET
        impressions = metrics.impressions + EXCLUDED.impressions,
        clicks = metrics.clicks + EXCLUDED.clicks,
        first_quartiles = metrics.first_quartiles + EXCLUDED.first_quartiles,
        midpoints = metrics.midpoints + EXCLUDED.midpoints,
        third_quartiles = metrics.third_quartiles + EXCLUDED.third_quartiles,
        completions = metrics.completions + EXCLUDED.completions
    `);

    await this.completeFinishedCampaigns(column('campaignId'));

    return { received: events.length, rollups: rollups.length, ignored: rollups.length - written };
  }

  /** Stops campaigns that reached their goal or budget, or ran past their end date. */
  private async completeFinishedCampaigns(campaignIds: string[]): Promise<void> {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE campaigns c
      SET status = 'COMPLETED', updated_at = now()
      FROM (
        SELECT m.campaign_id, SUM(m.impressions) AS delivered
        FROM metrics m
        WHERE m.campaign_id = ANY(${[...new Set(campaignIds)]}::text[])
        GROUP BY m.campaign_id
      ) d
      WHERE c.id = d.campaign_id
        AND c.status = 'ACTIVE'
        AND (
          d.delivered >= c.impression_goal
          OR d.delivered * c.cpm_cents / 1000 >= c.budget_cents
          OR now() >= c.ends_at
        )
    `);
  }
}

export const deliveryService = new DeliveryService();
