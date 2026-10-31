// `npm run dev`: database, migrations, demo data, API, dashboard and live traffic in one command.
// Set SIMULATE=0 to run without the demo traffic.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, ensureEnv, startDatabase } from './db.mjs';

const bin = (file) => path.join(ROOT, file);
const TSX = bin('node_modules/tsx/dist/cli.mjs');
const PRISMA = bin('node_modules/prisma/build/index.js');
const VITE = bin('web/node_modules/vite/bin/vite.js');

const runNode = (...args) => {
  const { status } = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  if (status !== 0) throw new Error(`Failed: ${args.join(' ')}`);
};

ensureEnv();

if (!fs.existsSync(VITE)) {
  console.info('Installing dashboard dependencies...');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  spawnSync(npm, ['ci', '--prefix', 'web'], { cwd: ROOT, stdio: 'inherit', shell: true });
}

const stopDatabase = await startDatabase();
runNode(PRISMA, 'migrate', 'deploy');
runNode(TSX, 'prisma/seed.ts', '--if-empty');

const apiEnv = {
  ...process.env,
  SIMULATE_TRAFFIC: process.env.SIMULATE === '0' ? 'off' : 'always',
};

const children = [
  spawn(process.execPath, [TSX, 'watch', 'src/server.ts'], { cwd: ROOT, stdio: 'inherit', env: apiEnv }),
  spawn(process.execPath, [VITE, '--port', '5173', '--strictPort'], { cwd: bin('web'), stdio: 'inherit' }),
];

const apiUrl = `http://localhost:${process.env.PORT || 3000}`;
const waitForApi = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${apiUrl}/health`)).ok) return true;
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
};

if (await waitForApi()) {
  console.info('\n  Dashboard:  http://localhost:5173');
  console.info('  API docs:   http://localhost:3000/docs');
  console.info('  Login:      advertiser@example.com / advert1234');
  console.info('  Admin:      admin@example.com / admin1234');
  console.info('  Stop:       Ctrl+C\n');
} else {
  console.error('The API did not start. See the errors above.');
}

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill());
  await stopDatabase().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
