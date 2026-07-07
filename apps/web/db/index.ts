import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT>;

/**
 * DATABASE_URL → Postgres (Neon EU v produkci; migrace přes `drizzle-kit migrate`
 * při deployi). Bez ní → lokální PGlite v `.data/danero` s migracemi při startu —
 * vývoj i testy bez jakéhokoli setupu.
 */
const globalForDb = globalThis as unknown as { __daneroDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  globalForDb.__daneroDb ??= init();
  return globalForDb.__daneroDb;
}

async function init(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const client = postgres(url, { prepare: false });
    return drizzlePostgres(client, { schema }) as unknown as Db;
  }
  return createPgliteDb(process.env.PGLITE_DATA_DIR ?? '.data/danero');
}

/** Exportováno i pro testy — `createPgliteDb()` bez argumentu (či ':memory:') = in-memory. */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const inMemory = !dataDir || dataDir === ':memory:' || dataDir.startsWith('memory://');
  if (!inMemory) mkdirSync(dataDir, { recursive: true });
  const pglite = inMemory ? new PGlite() : new PGlite(dataDir);
  const db: PgliteDatabase<typeof schema> = drizzlePglite(pglite, { schema });
  await migratePglite(db, { migrationsFolder: join(process.cwd(), 'db/migrations') });
  return db as unknown as Db;
}
