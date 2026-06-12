/**
 * tests/setup/globalTeardown.ts
 *
 * Runs ONCE after all test files have completed.
 * Currently a no-op placeholder — useful hook for:
 *  - Dropping the test schema
 *  - Closing external connections (Redis, etc.)
 *  - Generating test reports
 */
export default async function globalTeardown(): Promise<void> {
  console.info('\n🧹  [Jest] Global teardown complete.');
}
