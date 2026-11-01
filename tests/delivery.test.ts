/**
 * tests/delivery.test.ts
 *
 * The event pipeline under the failures it exists to survive: replays, crashes,
 * races for the last ad, and invalid traffic.
 */
import crypto from 'crypto';
import request from 'supertest';
import { Role } from '@prisma/client';
import { createApp } from '@/app';
import { counterKeys, redis } from '@/lib/redis';
import { deliveryService } from '@/modules/delivery/delivery.service';
import { drainEvents, queueDepth } from '@/modules/delivery/event-queue';
import { isBot, isImpossibleCompletion } from '@/modules/playback/traffic-quality';
import {
  clearDatabase,
  createTestCampaign,
  createTestShow,
  createTestUser,
  testPrisma,
} from './helpers/db';

const app = createApp();
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const INGEST_KEY = process.env['INGEST_API_KEY'] as string;
const placement = { slot: 'PRE_ROLL', country: 'DE', device: 'CTV' } as const;

const event = (campaignId: string, showId: string, type = 'IMPRESSION', eventId?: string) => ({
  ...placement,
  eventId: eventId ?? crypto.randomUUID(),
  type,
  campaignId,
  showId,
  occurredAt: new Date().toISOString(),
});

const send = (events: unknown[], key = INGEST_KEY) =>
  request(app).post('/events').set('x-ingest-key', key).send({ events });

const totalImpressions = async (campaignId: string): Promise<number> => {
  const { _sum } = await testPrisma.metric.aggregate({
    where: { campaignId },
    _sum: { impressions: true },
  });
  return _sum.impressions ?? 0;
};

const setup = async (overrides = {}) => {
  const user = await createTestUser();
  const show = await createTestShow();
  const campaign = await createTestCampaign(user.id, overrides);
  return { user, show, campaign };
};

const playerToken = async (): Promise<string> => {
  const res = await request(app).post('/player/session');
  return (res.body as { data: { token: string } }).data.token;
};

beforeEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('Counting events exactly once', () => {
  it('counts a replayed batch once', async () => {
    const { show, campaign } = await setup();
    const batch = Array.from({ length: 50 }, () => event(campaign.id, show.id));

    const first = await send(batch);
    const replay = await send(batch);
    await drainEvents();

    expect(first.body.data).toEqual({ received: 50, accepted: 50, duplicates: 0 });
    expect(replay.body.data).toEqual({ received: 50, accepted: 0, duplicates: 50 });
    expect(await totalImpressions(campaign.id)).toBe(50);
  });

  it('counts a batch once when replays overlap', async () => {
    const { show, campaign } = await setup();
    const batch = Array.from({ length: 100 }, () => event(campaign.id, show.id));

    await Promise.all(Array.from({ length: 10 }, () => send(batch)));
    await drainEvents();

    expect(await totalImpressions(campaign.id)).toBe(100);
  });

  it('accepts only the new events in a partly repeated batch', async () => {
    const { show, campaign } = await setup();
    const old = event(campaign.id, show.id);
    await send([old]);

    const res = await send([old, event(campaign.id, show.id)]);
    await drainEvents();

    expect(res.body.data).toMatchObject({ accepted: 1, duplicates: 1 });
    expect(await totalImpressions(campaign.id)).toBe(2);
  });

  it('survives a worker dying after saving but before confirming', async () => {
    const { show, campaign } = await setup();
    await send(Array.from({ length: 20 }, () => event(campaign.id, show.id)));

    const pipeline = jest.spyOn(redis, 'pipeline').mockImplementationOnce(() => {
      throw new Error('Worker died');
    });
    await expect(drainEvents()).rejects.toThrow('Worker died');
    pipeline.mockRestore();

    expect(await totalImpressions(campaign.id)).toBe(20);
    expect(await queueDepth()).toBeGreaterThan(0);

    await drainEvents();

    expect(await totalImpressions(campaign.id)).toBe(20);
    expect(await queueDepth()).toBe(0);
  });

  it('keeps events when a save fails, and writes them on the next run', async () => {
    const { show, campaign } = await setup();
    await send(Array.from({ length: 10 }, () => event(campaign.id, show.id)));
    const failure = jest
      .spyOn(testPrismaFromApp(), '$transaction')
      .mockRejectedValueOnce(new Error('Database down'));

    await expect(drainEvents()).rejects.toThrow('Database down');
    failure.mockRestore();

    expect(await totalImpressions(campaign.id)).toBe(0);
    await drainEvents();
    expect(await totalImpressions(campaign.id)).toBe(10);
  });

  it('picks up entries left by a worker that stopped mid-batch', async () => {
    const { show, campaign } = await setup();
    await drainEvents();
    await send(Array.from({ length: 5 }, () => event(campaign.id, show.id)));
    await redis.xreadgroup(
      'GROUP',
      'rollup',
      'dead-worker',
      'COUNT',
      100,
      'STREAMS',
      'ad-events',
      '>',
    );

    await drainEvents();

    expect(await totalImpressions(campaign.id)).toBe(5);
    expect(await queueDepth()).toBe(0);
  });

  it('ignores events for campaigns that do not exist', async () => {
    const { show, campaign } = await setup();

    await send([event('missing-campaign', show.id), event(campaign.id, show.id)]);
    await drainEvents();

    expect(await testPrisma.metric.count()).toBe(1);
  });

  it('adds up every event type', async () => {
    const { show, campaign } = await setup();

    await send(
      ['IMPRESSION', 'FIRST_QUARTILE', 'MIDPOINT', 'THIRD_QUARTILE', 'COMPLETION', 'CLICK'].map(
        (type) => event(campaign.id, show.id, type),
      ),
    );
    await drainEvents();

    expect(await testPrisma.metric.findFirst()).toMatchObject({
      impressions: 1,
      firstQuartiles: 1,
      midpoints: 1,
      thirdQuartiles: 1,
      completions: 1,
      clicks: 1,
    });
  });

  it.each([
    ['no ID', { eventId: undefined }],
    ['no time', { occurredAt: undefined }],
    ['a time past the duplicate window', { occurredAt: '2000-01-01T00:00:00.000Z' }],
    ['a time in the future', { occurredAt: new Date(Date.now() + 3_600_000).toISOString() }],
  ])('rejects an event with %s', async (_name, change) => {
    const res = await send([{ ...event('a', 'b'), ...change }]);

    expect(res.status).toBe(422);
  });

  it('retries finishing a campaign when that update fails', async () => {
    const { show, campaign } = await setup({ impressionGoal: 3 });
    await send(Array.from({ length: 3 }, () => event(campaign.id, show.id)));
    const client = testPrismaFromApp();
    const original = client.$executeRaw.bind(client);
    let failed = false;
    const update = jest.spyOn(client, '$executeRaw').mockImplementation(((
      query: { sql?: string },
      ...values: unknown[]
    ) => {
      if (!failed && query.sql?.includes('UPDATE campaigns')) {
        failed = true;
        return Promise.reject(new Error('Database down'));
      }
      return (original as (...args: unknown[]) => unknown)(query, ...values);
    }) as never);

    await expect(drainEvents()).rejects.toThrow('Database down');
    update.mockRestore();
    expect(failed).toBe(true);
    expect(await totalImpressions(campaign.id)).toBe(3);
    await drainEvents();

    const stored = await testPrisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(stored.status).toBe('COMPLETED');
  });

  it('still finishes a campaign when its batch is redelivered after a crash', async () => {
    const { show, campaign } = await setup({ impressionGoal: 3 });
    await send(Array.from({ length: 3 }, () => event(campaign.id, show.id)));
    const pipeline = jest.spyOn(redis, 'pipeline').mockImplementationOnce(() => {
      throw new Error('Worker died');
    });

    await expect(drainEvents()).rejects.toThrow('Worker died');
    pipeline.mockRestore();
    await drainEvents();

    const stored = await testPrisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(stored.status).toBe('COMPLETED');
  });

  it('completes a campaign that reaches its goal', async () => {
    const { show, campaign } = await setup({ impressionGoal: 3 });

    await send(Array.from({ length: 3 }, () => event(campaign.id, show.id)));
    await drainEvents();

    const stored = await testPrisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(stored.status).toBe('COMPLETED');
  });

  it('reports a backlog to admins', async () => {
    const { show, campaign } = await setup();
    const admin = await createTestUser({ email: 'admin@test.com', role: Role.ADMIN });
    await send([event(campaign.id, show.id)]);
    const login = await request(app).post('/auth/login').send(admin);

    const res = await request(app)
      .get('/admin/stats')
      .set('Authorization', `Bearer ${login.body.data.token as string}`);

    expect(res.body.data).toMatchObject({ eventBacklog: 1, filteredLastDay: 0 });
  });
});

