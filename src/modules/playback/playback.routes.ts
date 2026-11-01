/**
 * src/modules/playback/playback.routes.ts
 *
 * Public endpoints used by video players. A VAST response carries signed links,
 * so a player can report what happened to the ad it was served, without holding
 * a secret and without being able to invent events for another campaign.
 */
import crypto from 'crypto';
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { env } from '@/config/env';
import { handle } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { storage } from '@/lib/storage';
import { AppError } from '@/middleware/errorHandler';
import {
  adDecisionQuerySchema,
  type AdDecisionQuery,
  type AdEvent,
} from '@/modules/delivery/delivery.schema';
import { deliveryService } from '@/modules/delivery/delivery.service';
import { buildVast, emptyVast } from './vast';

const TRACKING_AUDIENCE = 'ad-tracking';
const TRACKING_TTL = '1h';
const MAX_REMEMBERED_EVENTS = 100_000;

type TrackedEvent = AdEvent['type'];

const EVENTS: Record<string, TrackedEvent> = {
  impression: 'IMPRESSION',
  firstQuartile: 'FIRST_QUARTILE',
  midpoint: 'MIDPOINT',
  thirdQuartile: 'THIRD_QUARTILE',
  complete: 'COMPLETION',
};

interface TrackingClaims extends AdDecisionQuery {
  campaignId: string;
  creativeId: string;
  jti: string;
}

const playbackRouter = Router();

const playerLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.PLAYER_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests.' },
});

playbackRouter.use(['/vast', '/track', '/click', '/player'], playerLimiter);

// One ad view counts each event once, even if a player sends it again.
const remembered = new Set<string>();

const firstTime = (key: string): boolean => {
  if (remembered.has(key)) return false;
  if (remembered.size >= MAX_REMEMBERED_EVENTS) remembered.clear();
  remembered.add(key);
  return true;
};

const originOf = (req: Request): string => `${req.protocol}://${req.get('host') ?? 'localhost'}`;

const signTracking = (claims: Omit<TrackingClaims, 'jti'>): string =>
  jwt.sign(claims, env.JWT_SECRET, {
    audience: TRACKING_AUDIENCE,
    expiresIn: TRACKING_TTL,
    jwtid: crypto.randomUUID(),
  });

const readTracking = (token: unknown): TrackingClaims => {
  try {
    if (typeof token !== 'string') throw new Error('Missing token.');
    return jwt.verify(token, env.JWT_SECRET, {
      audience: TRACKING_AUDIENCE,
    }) as unknown as TrackingClaims;
  } catch {
    throw new AppError(400, 'This tracking link is invalid or has expired.');
  }
};

const record = (claims: TrackingClaims, type: TrackedEvent): Promise<unknown> =>
  deliveryService.ingest([
    {
      type,
      campaignId: claims.campaignId,
      showId: claims.showId,
      slot: claims.slot,
      country: claims.country,
      device: claims.device,
    },
  ]);

/** What the demo streaming site can play. */
playbackRouter.get(
  '/player/catalogue',
  handle(async (_req, res) => {
    const shows = await prisma.show.findMany({
      where: { videoKey: { not: '' } },
      orderBy: { title: 'asc' },
      select: { id: true, title: true, genre: true },
    });

    res.status(200).json({
      status: 'success',
      data: shows.map((show) => ({
        ...show,
        videoUrl: `/media/shows/${show.id}/video`,
        posterUrl: `/media/shows/${show.id}/poster`,
      })),
    });
  }),
);

playbackRouter.get(
  '/media/shows/:id/:file',
  handle(async (req, res) => {
    const file = { video: 'episode.mp4', poster: 'poster.jpg' }[req.params['file'] as string];
    const show = await prisma.show.findUnique({ where: { id: req.params['id'] as string } });
    if (!show?.videoKey || !file) throw new AppError(404, 'Not found.');

    res.sendFile(storage.localPath(`shows/${show.id}/${file}`), { dotfiles: 'allow' });
  }),
);

/** Asks for an ad in VAST. An empty VAST means nothing can run in this break. */
playbackRouter.get(
  '/vast',
  handle(async (req, res) => {
    const query = adDecisionQuerySchema.parse(req.query);
    const decision = await deliveryService.decide(query, { requireCreative: true });
    res.type('application/xml');

    if (!decision?.creative) {
      res.status(200).send(emptyVast());
      return;
    }

    const { creative } = decision;
    const token = signTracking({
      ...query,
      campaignId: decision.campaignId,
      creativeId: creative.id,
    });
    const origin = originOf(req);
    const track = (event: string): string => `${origin}/track/${event}?t=${token}`;

    res.status(200).send(
      buildVast({
        id: creative.id,
        title: creative.name,
        advertiser: decision.advertiser,
        durationSeconds: creative.durationSeconds,
        width: creative.width,
        height: creative.height,
        videoUrl: `${origin}/media/creatives/${creative.id}/video`,
        clickThroughUrl: `${origin}/click?t=${token}`,
        impressionUrl: track('impression'),
        trackingUrls: {
          start: track('start'),
          firstQuartile: track('firstQuartile'),
          midpoint: track('midpoint'),
          thirdQuartile: track('thirdQuartile'),
          complete: track('complete'),
        },
      }),
    );
  }),
);

playbackRouter.get(
  '/track/:event',
  handle(async (req, res) => {
    const name = req.params['event'] as string;
    const claims = readTracking(req.query['t']);

    // "start" duplicates the impression, so it's accepted but not counted.
    if (name !== 'start') {
      const type = EVENTS[name];
      if (!type) throw new AppError(404, 'Unknown event.');
      if (firstTime(`${claims.jti}:${name}`)) await record(claims, type);
    }

    res.status(204).end();
  }),
);

/** Records the click, then sends the viewer to the advertiser's page. */
playbackRouter.get(
  '/click',
  handle(async (req, res) => {
    const claims = readTracking(req.query['t']);
    const creative = await prisma.creative.findUnique({ where: { id: claims.creativeId } });
    if (!creative) throw new AppError(404, 'This ad is no longer available.');

    if (firstTime(`${claims.jti}:click`)) await record(claims, 'CLICK');
    res.redirect(302, creative.clickUrl);
  }),
);

export { playbackRouter };
