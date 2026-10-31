/**
 * src/lib/actor.ts
 *
 * Who is making a request, and what they may do. Platform admins and the guest
 * account see every organisation; everyone else sees their active organisation.
 */
import { OrganisationRole, Role } from '@prisma/client';

export interface Actor {
  sub: string;
  role: string;
  sessionId: string;
  organisationId: string | null;
  organisationRole: OrganisationRole | null;
}

export const seesAllOrganisations = (actor: Actor): boolean =>
  actor.role === Role.ADMIN || actor.role === Role.GUEST;

/** Owners and managers run campaigns; analysts read; the guest account is read-only. */
export const canManageCampaigns = (actor: Actor): boolean => {
  if (actor.role === Role.ADMIN) return true;
  if (actor.role === Role.GUEST) return false;
  return (
    actor.organisationRole === OrganisationRole.OWNER ||
    actor.organisationRole === OrganisationRole.MANAGER
  );
};
