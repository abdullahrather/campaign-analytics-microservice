/**
 * src/lib/prisma.ts
 *
 * Singleton Prisma client.
 *
 * Why singleton? PrismaClient manages a connection pool internally.
 * Creating multiple instances (e.g., one per request) would exhaust
 * available database connections. The singleton pattern ensures the
 * same pool is reused across the entire application lifetime.
 *
 * In test environments, we also expose the client so tests can seed/cleanup.
 */
import { PrismaClient } from '@prisma/client';
import { env } from '@/config/env';

const createPrismaClient = (): PrismaClient => {
  return new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
};

// Re-use client across hot-reloads in development (avoids "too many connections")
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
