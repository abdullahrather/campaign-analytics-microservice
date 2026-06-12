/**
 * src/server.ts
 *
 * Application entry point.
 *
 * Separated from app.ts so that:
 *  a) Tests can import `app.ts` without starting a real server.
 *  b) The server startup concerns (port binding, graceful shutdown)
 *     are isolated in one place.
 */
import { createApp } from './app';
import { env } from '@/config/env';
import { prisma } from '@/lib/prisma';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.info(`🚀  Server running at http://localhost:${env.PORT}`);
  console.info(`📋  Environment: ${env.NODE_ENV}`);
  console.info(`🏥  Health check: http://localhost:${env.PORT}/health`);
});

// ── Graceful Shutdown ─────────────────────────────────────────────────────────
// Ensures in-flight requests complete and the DB connection is cleanly closed
// before the process exits. Essential for zero-downtime deployments.

const shutdown = async (signal: string): Promise<void> => {
  console.info(`\n📴  ${signal} received. Shutting down gracefully...`);

  server.close(async () => {
    console.info('🔌  HTTP server closed.');
    await prisma.$disconnect();
    console.info('🗄️   Database connection closed.');
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    console.error('❌  Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));
