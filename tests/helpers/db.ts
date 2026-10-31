/**
 * tests/helpers/db.ts
 *
 * Shared test database utilities.
 * Provides a dedicated Prisma client instance for test setup/teardown,
 * and helper functions to create test fixtures.
 */
import { PrismaClient, Role, CampaignStatus, AdSlot, Device } from '@prisma/client';
import type { Campaign, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

// Create a separate client for tests — avoids interfering with the app's singleton
export const testPrisma = new PrismaClient({
  datasources: { db: { url: process.env['TEST_DATABASE_URL'] as string } },
});

/** Wipes all data in dependency order */
export async function clearDatabase(): Promise<void> {
  await testPrisma.metric.deleteMany();
  await testPrisma.campaign.deleteMany();
  await testPrisma.show.deleteMany();
  await testPrisma.user.deleteMany();
}

/** Creates a test user with a known password and returns the record + plaintext password */
export async function createTestUser(
  overrides: Partial<{ email: string; password: string; role: Role }> = {},
): Promise<{ id: string; email: string; password: string; role: Role }> {
  const password = overrides.password ?? 'Test1234!';
  const passwordHash = await bcrypt.hash(password, 4); // Lower cost for test speed

  const user = await testPrisma.user.create({
    data: {
      email: overrides.email ?? `test-${Date.now()}@example.com`,
      passwordHash,
      role: overrides.role ?? Role.ADVERTISER,
    },
  });

  return { id: user.id, email: user.email, password, role: user.role };
}

export const createTestShow = (title = 'Test Show', genre = 'Drama') =>
  testPrisma.show.create({ data: { title, genre } });

/** A running campaign with sensible defaults. */
export function createTestCampaign(
  userId: string,
  overrides: Partial<Prisma.CampaignUncheckedCreateInput> = {},
): Promise<Campaign> {
  return testPrisma.campaign.create({
    data: {
      userId,
      title: 'Test Campaign',
      advertiser: 'Test Advertiser',
      status: CampaignStatus.ACTIVE,
      budgetCents: 1_000_000,
      cpmCents: 2000,
      impressionGoal: 1_000_000,
      startsAt: new Date(Date.now() - 86_400_000),
      endsAt: new Date(Date.now() + 86_400_000),
      ...overrides,
    },
  });
}

/** Adds metric rows, one hour apart, ending in the most recent full hour. */
export async function addMetrics(
  campaignId: string,
  showId: string,
  metrics: Array<{ impressions: number; clicks: number; completions?: number; country?: string }>,
): Promise<void> {
  const currentHour = Math.floor(Date.now() / 3_600_000) * 3_600_000;

  await testPrisma.metric.createMany({
    data: metrics.map((metric, index) => ({
      campaignId,
      showId,
      slot: AdSlot.MID_ROLL,
      country: metric.country ?? 'DE',
      device: Device.CTV,
      bucket: new Date(currentHour - (index + 1) * 3_600_000),
      impressions: metric.impressions,
      clicks: metric.clicks,
      completions: metric.completions ?? 0,
    })),
  });
}
