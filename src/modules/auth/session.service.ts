/**
 * src/modules/auth/session.service.ts
 *
 * Signed-in devices. A short-lived access token authorises requests, and a
 * long-lived refresh token in an httpOnly cookie replaces it. Refresh tokens
 * rotate on every use: replaying an old one means it was stolen, so the session
 * is ended for both sides.
 */
import jwt from 'jsonwebtoken';
import type { Session } from '@prisma/client';
import { env } from '@/config/env';
import type { RequestContext } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { hashToken, randomToken } from '@/lib/security';
import { auditService } from '@/modules/audit/audit.service';

const SESSION_DAYS = 30;
// Two tabs can refresh at once, so a just-rotated token isn't treated as theft.
const ROTATION_GRACE_MS = 10_000;

export interface IssuedTokens {
  accessToken: string;
  /** Absent when the browser's current cookie should stay. */
  refreshToken?: string;
}

const sessionExpiry = (): Date => new Date(Date.now() + SESSION_DAYS * 86_400_000);

const signAccessToken = (userId: string, sessionId: string): string =>
  jwt.sign({ sid: sessionId }, env.JWT_SECRET, {
    subject: userId,
    audience: 'access',
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions);

class SessionService {
  /** Starts a session in the user's earliest organisation. */
  async create(userId: string, context: RequestContext): Promise<IssuedTokens> {
    const membership = await prisma.membership.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { organisationId: true },
    });

    const secret = randomToken();
    const session = await prisma.session.create({
      data: {
        userId,
        activeOrganisationId: membership?.organisationId ?? null,
        refreshHash: hashToken(secret),
        userAgent: context.userAgent,
        ipAddress: context.ipAddress,
        expiresAt: sessionExpiry(),
      },
    });

    return {
      accessToken: signAccessToken(userId, session.id),
      refreshToken: `${session.id}.${secret}`,
    };
  }

  /** Returns new tokens, or null when the cookie can't be used. */
  async refresh(refreshToken: string, context: RequestContext): Promise<IssuedTokens | null> {
    const [sessionId = '', secret = ''] = refreshToken.split('.');
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: { select: { suspendedAt: true } } },
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
    if (session.user.suspendedAt) return null;

    const hash = hashToken(secret);

    if (hash === session.previousRefreshHash) {
      const age = Date.now() - (session.rotatedAt?.getTime() ?? 0);
      if (age < ROTATION_GRACE_MS) {
        return { accessToken: signAccessToken(session.userId, session.id) };
      }

      await this.revoke(session);
      await auditService.record({
        action: 'auth.session_reuse_detected',
        actorId: session.userId,
        ipAddress: context.ipAddress,
      });
      return null;
    }

    if (hash !== session.refreshHash) return null;

    const nextSecret = randomToken();
    await prisma.session.update({
      where: { id: session.id },
      data: {
        refreshHash: hashToken(nextSecret),
        previousRefreshHash: hash,
        rotatedAt: new Date(),
        lastUsedAt: new Date(),
        expiresAt: sessionExpiry(),
        userAgent: context.userAgent,
        ipAddress: context.ipAddress,
      },
    });

    return {
      accessToken: signAccessToken(session.userId, session.id),
      refreshToken: `${session.id}.${nextSecret}`,
    };
  }

  private revoke(session: Session): Promise<Session> {
    return prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  }

  async endFromCookie(refreshToken: string): Promise<void> {
    const [sessionId = '', secret = ''] = refreshToken.split('.');
    await prisma.session.updateMany({
      where: { id: sessionId, refreshHash: hashToken(secret), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Ends the user's sessions, optionally keeping the current one. */
  async endAll(userId: string, exceptSessionId?: string): Promise<number> {
    const { count } = await prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  async endOne(userId: string, sessionId: string): Promise<boolean> {
    const { count } = await prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count > 0;
  }

  list(
    userId: string,
  ): Promise<Array<Pick<Session, 'id' | 'userAgent' | 'ipAddress' | 'createdAt' | 'lastUsedAt'>>> {
    return prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, userAgent: true, ipAddress: true, createdAt: true, lastUsedAt: true },
    });
  }
}

export const sessionService = new SessionService();
