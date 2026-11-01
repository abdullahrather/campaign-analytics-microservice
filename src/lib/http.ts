/**
 * src/lib/http.ts
 *
 * Small helpers shared by route files.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Actor } from '@/lib/actor';
import { AppError } from '@/middleware/errorHandler';

/** Passes a rejected async handler to the error handler. */
export const handle =
  (handler: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };

/** For public player routes: any site's video player may use them. */
export const allowAnyOrigin: RequestHandler = (_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
};

export const actorOf = (req: Request): Actor => {
  if (!req.user) throw new AppError(401, 'Unauthenticated.');
  return req.user;
};

export interface RequestContext {
  ipAddress: string;
  userAgent: string;
}

export const contextOf = (req: Request): RequestContext => ({
  ipAddress: req.ip ?? '',
  userAgent: (req.headers['user-agent'] ?? '').slice(0, 255),
});
