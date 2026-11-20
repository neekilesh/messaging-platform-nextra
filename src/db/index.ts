import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

function shouldUseSsl(): boolean {
  const rawSsl = process.env.SQL_SSL?.trim().toLowerCase();
  if (rawSsl === 'true' || rawSsl === '1') return true;
  if (rawSsl === 'false' || rawSsl === '0') return false;

  const host = process.env.SQL_HOST?.trim();
  if (!host) return false;
  // Unix sockets (/app/cloudsql/...) and localhost do not use TLS, whereas remote Postgres hosts (Supabase/Render) require SSL
  if (host.startsWith('/') || host === 'localhost' || host === '127.0.0.1') {
    return false;
  }
  return true;
}

export const createPool = () => {
  if (!global._postgresPool) {
    global._postgresPool = new Pool({
      host: process.env.SQL_HOST,
      port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : 5432,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      ...(shouldUseSsl() ? { ssl: { rejectUnauthorized: false } } : {}),
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
