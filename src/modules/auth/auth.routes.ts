/**
 * src/modules/auth/auth.routes.ts
 *
 * Accounts and signing in. The refresh token lives in an httpOnly cookie that
 * page scripts can't read, and SameSite stops other sites from sending it.
 */
import { Router, type CookieOptions, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { Role } from '@prisma/client';
import { env } from '@/config/env';
import { actorOf, contextOf, handle } from '@/lib/http';
import { usesLocalMailbox } from '@/lib/mailer';
import { authenticate } from '@/middleware/authenticate';
import { AppError } from '@/middleware/errorHandler';
import { auditService } from '@/modules/audit/audit.service';
import {
  emailSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  switchOrganisationSchema,
  tokenSchema,
  twoFactorChallengeSchema,
} from './auth.schema';
import { authService } from './auth.service';
import { sessionService, type IssuedTokens } from './session.service';

const REFRESH_COOKIE = 'refresh_token';

const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  secure: env.NODE_ENV === 'production',
  path: '/auth',
};

const authRouter = Router();

// Slows password guessing and email abuse.
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.LOGIN_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { status: 'error', message: 'Too many attempts. Try again later.' },
});

const sendSignedIn = (res: Response, tokens: IssuedTokens, expiresIn: string): void => {
  if (tokens.refreshToken) {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...cookieOptions,
      maxAge: 30 * 86_400_000,
    });
  }
  res.status(200).json({
    status: 'success',
    data: { token: tokens.accessToken, expiresIn },
  });
};

const refreshCookie = (req: Request): string | undefined =>
  (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];

/** The sign-in page uses this to show the options that apply here. */
authRouter.get('/options', (_req, res) => {
  res.status(200).json({
    status: 'success',
    data: {
      demo: env.DEMO_MODE,
      signUp: !env.DEMO_MODE,
      localMailbox: usesLocalMailbox(),
    },
  });
});

authRouter.post(
  '/register',
  sensitiveLimiter,
  handle(async (req, res) => {
    if (env.DEMO_MODE) throw new AppError(403, 'Sign-up is turned off in the public demo.');

    await authService.register(registerSchema.parse(req.body), contextOf(req));
    res.status(202).json({
      status: 'success',
      message: 'Check your email to confirm your account.',
    });
  }),
);

authRouter.post(
  '/verify-email',
  sensitiveLimiter,
  handle(async (req, res) => {
    await authService.verifyEmail(tokenSchema.parse(req.body).token);
    res.status(200).json({ status: 'success' });
  }),
);

authRouter.post(
  '/resend-verification',
  sensitiveLimiter,
  handle(async (req, res) => {
    await authService.resendVerification(emailSchema.parse(req.body).email);
    res.status(202).json({ status: 'success' });
  }),
);

authRouter.post(
  '/login',
  sensitiveLimiter,
  handle(async (req, res) => {
    const result = await authService.login(loginSchema.parse(req.body), contextOf(req));

    if ('twoFactorRequired' in result) {
      res.status(200).json({ status: 'success', data: result });
      return;
    }
    sendSignedIn(res, result, result.expiresIn);
  }),
);

authRouter.post(
  '/two-factor',
  sensitiveLimiter,
  handle(async (req, res) => {
    const result = await authService.completeTwoFactor(
      twoFactorChallengeSchema.parse(req.body),
      contextOf(req),
    );
    sendSignedIn(res, result, result.expiresIn);
  }),
);

authRouter.post(
  '/refresh',
  handle(async (req, res) => {
    const cookie = refreshCookie(req);
    const tokens = cookie ? await sessionService.refresh(cookie, contextOf(req)) : null;

    if (!tokens) {
      res.clearCookie(REFRESH_COOKIE, cookieOptions);
      throw new AppError(401, 'Please sign in.');
    }
    sendSignedIn(res, tokens, env.JWT_EXPIRES_IN);
  }),
);

authRouter.post(
  '/logout',
  handle(async (req, res) => {
    const cookie = refreshCookie(req);
    if (cookie) await sessionService.endFromCookie(cookie);

    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    res.status(204).end();
  }),
);

authRouter.post(
  '/forgot-password',
  sensitiveLimiter,
  handle(async (req, res) => {
    await authService.forgotPassword(emailSchema.parse(req.body).email);
    res.status(202).json({
      status: 'success',
      message: 'If that account exists, a reset link is on its way.',
    });
  }),
);

authRouter.post(
  '/reset-password',
  sensitiveLimiter,
  handle(async (req, res) => {
    await authService.resetPassword(resetPasswordSchema.parse(req.body), contextOf(req));
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    res.status(200).json({ status: 'success' });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  handle(async (req, res) => {
    res.status(200).json({ status: 'success', data: await authService.profile(actorOf(req)) });
  }),
);

authRouter.post(
  '/switch-organisation',
  authenticate,
  handle(async (req, res) => {
    const actor = actorOf(req);
    if (actor.role === Role.GUEST) throw new AppError(403, 'The demo account is read-only.');

    const { organisationId } = switchOrganisationSchema.parse(req.body);
    await authService.switchOrganisation(actor, organisationId);
    await auditService.record({
      action: 'auth.organisation_switched',
      actorId: actor.sub,
      organisationId,
      ipAddress: contextOf(req).ipAddress,
    });
    res.status(204).end();
  }),
);

export { authRouter };
