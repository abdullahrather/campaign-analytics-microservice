/**
 * src/modules/playback/traffic-quality.ts
 *
 * Spots traffic that shouldn't be billed. Rejected traffic is recorded with its
 * reason, so filtering can be reported, but it never counts as delivery.
 */
import { env } from '@/config/env';
import { redis } from '@/lib/redis';

export type FilterReason = 'BOT_USER_AGENT' | 'EXCESSIVE_REQUESTS' | 'IMPOSSIBLE_TIMING';

const BOT_USER_AGENT =
  /bot\b|crawl|spider|scrape|headless|slurp|curl\/|wget\/|python-requests|go-http-client|axios\//i;

export const isBot = (userAgent: string | undefined): boolean =>
  !userAgent || BOT_USER_AGENT.test(userAgent);

/** Nobody can finish an ad faster than it plays. */
export const isImpossibleCompletion = (
  servedAtSeconds: number,
  durationSeconds: number,
  now = Date.now(),
  minimumRatio = env.MIN_COMPLETION_RATIO,
): boolean => {
  const secondsSinceServed = now / 1000 - servedAtSeconds;
  return secondsSinceServed < durationSeconds * minimumRatio;
};

/** Counts this viewer's ad requests this minute, and says if there are too many. */
export const isExcessive = async (viewerId: string): Promise<boolean> => {
  const key = `viewer-rate:${viewerId}:${Math.floor(Date.now() / 60_000)}`;
  const [[, count] = []] = (await redis.pipeline().incr(key).expire(key, 120).exec()) ?? [];
  return Number(count) > env.MAX_ADS_PER_VIEWER_MINUTE;
};
