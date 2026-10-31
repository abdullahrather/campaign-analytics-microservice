/**
 * tests/setup/env.ts
 *
 * Runs before each test file's imports, so the app's config and Prisma client
 * can only ever connect to the test database.
 */
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL must be set to run the tests.');

process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = testDatabaseUrl;
process.env['JWT_SECRET'] ??= 'test-secret-that-is-at-least-32-characters';
process.env['INGEST_API_KEY'] ??= 'test-ingest-key-1234';
process.env['LOGIN_RATE_LIMIT'] = '100000';
