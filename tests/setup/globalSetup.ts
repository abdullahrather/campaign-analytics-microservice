/**
 * tests/setup/globalSetup.ts
 *
 * Runs ONCE before any test files execute and applies all migrations to the
 * isolated test database, so tests can never touch development data.
 */
import { execSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

export default async function globalSetup(): Promise<void> {
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
  if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL must be set to run the tests.');

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    stdio: 'ignore',
  });
}
