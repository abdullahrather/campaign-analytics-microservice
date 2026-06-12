/**
 * src/modules/campaigns/campaigns.schema.ts
 *
 * Zod schemas for campaign-related request bodies.
 */
import { z } from 'zod';
import { CampaignStatus } from '@prisma/client';

export const createCampaignSchema = z.object({
  title: z
    .string({ required_error: 'Title is required.' })
    .min(3, { message: 'Title must be at least 3 characters.' })
    .max(255, { message: 'Title must be at most 255 characters.' })
    .trim(),

  status: z.nativeEnum(CampaignStatus).optional().default(CampaignStatus.ACTIVE),
});

export type CreateCampaignDto = z.infer<typeof createCampaignSchema>;

// ── Query parameter schemas ───────────────────────────────────────────────────

export const listCampaignsQuerySchema = z.object({
  status: z.nativeEnum(CampaignStatus).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type ListCampaignsQuery = z.infer<typeof listCampaignsQuerySchema>;
