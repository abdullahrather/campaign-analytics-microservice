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
import fs from 'fs';
import path from 'path';
import express, { type Application, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';

import { authRouter } from '@/modules/auth/auth.routes';
import { campaignsRouter } from '@/modules/campaigns/campaigns.routes';
import { deliveryRouter } from '@/modules/delivery/delivery.routes';
import { showsRouter } from '@/modules/shows/shows.routes';
import { errorHandler } from '@/middleware/errorHandler';
import { prisma } from '@/lib/prisma';
import { env } from '@/config/env';

const DASHBOARD_DIR = path.resolve(process.cwd(), 'web', 'dist');

export function createApp(): Application {
  const app = express();

  // ── Security middleware ───────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
    }),
  );
  const origins = env.CORS_ORIGIN.split(',').filter(Boolean);
  app.use(cors({ origin: origins.length > 0 ? origins : false }));

  // ── Body parsing ──────────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));

  // ── Logging ───────────────────────────────────────────────────────────────
  if (env.NODE_ENV === 'production') {
    app.use(morgan('combined'));
  }

  // ── Health check (no auth required) ──────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    prisma.$queryRaw`SELECT 1`
      .then(() => res.status(200).json({ status: 'ok', environment: env.NODE_ENV }))
      .catch(() => res.status(503).json({ status: 'error', message: 'Database unavailable.' }));
  });

  // ── API routes ────────────────────────────────────────────────────────────
  app.use('/auth', authRouter);
  app.use('/campaigns', campaignsRouter);
  app.use('/shows', showsRouter);
  app.use(deliveryRouter);

  // ── 404 handler ───────────────────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ status: 'error', message: 'Route not found.' });
  });

  // ── Global error handler (must be last) ──────────────────────────────────
  app.use(errorHandler);

  return app;
}

/** Serves the built dashboard when there is one. Registered ahead of the API. */
export function createServerApp(): Application {
  const server = express();
  if (fs.existsSync(DASHBOARD_DIR)) server.use(express.static(DASHBOARD_DIR));
  server.use(createApp());
  return server;
}
