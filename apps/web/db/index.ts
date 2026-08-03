import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT>;

/**
 * DATABASE_URL → Postgres (Neon EU v produkci; migrace přes `drizzle-kit migrate`
 * při deployi). Bez ní → lokální PGlite v `.data/danero` s migracemi při startu —
 * vývoj i testy bez jakéhokoli setupu.
 *
 * `DANERO_MIGRATE_ON_START=1` zmigruje i Postgres při prvním dotazu — pro vlastní
 * instanci (Docker), kde drizzle-kit není k dispozici. Jen pro JEDNU instanci:
 * při více současně běžících by si migrace lezly do zelí, tam patří migrační krok
 * do deploye.
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
    const db = drizzlePostgres(client, { schema });
    if (process.env.DANERO_MIGRATE_ON_START === '1') {
      await migratePostgres(db, { migrationsFolder: join(process.cwd(), 'db/migrations') });
    }
    return db as unknown as Db;
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