describe('Hard delivery limits', () => {
  const decide = (showId: string) => deliveryService.decide({ ...placement, showId });

  it('never serves past the goal, however many requests race', async () => {
    const { show, campaign } = await setup({ impressionGoal: 100 });

    const results = await Promise.all(Array.from({ length: 400 }, () => decide(show.id)));

    expect(results.filter((result) => result?.campaignId === campaign.id)).toHaveLength(100);
  });

  it('never serves past what the budget buys', async () => {
    const { show, campaign } = await setup({
      budgetCents: 1000,
      cpmCents: 2000,
      impressionGoal: 1_000_000,
    });

    const results = await Promise.all(Array.from({ length: 1000 }, () => decide(show.id)));

    expect(results.filter(Boolean)).toHaveLength(500);
    expect(results.find(Boolean)?.campaignId).toBe(campaign.id);
  });

  it('falls through to the next campaign when one runs out', async () => {
    const { user, show, campaign } = await setup({ impressionGoal: 2 });
    const backup = await createTestCampaign(user.id, { impressionGoal: 1_000_000 });

    const results = await Promise.all(Array.from({ length: 50 }, () => decide(show.id)));

    const served = (id: string) => results.filter((result) => result?.campaignId === id).length;
    expect(served(campaign.id)).toBeLessThanOrEqual(2);
    expect(served(campaign.id) + served(backup.id)).toBe(50);
  });

  it('counts delivery live, before it reaches the database', async () => {
    const { show, campaign } = await setup();
    await decide(show.id);

    await send(Array.from({ length: 7 }, () => event(campaign.id, show.id)));

    expect(await redis.get(counterKeys(campaign.id).delivered)).toBe('7');
    expect(await totalImpressions(campaign.id)).toBe(0);
  });

  it('starts counters from the database', async () => {
    const { show, campaign } = await setup({ impressionGoal: 100 });
    await testPrisma.metric.create({
      data: {
        ...placement,
        campaignId: campaign.id,
        showId: show.id,
        bucket: new Date(),
        impressions: 100,
      },
    });

    expect(await decide(show.id)).toBeNull();
  });

  it('gives back reservations that never became impressions', async () => {
    const { show, campaign } = await setup({ impressionGoal: 1 });
    await decide(show.id);
    expect(await decide(show.id)).toBeNull();

    await redis.set(counterKeys(campaign.id).lastServed, Date.now() - 200_000);

    expect((await decide(show.id))?.campaignId).toBe(campaign.id);
  });

  it('sees a paused campaign straight away', async () => {
    const { user, show, campaign } = await setup();
    const login = await request(app).post('/auth/login').send(user);
    await decide(show.id);

    await request(app)
      .patch(`/campaigns/${campaign.id}`)
      .set('Authorization', `Bearer ${login.body.data.token as string}`)
      .send({ status: 'PAUSED' });

    expect(await decide(show.id)).toBeNull();
  });
});

describe('Player tokens', () => {
  const vast = (showId: string, token?: string) =>
    request(app)
      .get('/vast')
      .set('User-Agent', BROWSER)
      .query({ ...placement, showId, ...(token ? { token } : {}) });

  it('requires a token for ads', async () => {
    const show = await createTestShow();

    expect((await vast(show.id)).status).toBe(401);
    expect((await vast(show.id, 'made-up')).status).toBe(401);
    expect((await vast(show.id, await playerToken())).status).toBe(200);
  });

  it('lets a publisher server exchange its key for a token', async () => {
    const show = await createTestShow();

    const refused = await request(app).post('/player-tokens').set('x-ingest-key', 'wrong');
    const issued = await request(app)
      .post('/player-tokens')
      .set('x-ingest-key', INGEST_KEY)
      .send({ viewerId: 'viewer-1' });

    expect(refused.status).toBe(401);
    expect(issued.status).toBe(201);
    expect(issued.body.data.expiresIn).toBe(900);
    expect((await vast(show.id, issued.body.data.token as string)).status).toBe(200);
  });

  it('does not accept a dashboard token', async () => {
    const show = await createTestShow();
    const user = await createTestUser();
    const login = await request(app).post('/auth/login').send(user);

    expect((await vast(show.id, login.body.data.token as string)).status).toBe(401);
  });
});

