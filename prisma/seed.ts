/**
 * prisma/seed.ts
 *
 * Seeds a fictional streaming ad business: users, shows, campaigns in different
 * states, and 30 days of hourly metrics. Run via: npm run db:seed
 * With --if-empty it leaves an existing database alone. With --if-stale it also
 * refreshes data older than a week, which keeps the public demo's dates current.
 *
 * In demo mode only the guest account has a known password.
 */
import {
  PrismaClient,
  Role,
  OrganisationRole,
  CampaignStatus,
  AdSlot,
  Device,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const COUNTRIES = ['DE', 'FR', 'IT', 'ES', 'NL', 'AT', 'SE'];
const DEVICES = [Device.CTV, Device.CTV, Device.CTV, Device.MOBILE, Device.WEB, Device.TABLET];
const SLOTS = [AdSlot.PRE_ROLL, AdSlot.MID_ROLL, AdSlot.MID_ROLL, AdSlot.POST_ROLL];
const CLICK_RATE: Record<Device, number> = { CTV: 0.003, MOBILE: 0.02, WEB: 0.014, TABLET: 0.011 };
const COMPLETION_RATE: Record<AdSlot, number> = { PRE_ROLL: 0.78, MID_ROLL: 0.93, POST_ROLL: 0.55 };

const SHOWS = [
  { title: 'Harbour Lights', genre: 'Drama' },
  { title: 'The Alpine Files', genre: 'Crime' },
  { title: 'Kitchen Rivals', genre: 'Reality' },
  { title: 'Matchday Live', genre: 'Sports' },
  { title: 'Northern Skies', genre: 'Documentary' },
  { title: 'Little Explorers', genre: 'Kids' },
];

// Fictional advertisers. Delivery is how far along the impression goal the seed leaves them.
const CAMPAIGNS = [
  {
    title: 'Winter Coats Launch',
    advertiser: 'Nordkap Outdoor',
    cpm: 1800,
    budget: 9_000_000,
    goal: 5_000_000,
    from: -20,
    to: 25,
    delivery: 0.44,
    countries: ['DE', 'AT', 'SE'],
    genres: [],
    devices: [],
    slots: [],
  },
  {
    title: 'Electric City Car',
    advertiser: 'Volta Motors',
    cpm: 3200,
    budget: 19_200_000,
    goal: 6_000_000,
    from: -14,
    to: 16,
    delivery: 0.3,
    countries: ['DE', 'FR', 'NL'],
    genres: ['Drama', 'Crime', 'Documentary'],
    devices: [Device.CTV],
    slots: [AdSlot.PRE_ROLL, AdSlot.MID_ROLL],
  },
  {
    title: 'Matchday Fan Bundle',
    advertiser: 'Goal Telecom',
    cpm: 2600,
    budget: 10_400_000,
    goal: 4_000_000,
    from: -10,
    to: 20,
    delivery: 0.42,
    countries: [],
    genres: ['Sports'],
    devices: [],
    slots: [AdSlot.MID_ROLL],
  },
  {
    title: 'Family Breakfast',
    advertiser: 'Sonnenhof Foods',
    cpm: 1400,
    budget: 4_200_000,
    goal: 3_000_000,
    from: -25,
    to: 5,
    delivery: 0.6,
    countries: ['DE', 'AT'],
    genres: ['Kids', 'Reality'],
    devices: [],
    slots: [],
  },
  {
    title: 'Mediterranean Escapes',
    advertiser: 'Azul Travel',
    cpm: 2200,
    budget: 6_600_000,
    goal: 3_000_000,
    from: -9,
    to: 40,
    delivery: 0.22,
    countries: ['IT', 'ES', 'FR'],
    genres: [],
    devices: [],
    slots: [AdSlot.PRE_ROLL],
  },
  {
    title: 'Spring Teaser',
    advertiser: 'Nordkap Outdoor',
    cpm: 1600,
    budget: 3_200_000,
    goal: 2_000_000,
    from: -6,
    to: 30,
    delivery: 0.1,
    countries: [],
    genres: [],
    devices: [],
    slots: [],
    status: CampaignStatus.PAUSED,
  },
  {
    title: 'Autumn Sale',
    advertiser: 'Casa Mobili',
    cpm: 1500,
    budget: 3_000_000,
    goal: 2_000_000,
    from: -30,
    to: -4,
    delivery: 1,
    countries: ['IT', 'ES'],
    genres: [],
    devices: [],
    slots: [],
    status: CampaignStatus.COMPLETED,
  },
];

/** Small seeded generator, so every seed produces the same demo story. */
const createRandom = (seed: number) => (): number => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

/** Evening prime time, with a smaller lunchtime bump. */
const audienceAt = (hour: number): number =>
  0.12 + Math.exp(-((hour - 20.5) ** 2) / 8) + 0.3 * Math.exp(-((hour - 12.5) ** 2) / 6);

async function main(): Promise<void> {
  const isDemo = process.env['DEMO_MODE'] === 'true';
  if (process.env['NODE_ENV'] === 'production' && !isDemo) {
    throw new Error('Refusing to seed production.');
  }
  if (
    process.argv.includes('--if-empty') &&
    (await prisma.user.count({ where: { email: 'analyst@example.com' } })) > 0
  ) {
    return;
  }
  if (process.argv.includes('--if-stale')) {
    const recent = await prisma.campaign.count({
      where: { createdAt: { gt: new Date(Date.now() - 7 * DAY) } },
    });
    if (recent > 0) return;
  }

  const password = (demoPassword: string): Promise<string> =>
    bcrypt.hash(isDemo ? randomBytes(24).toString('hex') : demoPassword, 12);

  console.info('Seeding demo data...');
  await prisma.metric.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.show.deleteMany();
  await prisma.organisation.deleteMany();
  await prisma.user.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.capturedEmail.deleteMany();

  const verified = new Date();

  const person = async (
    email: string,
    name: string,
    demoPassword: string,
    role: Role = Role.ADVERTISER,
  ): Promise<{ id: string }> =>
    prisma.user.create({
      data: {
        email,
        name,
        role,
        passwordHash: await password(demoPassword),
        emailVerifiedAt: verified,
      },
    });

  const owner = await person('advertiser@example.com', 'Olivia Owner', 'advert1234');
  const manager = await person('manager@example.com', 'Max Manager', 'manager1234');
  const analyst = await person('analyst@example.com', 'Anna Analyst', 'analyst1234');
  const rival = await person('rival@example.com', 'Rico Rival', 'rival1234');
  const admin = await person('admin@example.com', 'Ada Admin', 'admin1234', Role.ADMIN);

  const brightline = await prisma.organisation.create({
    data: {
      name: 'Brightline Media',
      memberships: {
        create: [
          { userId: owner.id, role: OrganisationRole.OWNER },
          { userId: manager.id, role: OrganisationRole.MANAGER },
          { userId: analyst.id, role: OrganisationRole.ANALYST },
        ],
      },
    },
  });
  const casa = await prisma.organisation.create({
    data: {
      name: 'Casa Creative',
      memberships: { create: { userId: rival.id, role: OrganisationRole.OWNER } },
    },
  });
  await prisma.organisation.create({
    data: {
      name: 'Platform Team',
      memberships: { create: { userId: admin.id, role: OrganisationRole.OWNER } },
    },
  });

  await prisma.user.create({
    data: {
      email: 'guest@example.com',
      name: 'Guest',
      passwordHash: await bcrypt.hash('guest-demo', 12),
      role: Role.GUEST,
      emailVerifiedAt: verified,
    },
  });

  await prisma.show.createMany({ data: SHOWS });
  const shows = await prisma.show.findMany();

  const random = createRandom(42);
  const now = Date.now();
  const nowHour = Math.floor(now / HOUR) * HOUR;
  const rows: Prisma.MetricCreateManyInput[] = [];

  for (const spec of CAMPAIGNS) {
    const startsAt = new Date(now + spec.from * DAY);
    const endsAt = new Date(now + spec.to * DAY);
    const campaign = await prisma.campaign.create({
      data: {
        organisationId: spec.advertiser === 'Casa Mobili' ? casa.id : brightline.id,
        userId: spec.advertiser === 'Casa Mobili' ? rival.id : owner.id,
        title: spec.title,
        advertiser: spec.advertiser,
        status: spec.status ?? CampaignStatus.ACTIVE,
        budgetCents: spec.budget,
        cpmCents: spec.cpm,
        impressionGoal: spec.goal,
        startsAt,
        endsAt,
        targetCountries: spec.countries,
        targetGenres: spec.genres,
        targetDevices: spec.devices,
        targetSlots: spec.slots,
      },
    });

    const eligibleShows = shows.filter(
      (show) => spec.genres.length === 0 || spec.genres.includes(show.genre),
    );
    const countries = spec.countries.length > 0 ? spec.countries : COUNTRIES;
    const devices = spec.devices.length > 0 ? spec.devices : DEVICES;
    const slots = spec.slots.length > 0 ? spec.slots : SLOTS;

    const firstHour = Math.ceil(startsAt.getTime() / HOUR) * HOUR;
    const lastHour = Math.min(endsAt.getTime(), nowHour);
    const hours: number[] = [];
    for (let hour = firstHour; hour <= lastHour; hour += HOUR) hours.push(hour);

    const weights = hours.map((hour) => audienceAt(new Date(hour).getUTCHours()));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const delivered = spec.goal * spec.delivery;

    hours.forEach((hour, index) => {
      const hourImpressions = (delivered * (weights[index] as number)) / totalWeight;
      const merged = new Map<string, Prisma.MetricCreateManyInput>();

      // Each hour spreads over a handful of show, slot, country and device mixes.
      for (let mix = 0; mix < 4; mix += 1) {
        const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)] as T;
        const show = pick(eligibleShows);
        const slot = pick(slots);
        const country = pick(countries);
        const device = pick(devices);
        const impressions = Math.round((hourImpressions / 4) * (0.7 + random() * 0.6));

        const key = [show.id, slot, country, device].join('|');
        const row = merged.get(key) ?? {
          campaignId: campaign.id,
          showId: show.id,
          slot,
          country,
          device,
          bucket: new Date(hour),
          impressions: 0,
          clicks: 0,
          completions: 0,
        };
        row.impressions = (row.impressions ?? 0) + impressions;
        row.clicks = (row.clicks ?? 0) + Math.round(impressions * CLICK_RATE[device]);
        row.completions = (row.completions ?? 0) + Math.round(impressions * COMPLETION_RATE[slot]);
        merged.set(key, row);
      }

      rows.push(...merged.values());
    });
  }

  for (let start = 0; start < rows.length; start += 5000) {
    await prisma.metric.createMany({ data: rows.slice(start, start + 5000) });
  }

  console.info(`Created ${CAMPAIGNS.length} campaigns and ${rows.length} hourly metric rows.`);
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
