/**
 * tests/setup/globalSetup.ts
 *
 * Runs ONCE before any test files execute.
 *
 * Responsibilities:
 *  1. Point the Prisma client to the isolated TEST database.
 *  2. Run all pending migrations so the schema is current.
 *
 * We use the `TEST_DATABASE_URL` env var to ensure we never accidentally
 * run tests against the production or development database.
 */
import { execSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

export default async function globalSetup(): Promise<void> {
  const testDatabaseUrl =
    process.env['TEST_DATABASE_URL'] ??
    'postgresql://postgres:secret@localhost:5432/campaign_analytics_test?schema=public';

  // Override DATABASE_URL for the duration of the process so Prisma
  // migrations target the test DB
  process.env['DATABASE_URL'] = testDatabaseUrl;

  console.info('\n🧪  [Jest] Applying migrations to test database...');

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    stdio: 'inherit',
  });

  console.info('✅  [Jest] Test database ready.\n');
}
