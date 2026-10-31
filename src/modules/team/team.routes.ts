/**
 * src/modules/team/team.routes.ts
 *
 * Team routes always act on the session's active organisation. Owners manage
 * people, managers can see the team and the activity history.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { OrganisationRole } from '@prisma/client';
import { actorOf, contextOf, handle } from '@/lib/http';
import {
  authenticate,
  requireOrganisationRole,
  requirePersonalAccount,
} from '@/middleware/authenticate';
import { auditService } from '@/modules/audit/audit.service';
import {
  acceptInvitationSchema,
  auditQuerySchema,
  changeRoleSchema,
  createOrganisationSchema,
  invitationTokenSchema,
  inviteSchema,
} from './team.schema';
import { teamService } from './team.service';

const { OWNER, MANAGER, ANALYST } = OrganisationRole;

const teamRouter = Router();
const invitationsRouter = Router();

teamRouter.use(authenticate, requirePersonalAccount);

teamRouter.post(
  '/organisations',
  handle(async (req, res) => {
    const actor = actorOf(req);
    const { name } = createOrganisationSchema.parse(req.body);
    const organisation = await teamService.createOrganisation(actor, name);

    await auditService.record({
      action: 'organisation.created',
      actorId: actor.sub,
      organisationId: organisation.id,
      targetType: 'organisation',
      targetId: organisation.id,
      details: { name },
      ipAddress: contextOf(req).ipAddress,
    });
    res.status(201).json({ status: 'success', data: organisation });
  }),
);

teamRouter.get(
  '/members',
  requireOrganisationRole(OWNER, MANAGER, ANALYST),
  handle(async (req, res) => {
    res.status(200).json({ status: 'success', data: await teamService.members(actorOf(req)) });
  }),
);

teamRouter.patch(
  '/members/:userId',
  requireOrganisationRole(OWNER),
  handle(async (req, res) => {
    const actor = actorOf(req);
    const userId = req.params['userId'] as string;
    const { role } = changeRoleSchema.parse(req.body);
    await teamService.changeRole(actor, userId, role);

    await auditService.record({
      action: 'member.role_changed',
      actorId: actor.sub,
      organisationId: actor.organisationId,
      targetType: 'user',
      targetId: userId,
      details: { role },
      ipAddress: contextOf(req).ipAddress,
    });
    res.status(204).end();
  }),
);

/** Owners can remove anyone, and any member can remove themselves. */
teamRouter.delete(
  '/members/:userId',
  (req: Request, res: Response, next: NextFunction) => {
    if (req.params['userId'] === req.user?.sub) {
      next();
      return;
    }
    requireOrganisationRole(OWNER)(req, res, next);
  },
  handle(async (req, res) => {
    const actor = actorOf(req);
    const userId = req.params['userId'] as string;
    await teamService.removeMember(actor, userId);

    await auditService.record({
      action: 'member.removed',
      actorId: actor.sub,
      organisationId: actor.organisationId,
      targetType: 'user',
      targetId: userId,
      ipAddress: contextOf(req).ipAddress,
    });
    res.status(204).end();
  }),
);

teamRouter.get(
  '/invitations',
  requireOrganisationRole(OWNER, MANAGER),
  handle(async (req, res) => {
    const invitations = await teamService.invitations(actorOf(req));
    res.status(200).json({
      status: 'success',
      data: invitations.map(({ tokenHash: _tokenHash, ...invitation }) => invitation),
    });
  }),
);

teamRouter.post(
  '/invitations',
  requireOrganisationRole(OWNER),
  handle(async (req, res) => {
    const actor = actorOf(req);
    const dto = inviteSchema.parse(req.body);
    const { tokenHash: _tokenHash, ...invitation } = await teamService.invite(actor, dto);

    await auditService.record({
      action: 'member.invited',
      actorId: actor.sub,
      organisationId: actor.organisationId,
      targetType: 'invitation',
      targetId: invitation.id,
      details: { email: dto.email, role: dto.role },
      ipAddress: contextOf(req).ipAddress,
    });
    res.status(201).json({ status: 'success', data: invitation });
  }),
);

teamRouter.delete(
  '/invitations/:id',
  requireOrganisationRole(OWNER),
  handle(async (req, res) => {
    const actor = actorOf(req);
    const id = req.params['id'] as string;
    await teamService.revokeInvitation(actor, id);

    await auditService.record({
      action: 'invitation.revoked',
      actorId: actor.sub,
      organisationId: actor.organisationId,
      targetType: 'invitation',
      targetId: id,
      ipAddress: contextOf(req).ipAddress,
    });
    res.status(204).end();
  }),
);

teamRouter.get(
  '/audit',
  requireOrganisationRole(OWNER, MANAGER),
  handle(async (req, res) => {
    const actor = actorOf(req);
    const query = auditQuerySchema.parse(req.query);
    const result = await auditService.list(actor.organisationId, query);
    res.status(200).json({ status: 'success', ...result });
  }),
);

// ── Invitation links (the person may not have an account yet) ─────────────────

/** Attaches the actor when a valid token is sent, and carries on without one. */
const optionalAuthenticate = (req: Request, res: Response, next: NextFunction): void => {
  if (req.headers['authorization']) authenticate(req, res, next);
  else next();
};

invitationsRouter.post(
  '/preview',
  handle(async (req, res) => {
    const { token } = invitationTokenSchema.parse(req.body);
    res.status(200).json({ status: 'success', data: await teamService.preview(token) });
  }),
);

invitationsRouter.post(
  '/accept',
  optionalAuthenticate,
  handle(async (req, res) => {
    const accepted = await teamService.accept(acceptInvitationSchema.parse(req.body), req.user);

    await auditService.record({
      action: 'invitation.accepted',
      actorId: accepted.userId,
      actorEmail: accepted.email,
      organisationId: accepted.organisationId,
      details: { role: accepted.role },
      ipAddress: contextOf(req).ipAddress,
    });
    res.status(200).json({ status: 'success' });
  }),
);

export { invitationsRouter, teamRouter };
