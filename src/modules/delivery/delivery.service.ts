/**
 * src/modules/delivery/delivery.service.ts
 *
 * Chooses which ad to play. Campaigns come from an in-memory snapshot and live
 * counts from Redis, so a decision never queries the database. Serving reserves
 * the ad atomically, which keeps a campaign under its cap at any concurrency.
 */
import type { Creative } from '@prisma/client';
import { counterKeys, redis } from '@/lib/redis';
import { decisionCache, type CachedCampaign } from './decision-cache';
import type { AdDecisionQuery } from './delivery.schema';

export interface AdDecision {
  campaignId: string;
  title: string;
  advertiser: string;
  /** Set when the caller asked for a campaign that has a playable ad. */
  creative?: Creative;
}

const matches = (allowed: Set<string>, value: string): boolean =>
  allowed.size === 0 || allowed.has(value);

/** How far along an even schedule a campaign is. Lower means further behind. */
const schedulePosition = (campaign: CachedCampaign, delivered: number, now: number): number => {
  const elapsed = (now - campaign.startsAt) / (campaign.endsAt - campaign.startsAt);
  return delivered / Math.max(campaign.impressionGoal * elapsed, 1);
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
    const { campaigns, genreByShow } = await decisionCache.get();
    const genre = genreByShow.get(query.showId);
    if (genre === undefined) return null;

    const now = Date.now();
    const eligible = campaigns.filter(
      (campaign) =>
        now >= campaign.startsAt &&
        now < campaign.endsAt &&
        matches(campaign.countries, query.country) &&
        matches(campaign.genres, genre) &&
        matches(campaign.devices, query.device) &&
        matches(campaign.slots, query.slot) &&
        (!requireCreative || campaign.creatives.length > 0),
    );
    if (eligible.length === 0) return null;

    const counts = await redis.mget(eligible.map(({ id }) => counterKeys(id).delivered));
    const ranked = eligible
      .map((campaign, index) => {
        const delivered = Number(counts[index] ?? 0);
        return { campaign, delivered, position: schedulePosition(campaign, delivered, now) };
      })
      .filter(({ campaign, delivered }) => delivered < campaign.cap)
      .sort((a, b) => a.position - b.position || b.campaign.cpmCents - a.campaign.cpmCents);

    // Another request may take the last ad first, so fall through to the next campaign.
    for (const { campaign } of ranked) {
      const keys = counterKeys(campaign.id);
      const reserved = await redis.reserveAd(
        keys.served,
        keys.delivered,
        keys.lastServed,
        campaign.cap,
        now,
      );
      if (!reserved) continue;

      const decision = {
        campaignId: campaign.id,
        title: campaign.title,
        advertiser: campaign.advertiser,
      };
      if (!requireCreative) return decision;

      const { creatives } = campaign;
      return {
        ...decision,
        creative: creatives[Math.floor(Math.random() * creatives.length)] as Creative,
      };
    }

    return null;
  }
}

export const deliveryService = new DeliveryService();
