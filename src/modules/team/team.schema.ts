/**
 * src/modules/team/team.schema.ts
 *
 * Zod schemas for organisations, members and invitations.
 */
import { z } from 'zod';
import { OrganisationRole } from '@prisma/client';
import { newPassword, organisationName, personName } from '@/modules/auth/auth.schema';

const role = z.enum(OrganisationRole);

export const createOrganisationSchema = z.object({ name: organisationName });

export const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Must be a valid email address.' })),
  role,
});

export const changeRoleSchema = z.object({ role });

export const invitationTokenSchema = z.object({ token: z.string().min(10) });

/** New people choose a name and password. People with an account sign in first. */
export const acceptInvitationSchema = z.object({
  token: z.string().min(10),
  name: personName.optional(),
  password: newPassword.optional(),
});

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
  action: z.string().trim().max(60).optional(),
});

export type InviteDto = z.infer<typeof inviteSchema>;
export type AcceptInvitationDto = z.infer<typeof acceptInvitationSchema>;
