/**
 * tests/helpers/db.ts
 *
 * Shared test database utilities.
 * Provides a dedicated Prisma client instance for test setup/teardown,
 * and helper functions to create test fixtures.
 */
import { PrismaClient, Role, CampaignStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

// Create a separate client for tests — avoids interfering with the app's singleton
export const testPrisma = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env['TEST_DATABASE_URL'] ??
        'postgresql://postgres:secret@localhost:5432/campaign_analytics_test?schema=public',
    },
  },
});

/** Wipes all data in dependency order (metrics → campaigns → users) */
export async function clearDatabase(): Promise<void> {
  await testPrisma.metric.deleteMany();
  await testPrisma.campaign.deleteMany();
  await testPrisma.user.deleteMany();
}

/** Creates a test user with a known password and returns the record + plaintext password */
export async function createTestUser(
  overrides: Partial<{ email: string; password: string; role: Role }> = {},
): Promise<{ id: string; email: string; password: string; role: Role }> {
  const password = overrides.password ?? 'Test1234!';
  const passwordHash = await bcrypt.hash(password, 10); // Lower cost for test speed

  const user = await testPrisma.user.create({
    data: {
      email: overrides.email ?? `test-${Date.now()}@example.com`,
      passwordHash,
      role: overrides.role ?? Role.ADVERTISER,
    },
  });

  return { id: user.id, email: user.email, password, role: user.role };
}

/** Creates a campaign and optional metric rows for a given user */
export async function createTestCampaignWithMetrics(
  userId: string,
  title: string,
  status: CampaignStatus,
  metrics: Array<{ views: number; clicks: number }>,
): Promise<{ campaignId: string }> {
  const campaign = await testPrisma.campaign.create({
    data: { userId, title, status },
  });

  if (metrics.length > 0) {
    await testPrisma.metric.createMany({
      data: metrics.map((m) => ({
        campaignId: campaign.id,
        views: m.views,
        clicks: m.clicks,
      })),
    });
  }

  return { campaignId: campaign.id };
}
