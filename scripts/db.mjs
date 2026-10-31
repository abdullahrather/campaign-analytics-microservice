// Local PostgreSQL that runs from node_modules, so no Docker or system install is needed.
// Data lives in .data/postgres. An already running server on the port is reused.
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import dotenv from 'dotenv';
import EmbeddedPostgres from 'embedded-postgres';

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

/** Starts PostgreSQL if needed and returns a function that stops it. */
export const startDatabase = async () => {
  const url = new URL(process.env.DATABASE_URL);
  const port = Number(url.port);
  if (await isListening(port)) return async () => {};

  const databaseDir = path.join(ROOT, '.data', 'postgres');
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
