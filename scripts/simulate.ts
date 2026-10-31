/**
 * scripts/simulate.ts
 *
 * Plays the part of the streaming player: each tick, viewers reach ad breaks,
 * the ad decision endpoint picks a campaign, and the results are posted back as
 * one batch of events. Fictional traffic for demos — run via: npm run simulate
 */
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config({ quiet: true });

const API = `http://localhost:${process.env['PORT'] ?? 3000}`;
const KEY = process.env['INGEST_API_KEY'] ?? '';
const TICK_MS = 2000;
const AD_BREAKS_PER_TICK = 30;

const SLOTS = ['PRE_ROLL', 'PRE_ROLL', 'MID_ROLL', 'MID_ROLL', 'MID_ROLL', 'POST_ROLL'];
const COUNTRIES = ['DE', 'DE', 'DE', 'FR', 'FR', 'IT', 'ES', 'NL', 'AT', 'SE'];
const DEVICES = ['CTV', 'CTV', 'CTV', 'MOBILE', 'MOBILE', 'WEB', 'TABLET'];
const CLICK_RATE: Record<string, number> = { CTV: 0.003, MOBILE: 0.02, WEB: 0.014, TABLET: 0.011 };
const COMPLETION_RATE: Record<string, number> = { PRE_ROLL: 0.78, MID_ROLL: 0.93, POST_ROLL: 0.55 };

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)] as T;

interface AdEvent {
  type: 'IMPRESSION' | 'CLICK' | 'COMPLETION';
  campaignId: string;
  showId: string;
  slot: string;
  country: string;
  device: string;
}

async function serveAd(showIds: string[]): Promise<AdEvent[]> {
  const context = {
    showId: pick(showIds),
    slot: pick(SLOTS),
    country: pick(COUNTRIES),
    device: pick(DEVICES),
  };

  const response = await fetch(`${API}/ad-decision?${new URLSearchParams(context).toString()}`, {
    headers: { 'x-ingest-key': KEY },
  });
  if (!response.ok) throw new Error(`Ad decision failed with ${response.status}`);

  const { data } = (await response.json()) as { data: { campaignId: string } | null };
  if (!data) return [];

  const event = { ...context, campaignId: data.campaignId };
  const events: AdEvent[] = [{ ...event, type: 'IMPRESSION' }];
  if (Math.random() < (COMPLETION_RATE[context.slot] ?? 0.8)) {
    events.push({ ...event, type: 'COMPLETION' });
  }
  if (Math.random() < (CLICK_RATE[context.device] ?? 0.01)) {
    events.push({ ...event, type: 'CLICK' });
  }
  return events;
}

async function tick(showIds: string[]): Promise<number> {
  const served = await Promise.all(
    Array.from({ length: AD_BREAKS_PER_TICK }, () => serveAd(showIds)),
  );
  const events = served.flat();
  if (events.length === 0) return 0;

  const response = await fetch(`${API}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ingest-key': KEY },
    body: JSON.stringify({ events }),
  });
  if (!response.ok) throw new Error(`Event batch failed with ${response.status}`);
  return events.length;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const shows = await prisma.show.findMany({ select: { id: true } });
  await prisma.$disconnect();
  const showIds = shows.map((show) => show.id);

  console.info(`Simulator running: ${AD_BREAKS_PER_TICK} ad breaks every ${TICK_MS / 1000}s.`);
  setInterval(() => {
    tick(showIds).catch((error: unknown) => console.warn('Simulator:', String(error)));
  }, TICK_MS);
}

main().catch((error: unknown) => {
  console.error('Simulator failed:', error);
  process.exit(1);
});
