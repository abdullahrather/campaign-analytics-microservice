/**
 * src/middleware/authenticate.ts
 *
 * Authentication and permission guards.
 *
 * Every request checks the session in the database, not just the token. That
 * makes sign-outs, suspensions and role changes take effect immediately rather
 * than when the short-lived access token expires.
 */
import { Request, Response, NextFunction, type RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { OrganisationRole, Role } from '@prisma/client';
import { env } from '@/config/env';
import { canManageCampaigns } from '@/lib/actor';
import { prisma } from '@/lib/prisma';
import { noteActivity } from '@/modules/demo/activity';

/** Shape of the JWT payload we sign and verify. */
export interface JwtPayload {
  sub: string;
  sid: string;
  iat?: number;
  exp?: number;
}

interface SessionRow {
  role: Role;
  userSuspendedAt: Date | null;
  organisationId: string | null;
  organisationRole: OrganisationRole | null;
  organisationSuspendedAt: Date | null;
}

const deny = (res: Response, status: number, message: string): void => {
  res.status(status).json({ status: 'error', message });
};

const findSession = async (sessionId: string, userId: string): Promise<SessionRow | undefined> => {
  const rows = await prisma.$queryRaw<SessionRow[]>`
    SELECT
      u.role,
      u.suspended_at AS "userSuspendedAt",
      s.active_organisation_id AS "organisationId",
      m.role AS "organisationRole",
      o.suspended_at AS "organisationSuspendedAt"
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN memberships m
      ON m.user_id = s.user_id AND m.organisation_id = s.active_organisation_id
    LEFT JOIN organisations o ON o.id = s.active_organisation_id
    WHERE s.id = ${sessionId} AND s.user_id = ${userId}
      AND s.revoked_at IS NULL AND s.expires_at > now()
  `;
  return rows[0];
};

const verifyAccessToken = (token: string): JwtPayload | null => {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      audience: 'access',
    }) as unknown as JwtPayload;
    return payload.sid ? payload : null;
  } catch {
    return null;
  }
};

/**
 * authenticate
 *
 * Usage: `router.use(authenticate)` or per-route `router.get('/path', authenticate, handler)`
 */
export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers['authorization'];

  if (!authHeader?.startsWith('Bearer ')) {
    deny(res, 401, 'Authentication required. Provide a Bearer token.');
    return;
  }

  const payload = verifyAccessToken(authHeader.slice(7)); // Remove "Bearer " prefix
  if (!payload) {
    deny(res, 401, 'Invalid or expired token.');
    return;
  }

  findSession(payload.sid, payload.sub)
    .then((session) => {
      if (!session) {
        deny(res, 401, 'This session has ended. Please sign in again.');
        return;
      }
      if (session.userSuspendedAt) {
        deny(res, 403, 'This account is suspended.');
        return;
      }
      if (session.organisationSuspendedAt && session.role !== Role.ADMIN) {
        deny(res, 403, 'This organisation is suspended.');
        return;
      }

      // A removed member keeps a session, but it no longer grants the organisation.
      const hasMembership = session.organisationRole !== null;
      req.user = {
        sub: payload.sub,
        role: session.role,
        sessionId: payload.sid,
        organisationId: hasMembership ? session.organisationId : null,
        organisationRole: session.organisationRole,
      };

      noteActivity();
      next();
    })
    .catch(next);
};

/** Allows owners and managers. Use after `authenticate`. */
export const requireWriteAccess = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user || !canManageCampaigns(req.user)) {
    deny(res, 403, 'Your role can view campaigns but not change them.');
    return;
  }

  next();
};

/** Blocks the shared read-only guest account from personal settings. */
export const requirePersonalAccount = (req: Request, res: Response, next: NextFunction): void => {
  if (req.user?.role === Role.GUEST) {
    deny(res, 403, 'The demo account is read-only.');
    return;
  }

  next();
};

/** Allows only the listed roles in the active organisation. */
export const requireOrganisationRole =
  (...roles: OrganisationRole[]): RequestHandler =>
  (req, res, next) => {
    const role = req.user?.organisationRole;
    if (!role || !roles.includes(role)) {
      deny(res, 403, 'Your role in this organisation does not allow this.');
      return;
    }

    next();
  };

export const requirePlatformAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (req.user?.role !== Role.ADMIN) {
    deny(res, 403, 'This area is for platform admins.');
    return;
  }

  next();
};
