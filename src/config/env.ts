/**
 * src/config/env.ts
 *
 * Validates all required environment variables at startup using Zod.
 * If any are missing, the process exits immediately with a clear error.
 * This prevents silent misconfigurations in production.
 */
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const PLACEHOLDER = /^change-me/;

const secret = (name: string, minLength: number): z.ZodType<string> =>
  z
    .string()
    .min(minLength, { error: `${name} must be at least ${minLength} characters long` })
    .refine((value) => process.env['NODE_ENV'] !== 'production' || !PLACEHOLDER.test(value), {
      error: `${name} still has the placeholder value`,
    });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url({ error: 'DATABASE_URL must be a valid connection string URL' }),
  JWT_SECRET: secret('JWT_SECRET', 32),
  JWT_EXPIRES_IN: z.string().default('1h'),
  INGEST_API_KEY: secret('INGEST_API_KEY', 16),
  CORS_ORIGIN: z.string().default(''),
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(20),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌  Invalid environment variables:');
  console.error(z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
