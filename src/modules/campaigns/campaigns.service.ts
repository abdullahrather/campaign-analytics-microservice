/**
 * src/modules/campaigns/campaigns.service.ts
 *
 * Business logic for campaigns.
 *
 * Key architectural decision — getAnalytics():
 * ─────────────────────────────────────────────
 * A naive implementation would:
 *   1. SELECT all campaigns (1 query)
 *   2. For each campaign, SELECT SUM(views), SUM(clicks) (N queries)
 *
 * This is the classic N+1 problem. With 1000 campaigns that's 1001 DB
 * round-trips, causing severe latency and unnecessary load.
 *
 * Our solution uses a SINGLE raw SQL query with a LEFT JOIN and GROUP BY
 * to aggregate all metrics in one database round-trip. COALESCE handles
 * campaigns that have no metric rows yet (returns 0 instead of NULL).
 */
import { Prisma, CampaignStatus, type Campaign } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/middleware/errorHandler';
import type { CreateCampaignDto, ListCampaignsQuery } from './campaigns.schema';

// ── Typed return shapes ───────────────────────────────────────────────────────

export interface PaginatedCampaigns {
  data: Campaign[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface CampaignAnalyticsRow {
  id: string;
  title: string;
  status: CampaignStatus;
  createdAt: Date;
  totalViews: bigint;
  totalClicks: bigint;
}

export interface CampaignAnalyticsResult {
  id: string;
  title: string;
  status: CampaignStatus;
  createdAt: Date;
  totalViews: number;
  totalClicks: number;
}

// ── Service class ─────────────────────────────────────────────────────────────

export class CampaignsService {
  /**
   * Returns a paginated list of campaigns belonging to the given user.
   * Supports optional status filtering.
   */
  async listCampaigns(userId: string, query: ListCampaignsQuery): Promise<PaginatedCampaigns> {
    const where: Prisma.CampaignWhereInput = {
      userId,
      ...(query.status ? { status: query.status } : {}),
    };

    const skip = (query.page - 1) * query.limit;

    // Run count and data fetch in parallel — single round-trip, two queries
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

  /**
   * Creates a new campaign for the given user.
   */
  async createCampaign(userId: string, dto: CreateCampaignDto): Promise<Campaign> {
    return prisma.campaign.create({
      data: {
        userId,
        title: dto.title,
        status: dto.status,
      },
    });
  }

  /**
   * ╔══════════════════════════════════════════════════════════════════════════╗
   * ║                       ANALYTICS — N+1 SOLUTION                          ║
   * ╠══════════════════════════════════════════════════════════════════════════╣
   * ║                                                                          ║
   * ║  Instead of loading campaigns then querying metrics per-campaign,        ║
   * ║  we execute ONE SQL query:                                               ║
   * ║                                                                          ║
   * ║  SELECT                                                                  ║
   * ║    c.id,                                                                 ║
   * ║    c.title,                                                              ║
   * ║    c.status,                                                             ║
   * ║    c.created_at,                                                         ║
   * ║    COALESCE(SUM(m.views),  0) AS "totalViews",                          ║
   * ║    COALESCE(SUM(m.clicks), 0) AS "totalClicks"                          ║
   * ║  FROM campaigns c                                                        ║
   * ║  LEFT JOIN metrics m ON m.campaign_id = c.id                            ║
   * ║  WHERE c.user_id = $1                                                    ║
   * ║  GROUP BY c.id, c.title, c.status, c.created_at                        ║
   * ║  ORDER BY c.created_at DESC;                                             ║
   * ║                                                                          ║
   * ║  LEFT JOIN ensures campaigns with zero metrics still appear.             ║
   * ║  COALESCE converts NULL (no metrics) to 0.                               ║
   * ║  GROUP BY collapses the metric rows back into one row per campaign.      ║
   * ╚══════════════════════════════════════════════════════════════════════════╝
   */
  async getAnalytics(userId: string): Promise<CampaignAnalyticsResult[]> {
    // Prisma.sql tagged template safely parameterises the userId,
    // preventing SQL injection.
    const rows = await prisma.$queryRaw<CampaignAnalyticsRow[]>(Prisma.sql`
      SELECT
        c.id,
        c.title,
        c.status,
        c.created_at AS "createdAt",
        COALESCE(SUM(m.views),  0) AS "totalViews",
        COALESCE(SUM(m.clicks), 0) AS "totalClicks"
      FROM campaigns c
      LEFT JOIN metrics m ON m.campaign_id = c.id
      WHERE c.user_id = ${userId}
      GROUP BY c.id, c.title, c.status, c.created_at
      ORDER BY c.created_at DESC
    `);

    // PostgreSQL returns SUM() as BigInt; serialise to Number for JSON output.
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      createdAt: row.createdAt,
      totalViews: Number(row.totalViews),
      totalClicks: Number(row.totalClicks),
    }));
  }

  /**
   * Finds a campaign by ID, scoped to the requesting user.
   * Throws 404 if not found or if the campaign belongs to another user.
   */
  async findOneOrFail(campaignId: string, userId: string): Promise<Campaign> {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, userId },
    });

    if (!campaign) {
      throw new AppError(404, `Campaign with id "${campaignId}" not found.`);
    }

    return campaign;
  }
}

export const campaignsService = new CampaignsService();
