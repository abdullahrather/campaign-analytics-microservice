/**
 * src/modules/delivery/delivery.schema.ts
 *
 * Zod schemas for the ad server endpoints.
 */
import { z } from 'zod';
import { AdSlot, Device } from '@prisma/client';

const MAX_EVENT_AGE_MS = 7 * 86_400_000;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

const placement = {
  showId: z.string().min(1),
  slot: z.enum(AdSlot),
  country: z.string().length(2).toUpperCase(),
  device: z.enum(Device),
};

export const adDecisionQuerySchema = z.object(placement);

export type AdDecisionQuery = z.infer<typeof adDecisionQuerySchema>;

const eventSchema = z.object({
  ...placement,
  type: z.enum(['IMPRESSION', 'CLICK', 'COMPLETION']),
  campaignId: z.string().min(1),
  occurredAt: z.coerce
    .date()
    .refine(
      (date) => {
        const age = Date.now() - date.getTime();
        return age < MAX_EVENT_AGE_MS && age > -MAX_CLOCK_SKEW_MS;
      },
      { error: 'Events must be from the last 7 days.' },
    )
    .optional(),
});

export const eventBatchSchema = z.object({
  events: z.array(eventSchema).min(1).max(1000),
});

export type AdEvent = z.infer<typeof eventSchema>;
