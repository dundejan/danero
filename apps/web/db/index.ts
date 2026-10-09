import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { errorText, logEvent } from '../lib/log';
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
const globalForDb = globalThis as unknown as {
  __daneroDb?: Promise<Db>;
  __daneroPgliteWarned?: boolean;
};

/**
 * Nad čím instance běží — stejná podmínka, podle které se rozhoduje `init()`.
 * Čte ji `/api/health`: bez toho se zmigrovaný Postgres a PGlite v souboru
 * vedle aplikace zvenku nedaly rozlišit (L10-09).
 */
export function databaseKind(): 'postgres' | 'pglite' {
  return process.env.DATABASE_URL ? 'postgres' : 'pglite';
}

/**
 * Produkční start bez `DATABASE_URL` se neblokuje (`pnpm test:e2e:prod` takhle
 * běží záměrně), ale nesmí být tichý: data jdou do souboru vedle aplikace, ne
 * do zálohované databáze. Jednou za běh procesu — příznak je v globálu ze
 * stejného důvodu jako spojení samo.
 */
function warnPgliteInProduction(dataDir: string): void {
  if (process.env.NODE_ENV !== 'production' || globalForDb.__daneroPgliteWarned) return;
  globalForDb.__daneroPgliteWarned = true;
  logEvent('warn', 'db.pglite_in_production', {
    dataDir,
    hint: 'DATABASE_URL není nastavená — data se ukládají do místního souboru, ne do Postgresu',
  });
}

/** „… already exists, skipping“ u schématu a tabulky — migrátor je vyvolá při každém startu kromě prvního. */
const EXPECTED_NOTICE_CODES = new Set(['42P06', '42P07']);

/**
 * postgres.js bez `onnotice` vypíše každou NOTICE přes `console.log` jako
 * víceřádkový objekt, což rozbíjí „jeden JSON řádek na událost“ (L10-10).
 * Dvě očekávané z migrátoru nenesou žádnou informaci a zahazují se, ostatní
 * jdou do logu jedním řádkem.
 */
export function logPostgresNotice(notice: postgres.Notice): void {
  if (notice.code && EXPECTED_NOTICE_CODES.has(notice.code)) return;
  logEvent(notice.severity === 'WARNING' ? 'warn' : 'info', 'db.notice', {
    code: notice.code,
    severity: notice.severity,
    message: errorText(notice.message ?? '', 300),
  });
}

export function getDb(): Promise<Db> {
  // Odmítnutý Promise se NESMÍ zacachovat: kdyby byla databáze při prvním dotazu
  // chvilku dole (restart Neonu, migrace při startu v Dockeru), zůstal by v paměti
  // navždy a instance by vracela 503 do konce života procesu — i po tom, co se
  // databáze vrátí. `restart: unless-stopped` to nevytrhne, proces totiž běží dál.
  globalForDb.__daneroDb ??= init().catch((error: unknown) => {
    delete globalForDb.__daneroDb;
    throw error;
  });
  return globalForDb.__daneroDb;
}

async function init(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const client = postgres(url, { prepare: false, onnotice: logPostgresNotice });
    const db = drizzlePostgres(client, { schema });
    if (process.env.DANERO_MIGRATE_ON_START === '1') {
      await migratePostgres(db, { migrationsFolder: join(process.cwd(), 'db/migrations') });
    }
    return db as unknown as Db;
  }
  const dataDir = process.env.PGLITE_DATA_DIR ?? '.data/danero';
  warnPgliteInProduction(dataDir);
  return createPgliteDb(dataDir);
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
