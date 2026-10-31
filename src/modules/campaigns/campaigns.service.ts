/**
 * src/modules/campaigns/campaigns.service.ts
 *
 * Business logic for campaigns.
 *
 * Every analytics method runs as one SQL statement over the hourly rollup table,
 * so the database does the aggregation and the number of campaigns never adds
 * round-trips (no N+1). Advertisers see their own campaigns; admins see all.
 */
import { Prisma, Role, type Campaign } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/middleware/errorHandler';
import type {
  CreateCampaignDto,
  DateRange,
  ListCampaignsQuery,
  UpdateCampaignDto,
} from './campaigns.schema';

const HOURLY_RANGE_LIMIT_MS = 3 * 86_400_000;
const PACING_TOLERANCE = 0.1;

// ── Typed return shapes ───────────────────────────────────────────────────────

export interface Actor {
  sub: string;
  role: string;
}

export interface PaginatedCampaigns {
  data: Campaign[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export type Pacing = 'AHEAD' | 'ON_TRACK' | 'BEHIND' | 'NOT_STARTED' | 'FINISHED';

export interface PerformanceTotals {
  impressions: number;
  clicks: number;
  completions: number;
  ctr: number;
  completionRate: number;
}

export interface CampaignAnalytics extends Campaign, PerformanceTotals {
  ownerEmail: string;
  spendCents: number;
  lifetimeImpressions: number;
  lifetimeSpendCents: number;
  deliveryRate: number;
  budgetUsedRate: number;
  pacing: Pacing;
}

export interface TimeseriesPoint extends PerformanceTotals {
  time: Date;
}

export interface BreakdownRow extends PerformanceTotals {
  key: string;
}

export interface Breakdown {
  slot: BreakdownRow[];
  country: BreakdownRow[];
  device: BreakdownRow[];
  show: BreakdownRow[];
}

type CampaignAnalyticsRow = Campaign & {
  ownerEmail: string;
  impressions: bigint;
  clicks: bigint;
  completions: bigint;
  lifetimeImpressions: bigint;
};

interface TotalsRow {
  impressions: bigint;
  clicks: bigint;
  completions: bigint;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ownerFilter = (actor: Actor): string | undefined =>
  actor.role === Role.ADMIN ? undefined : actor.sub;

const ownerSql = (actor: Actor): Prisma.Sql => {
  const owner = ownerFilter(actor);
  return owner ? Prisma.sql`c.user_id = ${owner}` : Prisma.sql`TRUE`;
};

const ratio = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);

const toTotals = (row: TotalsRow): PerformanceTotals => {
  const impressions = Number(row.impressions);
  const clicks = Number(row.clicks);
  const completions = Number(row.completions);
  return {
    impressions,
    clicks,
    completions,
    ctr: ratio(clicks, impressions),
    completionRate: ratio(completions, impressions),
  };
};

const spend = (impressions: number, cpmCents: number): number =>
  Math.round((impressions * cpmCents) / 1000);

/** Compares delivery so far with an even spread of the goal across the flight. */
const pacingOf = (campaign: Campaign, delivered: number, now: Date): Pacing => {
  if (campaign.status === 'COMPLETED' || now >= campaign.endsAt) return 'FINISHED';
  if (now < campaign.startsAt) return 'NOT_STARTED';

  const flight = campaign.endsAt.getTime() - campaign.startsAt.getTime();
  const elapsed = now.getTime() - campaign.startsAt.getTime();
  const expected = campaign.impressionGoal * (elapsed / flight);
  const position = ratio(delivered, expected);

  if (position > 1 + PACING_TOLERANCE) return 'AHEAD';
  return position < 1 - PACING_TOLERANCE ? 'BEHIND' : 'ON_TRACK';
};

const definedOnly = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;

// ── Service class ─────────────────────────────────────────────────────────────

export class CampaignsService {
  /**
   * Returns a paginated list of campaigns visible to the actor.
   * Supports optional status filtering.
   */
  async listCampaigns(actor: Actor, query: ListCampaignsQuery): Promise<PaginatedCampaigns> {
    const owner = ownerFilter(actor);
    const where: Prisma.CampaignWhereInput = {
      ...(owner ? { userId: owner } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const skip = (query.page - 1) * query.limit;

    const [total, data] = await prisma.$transaction([
      prisma.campaign.count({ where }),
      prisma.campaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit,
      }),
    ]);

    return {
      data,
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async createCampaign(actor: Actor, dto: CreateCampaignDto): Promise<Campaign> {
    return prisma.campaign.create({ data: { ...dto, userId: actor.sub } });
  }

  async updateCampaign(id: string, actor: Actor, dto: UpdateCampaignDto): Promise<Campaign> {
    const campaign = await this.findOneOrFail(id, actor);

    if (campaign.status === 'COMPLETED' && dto.status) {
      throw new AppError(409, 'A completed campaign cannot change status.');
    }
    const startsAt = dto.startsAt ?? campaign.startsAt;
    const endsAt = dto.endsAt ?? campaign.endsAt;
    if (endsAt <= startsAt) {
      throw new AppError(422, 'End date must be after the start date.');
    }

    return prisma.campaign.update({
      where: { id },
      data: definedOnly(dto) as Prisma.CampaignUpdateInput,
    });
  }

  async deleteCampaign(id: string, actor: Actor): Promise<void> {
    await this.findOneOrFail(id, actor);
    await prisma.campaign.delete({ where: { id } });
  }

  /**
   * Totals per campaign for the date window, plus lifetime delivery for budget
   * and pacing. LEFT JOIN keeps campaigns with no metrics; COALESCE turns their
   * NULL sums into 0.
   */
  async getAnalytics(
    actor: Actor,
    range: DateRange,
    campaignId?: string,
  ): Promise<CampaignAnalytics[]> {
    const campaignFilter = campaignId ? Prisma.sql`c.id = ${campaignId}` : Prisma.sql`TRUE`;
    const inRange = Prisma.sql`m.bucket >= ${range.from} AND m.bucket < ${range.to}`;

    const rows = await prisma.$queryRaw<CampaignAnalyticsRow[]>(Prisma.sql`
      SELECT
        c.id,
        c.user_id AS "userId",
        c.title,
        c.advertiser,
        c.status,
        c.budget_cents AS "budgetCents",
        c.cpm_cents AS "cpmCents",
        c.impression_goal AS "impressionGoal",
        c.starts_at AS "startsAt",
        c.ends_at AS "endsAt",
        c.target_countries AS "targetCountries",
        c.target_genres AS "targetGenres",
        c.target_devices::text[] AS "targetDevices",
        c.target_slots::text[] AS "targetSlots",
        c.created_at AS "createdAt",
        c.updated_at AS "updatedAt",
        u.email AS "ownerEmail",
        COALESCE(SUM(m.impressions) FILTER (WHERE ${inRange}), 0) AS impressions,
        COALESCE(SUM(m.clicks) FILTER (WHERE ${inRange}), 0) AS clicks,
        COALESCE(SUM(m.completions) FILTER (WHERE ${inRange}), 0) AS completions,
        COALESCE(SUM(m.impressions), 0) AS "lifetimeImpressions"
      FROM campaigns c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN metrics m ON m.campaign_id = c.id
      WHERE ${ownerSql(actor)} AND ${campaignFilter}
      GROUP BY c.id, u.email
      ORDER BY c.created_at DESC
    `);

    const now = new Date();
    return rows.map((row) => {
      const lifetimeImpressions = Number(row.lifetimeImpressions);
      const lifetimeSpendCents = spend(lifetimeImpressions, row.cpmCents);
      const totals = toTotals(row);

      return {
        ...row,
        ...totals,
        spendCents: spend(totals.impressions, row.cpmCents),
        lifetimeImpressions,
        lifetimeSpendCents,
        deliveryRate: ratio(lifetimeImpressions, row.impressionGoal),
        budgetUsedRate: ratio(lifetimeSpendCents, row.budgetCents),
        pacing: pacingOf(row, lifetimeImpressions, now),
      };
    });
  }

  /** Performance over time: hourly for up to three days, otherwise daily. */
  async getTimeseries(
    actor: Actor,
    range: DateRange,
    campaignId?: string,
  ): Promise<TimeseriesPoint[]> {
    const isHourly = range.to.getTime() - range.from.getTime() <= HOURLY_RANGE_LIMIT_MS;
    const unit = isHourly ? 'hour' : 'day';
    const campaignFilter = campaignId ? Prisma.sql`c.id = ${campaignId}` : Prisma.sql`TRUE`;

    const rows = await prisma.$queryRaw<Array<TotalsRow & { time: Date }>>(Prisma.sql`
      SELECT
        date_trunc(${unit}::text, m.bucket, 'UTC') AS time,
        SUM(m.impressions) AS impressions,
        SUM(m.clicks) AS clicks,
        SUM(m.completions) AS completions
      FROM metrics m
      JOIN campaigns c ON c.id = m.campaign_id
      WHERE m.bucket >= ${range.from} AND m.bucket < ${range.to}
        AND ${ownerSql(actor)} AND ${campaignFilter}
      GROUP BY 1
      ORDER BY 1
    `);

    return rows.map((row) => ({ time: row.time, ...toTotals(row) }));
  }

  /** Performance by slot, country, device and show in one GROUPING SETS query. */
  async getBreakdown(id: string, actor: Actor, range: DateRange): Promise<Breakdown> {
    await this.findOneOrFail(id, actor);

    const rows = await prisma.$queryRaw<
      Array<TotalsRow & { dimension: keyof Breakdown; key: string }>
    >(Prisma.sql`
      SELECT
        CASE
          WHEN GROUPING(m.slot) = 0 THEN 'slot'
          WHEN GROUPING(m.country) = 0 THEN 'country'
          WHEN GROUPING(m.device) = 0 THEN 'device'
          ELSE 'show'
        END AS dimension,
        COALESCE(m.slot::text, m.country, m.device::text, s.title) AS key,
        SUM(m.impressions) AS impressions,
        SUM(m.clicks) AS clicks,
        SUM(m.completions) AS completions
      FROM metrics m
      JOIN shows s ON s.id = m.show_id
      WHERE m.campaign_id = ${id} AND m.bucket >= ${range.from} AND m.bucket < ${range.to}
      GROUP BY GROUPING SETS ((m.slot), (m.country), (m.device), (s.title))
      ORDER BY impressions DESC
    `);

    const breakdown: Breakdown = { slot: [], country: [], device: [], show: [] };
    rows.forEach((row) => breakdown[row.dimension].push({ key: row.key, ...toTotals(row) }));
    return breakdown;
  }

  /**
   * Finds a campaign by ID, scoped to the actor.
   * Throws 404 if not found or if it belongs to another advertiser.
   */
  async findOneOrFail(campaignId: string, actor: Actor): Promise<Campaign> {
    const owner = ownerFilter(actor);
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, ...(owner ? { userId: owner } : {}) },
    });

    if (!campaign) {
      throw new AppError(404, `Campaign with id "${campaignId}" not found.`);
    }

    return campaign;
  }
}

export const campaignsService = new CampaignsService();
