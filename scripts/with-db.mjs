// Runs a Node tool with the local database available: node scripts/with-db.mjs <file> [args]
// On CI a PostgreSQL service is provided instead, so none is started here.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, ensureEnv, startDatabase, startRedis } from './db.mjs';

const [file, ...args] = process.argv.slice(2);
const usesServiceDatabase = process.env.CI === 'true';

if (!usesServiceDatabase) {
  ensureEnv();
  await startRedis();
}
const stopDatabase = usesServiceDatabase ? async () => {} : await startDatabase();

const { status } = spawnSync(process.execPath, [path.join(ROOT, file), ...args], {
  cwd: ROOT,
  stdio: 'inherit',
});

await stopDatabase().catch(() => {});
process.exit(status ?? 1);
