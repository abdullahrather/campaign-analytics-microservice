/**
 * src/app.ts
 *
 * Express application factory.
 *
 * This module exports a fully-configured Express app WITHOUT calling
 * app.listen(). This separation is critical for testability — Jest can
 * import this module and Supertest will bind it to an ephemeral port,
 * so tests don't collide with a running development server.
 */
import express, { type Application, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';

import { authRouter } from '@/modules/auth/auth.routes';
import { campaignsRouter } from '@/modules/campaigns/campaigns.routes';
import { errorHandler } from '@/middleware/errorHandler';
import { env } from '@/config/env';

export function createApp(): Application {
  const app = express();

  // ── Security middleware ───────────────────────────────────────────────────
  app.use(helmet());         // Sets various HTTP security headers
  app.use(cors());           // Enable CORS (configure origins for production)

  // ── Body parsing ──────────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // ── Logging ───────────────────────────────────────────────────────────────
  if (env.NODE_ENV !== 'test') {
    app.use(morgan('combined'));
  }

  // ── Health check (no auth required) ──────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  });

  // ── API routes ────────────────────────────────────────────────────────────
  app.use('/auth', authRouter);
  app.use('/campaigns', campaignsRouter);

  // ── 404 handler ───────────────────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ status: 'error', message: 'Route not found.' });
  });

  // ── Global error handler (must be last) ──────────────────────────────────
  app.use(errorHandler);

  return app;
}
