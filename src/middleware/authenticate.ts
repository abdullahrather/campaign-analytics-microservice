/**
 * src/middleware/authenticate.ts
 *
 * JWT authentication guard middleware.
 *
 * Responsibilities:
 *  1. Extracts the Bearer token from the Authorization header.
 *  2. Verifies its signature and expiry using jsonwebtoken.
 *  3. Attaches the decoded payload to `req.user`.
 *  4. Calls `next()` to continue the request pipeline, or
 *     passes a typed error to the error handler on failure.
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from '@/config/env';
import { noteActivity } from '@/modules/demo/activity';

/** Shape of the JWT payload we sign and verify. */
export interface JwtPayload {
  sub: string;
  role: string;
  iat?: number;
  exp?: number;
}

/**
 * authenticate
 *
 * Usage: `router.use(authenticate)` or per-route `router.get('/path', authenticate, handler)`
 */
export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers['authorization'];

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      status: 'error',
      message: 'Authentication required. Provide a Bearer token.',
    });
    return;
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;

    req.user = {
      sub: payload.sub,
      role: payload.role,
    };

    noteActivity();
    next();
  } catch {
    res.status(401).json({
      status: 'error',
      message: 'Invalid or expired token.',
    });
  }
};

/** Blocks changes from the read-only guest account. Use after `authenticate`. */
export const requireWriteAccess = (req: Request, res: Response, next: NextFunction): void => {
  if (req.user?.role === Role.GUEST) {
    res.status(403).json({ status: 'error', message: 'The demo account is read-only.' });
    return;
  }

  next();
};