describe('Invalid traffic', () => {
  it('recognises bots but not browsers', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
    expect(isBot('Mozilla/5.0 HeadlessChrome/120.0')).toBe(true);
    expect(isBot('curl/8.4.0')).toBe(true);
    expect(isBot(undefined)).toBe(true);
    expect(isBot('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36')).toBe(
      false,
    );
  });

  it('refuses a completion faster than half the ad', () => {
    const servedAt = 1000;

    expect(isImpossibleCompletion(servedAt, 10, 1001_000, 0.5)).toBe(true);
    expect(isImpossibleCompletion(servedAt, 10, 1006_000, 0.5)).toBe(false);
  });

  it('gives bots no ad and records why', async () => {
    const { user, show, campaign } = await setup();
    await testPrisma.creative.create({
      data: {
        campaignId: campaign.id,
        createdById: user.id,
        name: 'Film',
        clickUrl: 'https://example.com',
        status: 'APPROVED',
        durationSeconds: 6,
      },
    });

    const res = await request(app)
      .get('/vast')
      .set('User-Agent', 'Googlebot/2.1')
      .query({ ...placement, showId: show.id, token: await playerToken() });
    await drainEvents();

    expect(res.text).toContain('<VAST version="4.2"/>');
    expect(await testPrisma.filteredEvent.findFirst()).toMatchObject({
      reason: 'BOT_USER_AGENT',
      count: 1,
    });
  });

  it('stops serving a viewer who asks too often', async () => {
    const { user, show, campaign } = await setup();
    await testPrisma.creative.create({
      data: {
        campaignId: campaign.id,
        createdById: user.id,
        name: 'Film',
        clickUrl: 'https://example.com',
        status: 'APPROVED',
        videoKey: 'x.mp4',
        durationSeconds: 6,
      },
    });
    const token = await playerToken();

    const responses = [];
    for (let attempt = 0; attempt < 25; attempt += 1) {
      responses.push(
        await request(app)
          .get('/vast')
          .set('User-Agent', BROWSER)
          .query({ ...placement, showId: show.id, token }),
      );
    }
    await drainEvents();

    expect(responses.filter(({ text }) => text.includes('<Ad ')).length).toBe(20);
    expect(await testPrisma.filteredEvent.findFirst()).toMatchObject({
      reason: 'EXCESSIVE_REQUESTS',
      count: 5,
    });
  });

  it('never bills bot traffic on tracking links, but reports it to the owner', async () => {
    const { user, show, campaign } = await setup();
    await testPrisma.creative.create({
      data: {
        campaignId: campaign.id,
        createdById: user.id,
        name: 'Film',
        clickUrl: 'https://example.com',
        status: 'APPROVED',
        videoKey: 'x.mp4',
        durationSeconds: 6,
      },
    });
    const { text } = await request(app)
      .get('/vast')
      .set('User-Agent', BROWSER)
      .query({ ...placement, showId: show.id, token: await playerToken() });
    const link = new URL(/<Impression[^>]*><!\[CDATA\[(.*?)\]\]>/.exec(text)?.[1] as string);

    await request(app)
      .get(link.pathname + link.search)
      .set('User-Agent', 'curl/8.4.0');
    await drainEvents();

    expect(await totalImpressions(campaign.id)).toBe(0);
    expect(await redis.get(counterKeys(campaign.id).delivered)).toBe('0');

    const login = await request(app).post('/auth/login').send(user);
    const report = await request(app)
      .get(`/campaigns/${campaign.id}/analytics`)
      .query({ from: new Date(Date.now() - 86_400_000).toISOString() })
      .set('Authorization', `Bearer ${login.body.data.token as string}`);
    expect(report.body.data.filtered).toEqual([{ reason: 'BOT_USER_AGENT', count: 1 }]);
  });
});

/** The app's Prisma client, which the worker uses. */
function testPrismaFromApp() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('@/lib/prisma') as typeof import('@/lib/prisma')).prisma;
}
