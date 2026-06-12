/**
 * prisma/seed.ts
 *
 * Seeds the database with a demo Admin, a demo Advertiser, and sample
 * campaigns with metrics. Run via: npm run db:seed
 */
import { PrismaClient, Role, CampaignStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.info('🌱  Starting database seed...');

  // ── Clean slate ────────────────────────────────────────────────────────────
  await prisma.metric.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.user.deleteMany();

  // ── Users ──────────────────────────────────────────────────────────────────
  const adminPassword = await bcrypt.hash('admin1234', 12);
  const advertiserPassword = await bcrypt.hash('advert1234', 12);

  const admin = await prisma.user.create({
    data: {
      email: 'admin@example.com',
      passwordHash: adminPassword,
      role: Role.ADMIN,
    },
  });

  const advertiser = await prisma.user.create({
    data: {
      email: 'advertiser@example.com',
      passwordHash: advertiserPassword,
      role: Role.ADVERTISER,
    },
  });

  console.info(`✅  Created users: ${admin.email}, ${advertiser.email}`);

  // ── Campaigns + Metrics ────────────────────────────────────────────────────
  const campaignA = await prisma.campaign.create({
    data: {
      userId: advertiser.id,
      title: 'Summer Sale 2024',
      status: CampaignStatus.ACTIVE,
    },
  });

  const campaignB = await prisma.campaign.create({
    data: {
      userId: advertiser.id,
      title: 'Brand Awareness Q3',
      status: CampaignStatus.PAUSED,
    },
  });

  // Insert metrics in bulk for efficiency
  await prisma.metric.createMany({
    data: [
      { campaignId: campaignA.id, views: 1500, clicks: 75 },
      { campaignId: campaignA.id, views: 2000, clicks: 120 },
      { campaignId: campaignA.id, views: 1800, clicks: 90 },
      { campaignId: campaignB.id, views: 500,  clicks: 20 },
      { campaignId: campaignB.id, views: 750,  clicks: 35 },
    ],
  });

  console.info(`✅  Created 2 campaigns with metrics.`);
  console.info('');
  console.info('─── Seed credentials ──────────────────────────────');
  console.info('  Admin:      admin@example.com      / admin1234');
  console.info('  Advertiser: advertiser@example.com / advert1234');
  console.info('───────────────────────────────────────────────────');
}

main()
  .catch((error: unknown) => {
    console.error('❌  Seed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
