/**
 * tests/campaigns.analytics.test.ts
 *
 * Integration test suite for the Analytics endpoint.
 *
 * Strategy:
 *  - Uses a real PostgreSQL test database (not mocks) for authentic coverage.
 *  - Each test group runs against a clean database slice (clearDatabase in beforeEach).
 *  - Supertest binds the app to an ephemeral port — no port conflicts.
 *  - Tests are ordered to cover: happy path, edge cases, and authentication.
 *
 * The key assertion: aggregated totals MUST match the exact values inserted,
 * proving the SQL query is correct and no N+1 loops are silently accumulating.
 */
import request from 'supertest';
import { CampaignStatus } from '@prisma/client';
import { createApp } from '@/app';
import {
  testPrisma,
  clearDatabase,
  createTestUser,
  createTestCampaignWithMetrics,
} from './helpers/db';

// Force the Prisma singleton in app.ts to also point at the test DB
process.env['DATABASE_URL'] =
  process.env['TEST_DATABASE_URL'] ??
  'postgresql://postgres:secret@localhost:5432/campaign_analytics_test?schema=public';

const app = createApp();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Logs in and returns a Bearer token string ready to be put in an Authorization header */
async function getAuthToken(email: string, password: string): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });

  if (res.status !== 200) {
    throw new Error(`Login failed: ${JSON.stringify(res.body)}`);
  }

  const token = (res.body as { data: { token: string } }).data.token;
  return `Bearer ${token}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('GET /campaigns/analytics', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  // ── Happy Path ─────────────────────────────────────────────────────────────

  describe('Happy path — correct aggregation', () => {
    it('should return correct aggregated views and clicks for each campaign', async () => {
      // ── ARRANGE ────────────────────────────────────────────────────────────
      const user = await createTestUser({ email: 'analytics-user@test.com' });

      // Campaign A: 3 metric rows
      // Expected totalViews: 1500 + 2000 + 1800 = 5300
      // Expected totalClicks:   75 +  120 +   90 =  285
      await createTestCampaignWithMetrics(user.id, 'Summer Sale 2024', CampaignStatus.ACTIVE, [
        { views: 1500, clicks: 75 },
        { views: 2000, clicks: 120 },
        { views: 1800, clicks: 90 },
      ]);

      // Campaign B: 2 metric rows
      // Expected totalViews:  500 + 750 = 1250
      // Expected totalClicks:  20 +  35 =   55
      await createTestCampaignWithMetrics(user.id, 'Brand Awareness Q3', CampaignStatus.PAUSED, [
        { views: 500, clicks: 20 },
        { views: 750, clicks: 35 },
      ]);

      const token = await getAuthToken(user.email, user.password);

      // ── ACT ────────────────────────────────────────────────────────────────
      const res = await request(app)
        .get('/campaigns/analytics')
        .set('Authorization', token);

      // ── ASSERT ─────────────────────────────────────────────────────────────
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');

      const data = res.body.data as Array<{
        id: string;
        title: string;
        status: string;
        totalViews: number;
        totalClicks: number;
      }>;

      expect(data).toHaveLength(2);

      const campaignA = data.find((c) => c.title === 'Summer Sale 2024');
      const campaignB = data.find((c) => c.title === 'Brand Awareness Q3');

      expect(campaignA).toBeDefined();
      expect(campaignA?.totalViews).toBe(5300);
      expect(campaignA?.totalClicks).toBe(285);
      expect(campaignA?.status).toBe('ACTIVE');

      expect(campaignB).toBeDefined();
      expect(campaignB?.totalViews).toBe(1250);
      expect(campaignB?.totalClicks).toBe(55);
      expect(campaignB?.status).toBe('PAUSED');
    });

    it('should include campaigns with ZERO metrics (totalViews=0, totalClicks=0)', async () => {
      // ── ARRANGE ────────────────────────────────────────────────────────────
      // A campaign with NO metric rows — tests the COALESCE(SUM(...), 0) logic
      const user = await createTestUser({ email: 'zero-metrics@test.com' });
      await createTestCampaignWithMetrics(user.id, 'Empty Campaign', CampaignStatus.ACTIVE, []);

      const token = await getAuthToken(user.email, user.password);

      // ── ACT ────────────────────────────────────────────────────────────────
      const res = await request(app)
        .get('/campaigns/analytics')
        .set('Authorization', token);

      // ── ASSERT ─────────────────────────────────────────────────────────────
      expect(res.status).toBe(200);

      const data = res.body.data as Array<{ title: string; totalViews: number; totalClicks: number }>;
      expect(data).toHaveLength(1);
      expect(data[0]?.totalViews).toBe(0);
      expect(data[0]?.totalClicks).toBe(0);
    });

    it('should return an empty array when the user has no campaigns', async () => {
      // ── ARRANGE ────────────────────────────────────────────────────────────
      const user = await createTestUser({ email: 'no-campaigns@test.com' });
      const token = await getAuthToken(user.email, user.password);

      // ── ACT ────────────────────────────────────────────────────────────────
      const res = await request(app)
        .get('/campaigns/analytics')
        .set('Authorization', token);

      // ── ASSERT ─────────────────────────────────────────────────────────────
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  // ── Data Isolation ─────────────────────────────────────────────────────────

  describe('Data isolation — only own campaigns returned', () => {
    it('should NOT return campaigns belonging to another user', async () => {
      // ── ARRANGE ────────────────────────────────────────────────────────────
      const userA = await createTestUser({ email: 'user-a@test.com' });
      const userB = await createTestUser({ email: 'user-b@test.com' });

      // UserA has 2 campaigns
      await createTestCampaignWithMetrics(userA.id, 'UserA Campaign 1', CampaignStatus.ACTIVE, [
        { views: 100, clicks: 10 },
      ]);
      await createTestCampaignWithMetrics(userA.id, 'UserA Campaign 2', CampaignStatus.ACTIVE, [
        { views: 200, clicks: 20 },
      ]);

      // UserB has 1 campaign
      await createTestCampaignWithMetrics(userB.id, 'UserB Campaign', CampaignStatus.ACTIVE, [
        { views: 9999, clicks: 999 },
      ]);

      // Authenticate as UserA
      const tokenA = await getAuthToken(userA.email, userA.password);

      // ── ACT ────────────────────────────────────────────────────────────────
      const res = await request(app)
        .get('/campaigns/analytics')
        .set('Authorization', tokenA);

      // ── ASSERT ─────────────────────────────────────────────────────────────
      expect(res.status).toBe(200);

      const data = res.body.data as Array<{ title: string }>;
      expect(data).toHaveLength(2);
      expect(data.map((c) => c.title)).not.toContain('UserB Campaign');
    });
  });

  // ── Authentication ─────────────────────────────────────────────────────────

  describe('Authentication guard', () => {
    it('should return 401 when no Authorization header is provided', async () => {
      const res = await request(app).get('/campaigns/analytics');

      expect(res.status).toBe(401);
      expect(res.body.status).toBe('error');
    });

    it('should return 401 when a malformed token is provided', async () => {
      const res = await request(app)
        .get('/campaigns/analytics')
        .set('Authorization', 'Bearer this.is.not.a.valid.jwt');

      expect(res.status).toBe(401);
      expect(res.body.status).toBe('error');
    });

    it('should return 401 when the Authorization header is missing Bearer prefix', async () => {
      const res = await request(app)
        .get('/campaigns/analytics')
        .set('Authorization', 'just-a-token-without-bearer');

      expect(res.status).toBe(401);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth endpoint tests
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('should return a JWT token with correct credentials', async () => {
    const user = await createTestUser({ email: 'login-test@test.com', password: 'MyPass1234!' });

    const res = await request(app)
      .post('/auth/login')
      .send({ email: user.email, password: user.password });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data).toHaveProperty('token');
    expect(typeof res.body.data.token).toBe('string');
    expect(res.body.data.token.split('.')).toHaveLength(3); // JWT = header.payload.signature
  });

  it('should return 401 with wrong password', async () => {
    const user = await createTestUser({ email: 'wrong-pass@test.com' });

    const res = await request(app)
      .post('/auth/login')
      .send({ email: user.email, password: 'WrongPassword!' });

    expect(res.status).toBe(401);
    expect(res.body.status).toBe('error');
  });

  it('should return 401 for non-existent email', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'SomePass1234' });

    expect(res.status).toBe(401);
  });

  it('should return 422 when body fails validation', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'not-an-email', password: 'short' });

    expect(res.status).toBe(422);
    expect(res.body.errors).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Campaigns CRUD tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Campaigns CRUD', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  describe('GET /campaigns', () => {
    it('should return a paginated list of the user own campaigns', async () => {
      const user = await createTestUser({ email: 'list-test@test.com' });

      await createTestCampaignWithMetrics(user.id, 'Campaign One', CampaignStatus.ACTIVE, []);
      await createTestCampaignWithMetrics(user.id, 'Campaign Two', CampaignStatus.PAUSED, []);

      const token = await getAuthToken(user.email, user.password);
      const res = await request(app).get('/campaigns').set('Authorization', token);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta).toMatchObject({
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('should support filtering by status', async () => {
      const user = await createTestUser({ email: 'filter-test@test.com' });

      await createTestCampaignWithMetrics(user.id, 'Active Camp', CampaignStatus.ACTIVE, []);
      await createTestCampaignWithMetrics(user.id, 'Paused Camp', CampaignStatus.PAUSED, []);

      const token = await getAuthToken(user.email, user.password);
      const res = await request(app)
        .get('/campaigns?status=ACTIVE')
        .set('Authorization', token);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].status).toBe('ACTIVE');
    });
  });

  describe('POST /campaigns', () => {
    it('should create a new campaign and return 201', async () => {
      const user = await createTestUser({ email: 'create-test@test.com' });
      const token = await getAuthToken(user.email, user.password);

      const res = await request(app)
        .post('/campaigns')
        .set('Authorization', token)
        .send({ title: 'My New Campaign', status: 'ACTIVE' });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data).toMatchObject({
        title: 'My New Campaign',
        status: 'ACTIVE',
        userId: user.id,
      });
      expect(res.body.data.id).toBeDefined();
    });

    it('should return 422 if title is missing', async () => {
      const user = await createTestUser({ email: 'validation-test@test.com' });
      const token = await getAuthToken(user.email, user.password);

      const res = await request(app)
        .post('/campaigns')
        .set('Authorization', token)
        .send({ status: 'ACTIVE' });

      expect(res.status).toBe(422);
    });

    it('should return 422 if title is too short', async () => {
      const user = await createTestUser({ email: 'short-title@test.com' });
      const token = await getAuthToken(user.email, user.password);

      const res = await request(app)
        .post('/campaigns')
        .set('Authorization', token)
        .send({ title: 'AB' }); // Less than 3 chars

      expect(res.status).toBe(422);
    });
  });
});
