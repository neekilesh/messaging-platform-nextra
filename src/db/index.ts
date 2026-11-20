import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

function cleanEnv(val: string | undefined): string | undefined {
  if (!val) return undefined;
  const trimmed = val.trim().replace(/^["']|["']$/g, '').trim();
  return trimmed || undefined;
}

function shouldUseSsl(host: string | undefined): boolean {
  const rawSsl = cleanEnv(process.env.SQL_SSL)?.toLowerCase();
  if (rawSsl === 'true' || rawSsl === '1') return true;
  if (rawSsl === 'false' || rawSsl === '0') return false;

  if (!host) return false;
  // Unix sockets, localhost, and single-label internal hostnames (e.g. Render internal dpg-*-a) do not use SSL
  if (host.startsWith('/') || host === 'localhost' || host === '127.0.0.1' || !host.includes('.')) {
    return false;
  }
  return true;
}

export const createPool = () => {
  if (!global._postgresPool) {
    const host = cleanEnv(process.env.SQL_HOST);
    const portRaw = cleanEnv(process.env.SQL_PORT);
    const user = cleanEnv(process.env.SQL_USER);
    const password = cleanEnv(process.env.SQL_PASSWORD);
    const database = cleanEnv(process.env.SQL_DB_NAME);

    global._postgresPool = new Pool({
      host,
      port: portRaw ? Number(portRaw) : 5432,
      user,
      password,
      database,
      ...(shouldUseSsl(host) ? { ssl: { rejectUnauthorized: false } } : {}),
      max: 10,
      connectionTimeoutMillis: 15000,
    });

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });
export type PgDatabase = typeof db;
