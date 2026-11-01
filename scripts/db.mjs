// Local services. PostgreSQL runs from node_modules, with data in .data/postgres, and Redis
// runs in Docker. A server already listening on its port is reused.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import dotenv from 'dotenv';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

export const ROOT = path.resolve(import.meta.dirname, '..');

const GENERATED_SECRETS = { JWT_SECRET: 48, INGEST_API_KEY: 24, ENCRYPTION_KEY: 32 };

/** Creates .env from the example on first run, and fills in any missing secret. */
export const ensureEnv = () => {
  const target = path.join(ROOT, '.env');
  const isNew = !fs.existsSync(target);
  let content = fs.readFileSync(isNew ? path.join(ROOT, '.env.example') : target, 'utf8');

  for (const [name, bytes] of Object.entries(GENERATED_SECRETS)) {
    const value = `${name}="${crypto.randomBytes(bytes).toString('hex')}"`;
    const line = new RegExp(`^${name}=.*$`, 'm');
    const existing = content.match(line)?.[0];

    if (!existing) content = `${content.trimEnd()}\n${value}\n`;
    else if (existing.includes('change-me')) content = content.replace(line, () => value);
  }

  fs.writeFileSync(target, content);
  if (isNew) console.info('Created .env with generated secrets.');
  dotenv.config({ path: target, quiet: true });
};

const isListening = (port) =>
  new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** An open port isn't enough: a server that's shutting down still holds it. */
const answersQueries = async (url) => {
  const client = new pg.Client({
    host: '127.0.0.1',
    port: Number(url.port),
    user: url.username,
    password: url.password,
    database: 'postgres',
    connectionTimeoutMillis: 3000,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
};

/** On Windows, stops this project's PostgreSQL processes, which never touches another install. */
const stopWindowsPostgres = () => {
  const projectPath = ROOT.replace(/\\/g, '/');
  const script = `Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" |
    Where-Object { $_.CommandLine -like '*${projectPath}*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore' });
};

/**
 * Clears a stuck server. A stranded child process can hold the port after the
 * main process exits, so stopping the process in postmaster.pid isn't enough.
 */
const removeStuckServer = async (port, databaseDir) => {
  const pidFile = path.join(databaseDir, 'postmaster.pid');
  console.info("PostgreSQL isn't responding. Restarting it.");

  if (process.platform === 'win32') {
    stopWindowsPostgres();
  } else if (fs.existsSync(pidFile)) {
    try {
      const [pid] = fs.readFileSync(pidFile, 'utf8').split(/\r?\n/);
      process.kill(Number(pid), 'SIGKILL');
    } catch {
      // It has already gone.
    }
  }

  for (let attempt = 0; attempt < 30 && (await isListening(port)); attempt += 1) await sleep(200);
  if (await isListening(port)) {
    throw new Error(`Port ${port} is in use by something that isn't answering as PostgreSQL.`);
  }
  fs.rmSync(pidFile, { force: true });
};

/** Starts Redis in Docker if needed. It keeps running, because it holds queued events. */
export const startRedis = async () => {
  const port = Number(new URL(process.env.REDIS_URL ?? 'redis://localhost:6379').port || 6379);
  if (await isListening(port)) return;

  const { status } = spawnSync('docker', ['compose', 'up', '-d', '--wait', 'redis'], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  if (status !== 0) {
    throw new Error('Redis could not start. Check that Docker Desktop is running.');
  }
  console.info(`Redis ready on port ${port}.`);
};

/** Starts PostgreSQL if needed and returns a function that stops it. */
export const startDatabase = async () => {
  const url = new URL(process.env.DATABASE_URL);
  const port = Number(url.port);
  const databaseDir = path.join(ROOT, '.data', 'postgres');

  if (await isListening(port)) {
    // A server that's shutting down needs a moment before it can be replaced.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (await answersQueries(url)) return async () => {};
      if (!(await isListening(port))) break;
      await sleep(500);
    }
    if (await isListening(port)) await removeStuckServer(port, databaseDir);
  }

  const postgres = new EmbeddedPostgres({
    databaseDir,
    user: url.username,
    password: url.password,
    port,
    persistent: true,
    onLog: () => {},
  });

  if (!fs.existsSync(path.join(databaseDir, 'PG_VERSION'))) await postgres.initialise();
  await postgres.start();

  const client = postgres.getPgClient('postgres', '127.0.0.1');
  await client.connect();
  const databases = [url, new URL(process.env.TEST_DATABASE_URL)].map((u) => u.pathname.slice(1));
  for (const name of databases) {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!rowCount) await client.query(`CREATE DATABASE "${name}"`);
  }
  await client.end();

  console.info(`PostgreSQL ready on port ${port}.`);
  return () => postgres.stop();
};
