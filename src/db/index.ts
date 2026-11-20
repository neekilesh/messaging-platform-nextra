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

export function isTransientSqlDisconnect(err: unknown): boolean {
  const errObj = err as { code?: string; message?: string; cause?: { code?: string; message?: string } } | null | undefined;
  const code = errObj?.code || errObj?.cause?.code || '';
  const msg = errObj?.message || errObj?.cause?.message || '';
  return (
    ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNABORTED', '57P01', '57P02', '57P03', '08000', '08003', '08006'].includes(
      code
    ) || /Connection terminated|terminating connection|socket hang up|ECONNRESET/i.test(msg)
  );
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
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      allowExitOnIdle: true,
    });

    global._postgresPool.on('error', (err) => {
      // pg-pool automatically evicts broken idle clients and reconnects on the next query.
      if (isTransientSqlDisconnect(err)) {
        return;
      }
      console.error('SQL pool error:', err instanceof Error ? err.message : String(err));
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });
export type PgDatabase = typeof db;
