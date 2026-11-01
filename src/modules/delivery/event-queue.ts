/**
 * src/modules/delivery/event-queue.ts
 *
 * Gets ad events from the API into hourly rollups without losing or repeating any.
 *
 * 1. A Redis script drops event IDs it has already seen and queues the rest in
 *    one atomic step, so an accepted event is always on the stream.
 * 2. The worker reads stream entries and writes them to PostgreSQL. The entry IDs
 *    are stored in the same transaction as the totals, so an entry redelivered
 *    after a crash changes nothing.
 * 3. An entry leaves the stream only after that commit. If a worker dies, another
 *    claims its entries.
 */
import { Prisma } from '@prisma/client';
import type { Redis } from 'ioredis';
import { env } from '@/config/env';
import { prisma } from '@/lib/prisma';
import { createBlockingRedis, redis } from '@/lib/redis';
import type { EventType } from './delivery.schema';

const STREAM = 'ad-events';
const GROUP = 'rollup';
const READ_COUNT = 500;
const BLOCK_MS = 1000;
const STALE_ENTRY_MS = 30_000;
const ERROR_PAUSE_MS = 1000;
const COMPLETION_CHECK_MS = 1000;
const PRUNE_INTERVAL_MS = 60_000;

const HOUR_MS = 3_600_000;

export interface QueuedEvent {
  eventId: string;
  type: EventType;
  campaignId: string;
  showId: string;
  slot: string;
  country: string;
  device: string;
  occurredAt: Date;
}

export interface FilteredTraffic {
  eventId: string;
  reason: string;
  campaignId?: string;
}

export interface EnqueueResult {
  received: number;
  accepted: number;
  duplicates: number;
}

/** Short keys, because millions of these pass through the queue. */
type StoredEvent =
  | { t: EventType; c: string; s: string; p: string; o: string; d: string; b: string }
  | { f: string; c: string; b: string };

type StreamEntry = [id: string, fields: string[]];

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

const COLUMN_BY_TYPE: Record<EventType, keyof Rollup> = {
  IMPRESSION: 'impressions',
  CLICK: 'clicks',
  FIRST_QUARTILE: 'firstQuartiles',
  MIDPOINT: 'midpoints',
  THIRD_QUARTILE: 'thirdQuartiles',
  COMPLETION: 'completions',
};

const hourOf = (time: number): string =>
  new Date(Math.floor(time / HOUR_MS) * HOUR_MS).toISOString();

const push = (fields: string[], eventId: string, deliveredTo: string, event: StoredEvent): void => {
  fields.push(eventId, deliveredTo, JSON.stringify(event));
};

/** Queues a batch. Events already seen are dropped, so sending a batch twice is safe. */
export const enqueueEvents = async (events: QueuedEvent[]): Promise<EnqueueResult> => {
  const fields: string[] = [];
  for (const event of events) {
    push(fields, event.eventId, event.type === 'IMPRESSION' ? event.campaignId : '', {
      t: event.type,
      c: event.campaignId,
      s: event.showId,
      p: event.slot,
      o: event.country,
      d: event.device,
      b: hourOf(event.occurredAt.getTime()),
    });
  }

  const accepted = await redis.enqueueEvents(STREAM, env.EVENT_DEDUPE_SECONDS, ...fields);
  return { received: events.length, accepted, duplicates: events.length - accepted };
};

/** Records traffic that was rejected, so it can be reported but never billed. */
export const enqueueFiltered = async (traffic: FilteredTraffic): Promise<void> => {
  const fields: string[] = [];
  push(fields, traffic.eventId, '', {
    f: traffic.reason,
    c: traffic.campaignId ?? '',
    b: hourOf(Date.now()),
  });
  await redis.enqueueEvents(STREAM, env.EVENT_DEDUPE_SECONDS, ...fields);
};

