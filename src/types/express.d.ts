/**
 * src/types/express.d.ts
 *
 * Augments Express's Request interface to add the `user` property that
 * our JWT authenticate middleware attaches after token verification.
 *
 * Without this, TypeScript would complain about `req.user` not existing
 * on the standard Request type.
 */
import 'express';
import type { Actor } from '../lib/actor';

declare global {
  namespace Express {
    interface Request {
      /**
       * The signed-in person, populated by the `authenticate` middleware.
       * Only present on protected routes.
       */
      user?: Actor;
    }
  }
}