const rollUp = (events: StoredEvent[]): { rollups: Rollup[]; filtered: Map<string, number> } => {
  const rollups = new Map<string, Rollup>();
  const filtered = new Map<string, number>();

  for (const event of events) {
    if ('f' in event) {
      const key = [event.b, event.c, event.f].join('|');
      filtered.set(key, (filtered.get(key) ?? 0) + 1);
      continue;
    }

    const key = [event.c, event.b, event.s, event.p, event.o, event.d].join('|');
    const rollup = rollups.get(key) ?? {
      campaignId: event.c,
      showId: event.s,
      slot: event.p,
      country: event.o,
      device: event.d,
      bucket: event.b,
      impressions: 0,
      clicks: 0,
      firstQuartiles: 0,
      midpoints: 0,
      thirdQuartiles: 0,
      completions: 0,
    };
    (rollup[COLUMN_BY_TYPE[event.t]] as number) += 1;
    rollups.set(key, rollup);
  }

  // A consistent row order stops two workers deadlocking on the same rows.
  const sorted = [...rollups.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  return { rollups: sorted.map(([, rollup]) => rollup), filtered };
};

const writeRollups = async (tx: Prisma.TransactionClient, rollups: Rollup[]): Promise<void> => {
  if (rollups.length === 0) return;

  const column = <K extends keyof Rollup>(key: K): Array<Rollup[K]> =>
    rollups.map((rollup) => rollup[key]);

  // Events for campaigns or shows that no longer exist are left out by the joins.
  await tx.$executeRaw(Prisma.sql`
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
};

const writeFiltered = async (
  tx: Prisma.TransactionClient,
  filtered: Map<string, number>,
): Promise<void> => {
  if (filtered.size === 0) return;

  const rows = [...filtered.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const parts = rows.map(([key]) => key.split('|'));

  await tx.$executeRaw(Prisma.sql`
    INSERT INTO filtered_events (bucket, campaign_id, reason, count)
    SELECT t.bucket::timestamptz, t.campaign_id, t.reason, t.count
    FROM unnest(
      ${parts.map(([bucket]) => bucket ?? '')}::text[],
      ${parts.map(([, campaignId]) => campaignId ?? '')}::text[],
      ${parts.map(([, , reason]) => reason ?? '')}::text[],
      ${rows.map(([, count]) => count)}::int[]
    ) AS t(bucket, campaign_id, reason, count)
    ON CONFLICT (bucket, campaign_id, reason) DO UPDATE SET
      count = filtered_events.count + EXCLUDED.count
  `);
};

/** Stops campaigns that reached their goal or budget, or ran past their end date. */
const completeFinishedCampaigns = async (campaignIds: string[]): Promise<void> => {
  if (campaignIds.length === 0) return;

  await prisma.$executeRaw(Prisma.sql`
    UPDATE campaigns c
    SET status = 'COMPLETED', updated_at = now()
    FROM (
      SELECT m.campaign_id, SUM(m.impressions) AS delivered
      FROM metrics m
      WHERE m.campaign_id = ANY(${campaignIds}::text[])
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
};

const eventsOf = ([, fields]: StreamEntry): StoredEvent[] =>
  JSON.parse(fields[1] as string) as StoredEvent[];

let touchedCampaigns = new Set<string>();
let lastCompletionCheck = 0;
let lastPrune = 0;

/** Writes entries exactly once, then takes them off the stream. */
const processEntries = async (entries: StreamEntry[]): Promise<void> => {
  const ids = entries.map(([id]) => id);

  const touched = await prisma.$transaction(
    async (tx) => {
      const fresh = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        INSERT INTO processed_batches (id)
        SELECT unnest(${ids}::text[])
        ON CONFLICT DO NOTHING
        RETURNING id
      `);

      const freshIds = new Set(fresh.map(({ id }) => id));
      const events = entries.filter(([id]) => freshIds.has(id)).flatMap(eventsOf);
      const { rollups, filtered } = rollUp(events);

      await writeRollups(tx, rollups);
      await writeFiltered(tx, filtered);
      return rollups.map(({ campaignId }) => campaignId);
    },
    { timeout: 30_000, maxWait: 30_000 },
  );

  await redis
    .pipeline()
    .xack(STREAM, GROUP, ...ids)
    .xdel(STREAM, ...ids)
    .exec();
  touched.forEach((id) => touchedCampaigns.add(id));
};

const runHousekeeping = async (force = false): Promise<void> => {
  const now = Date.now();

  if (force || now - lastCompletionCheck >= COMPLETION_CHECK_MS) {
    lastCompletionCheck = now;
    const campaignIds = [...touchedCampaigns];
    touchedCampaigns = new Set();
    await completeFinishedCampaigns(campaignIds);
  }

  if (now - lastPrune >= PRUNE_INTERVAL_MS) {
    lastPrune = now;
    await prisma.processedBatch.deleteMany({
      where: { createdAt: { lt: new Date(now - 86_400_000) } },
    });
  }
};

const ensureGroup = async (client: Redis): Promise<void> => {
  await client.xgroup('CREATE', STREAM, GROUP, '0', 'MKSTREAM').catch((error: Error) => {
    if (!error.message.includes('BUSYGROUP')) throw error;
  });
};

type ReadReply = Array<[string, StreamEntry[]]> | null;

const readNew = async (
  client: Redis,
  consumer: string,
  blockMs: number,
): Promise<StreamEntry[]> => {
  const args = ['GROUP', GROUP, consumer, 'COUNT', READ_COUNT] as const;
  const reply = (
    blockMs > 0
      ? await client.xreadgroup(...args, 'BLOCK', blockMs, 'STREAMS', STREAM, '>')
      : await client.xreadgroup(...args, 'STREAMS', STREAM, '>')
  ) as ReadReply;
  return reply?.[0]?.[1] ?? [];
};

/** Takes over entries left behind by a worker that stopped. */
const claimStale = async (
  client: Redis,
  consumer: string,
  idleMs: number,
): Promise<StreamEntry[]> => {
  const reply = (await client.xautoclaim(
    STREAM,
    GROUP,
    consumer,
    idleMs,
    '0-0',
    'COUNT',
    READ_COUNT,
  )) as [string, StreamEntry[]];
  return reply[1];
};

/** Processes everything waiting, then returns. */
export const drainEvents = async (consumer = 'drain'): Promise<void> => {
  await ensureGroup(redis);

  for (;;) {
    const entries = [
      ...(await claimStale(redis, consumer, 0)),
      ...(await readNew(redis, consumer, 0)),
    ];
    if (entries.length === 0) break;
    await processEntries(entries);
  }

  await runHousekeeping(true);
};

/** How many batches are waiting to reach the database. */
export const queueDepth = (): Promise<number> => redis.xlen(STREAM);

let running = false;

/** Runs until stopped. An error leaves entries on the stream to be retried. */
export const startEventWorker = (consumer = `worker-${process.pid}`): (() => Promise<void>) => {
  const client = createBlockingRedis();
  running = true;

  const loop = async (): Promise<void> => {
    await ensureGroup(client);
    let nextClaim = 0;

    while (running) {
      try {
        const entries: StreamEntry[] = [];
        if (Date.now() >= nextClaim) {
          nextClaim = Date.now() + STALE_ENTRY_MS;
          entries.push(...(await claimStale(client, consumer, STALE_ENTRY_MS)));
        }
        entries.push(...(await readNew(client, consumer, BLOCK_MS)));

        if (entries.length > 0) await processEntries(entries);
        await runHousekeeping();
      } catch (error) {
        console.error('Event worker:', String(error));
        await ensureGroup(client).catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, ERROR_PAUSE_MS));
      }
    }
  };

  const finished = loop();

  return async () => {
    running = false;
    await finished;
    client.disconnect();
  };
};
