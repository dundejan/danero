import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@/db';
import * as schema from '@/db/schema';
import { appRateLimits, jobs, user } from '@/db/schema';
import { recoverStaleJobs } from '@/lib/jobs';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * Kompatibilita s PRODUKČNÍM Postgresem.
 *
 * Zbytek testů běží na PGlite, které je tolerantnější než postgres.js — a přesně
 * proto 6. 8. 2026 prošel do produkce rozbitý import: `Date` v syrovém `sql`
 * fragmentu driver odmítne, PGlite ne. Tenhle soubor jede proti opravdovému
 * Postgresu, aby se to už neopakovalo.
 *
 * Bez `TEST_DATABASE_URL` se přeskočí (lokálně stačí:
 * `docker run -d -p 55433:5432 -e POSTGRES_PASSWORD=test postgres:17-alpine`).
 */
const URL = process.env.TEST_DATABASE_URL;
const popis = URL ? describe : describe.skip;

popis('kompatibilita s produkčním Postgresem', () => {
  let db: Db;

  beforeAll(async () => {
    const client = postgres(URL!, { max: 1, prepare: false });
    db = drizzle(client, { schema }) as unknown as Db;
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    await migrate(drizzle(client), { migrationsFolder: 'db/migrations' });
  }, 60_000);

  it('rate limit počítá a po vypršení okna se resetuje', { timeout: 30_000 }, async () => {
    const key = `test:${Date.now()}`;
    expect(await checkRateLimit(db, key, { max: 2, windowMs: 60_000 })).toBe(true);
    expect(await checkRateLimit(db, key, { max: 2, windowMs: 60_000 })).toBe(true);
    expect(await checkRateLimit(db, key, { max: 2, windowMs: 60_000 })).toBe(false);

    // posuň okno do minulosti → další request musí začít od nuly. Právě tahle
    // větev (CASE s porovnáním časů) padala na produkci: Date v syrovém sql
    await db
      .update(appRateLimits)
      .set({ resetAt: new Date(Date.now() - 1000) })
      .where(eq(appRateLimits.key, key));

    expect(await checkRateLimit(db, key, { max: 2, windowMs: 60_000 })).toBe(true);
    const [row] = await db
      .select({ count: appRateLimits.count, resetAt: appRateLimits.resetAt })
      .from(appRateLimits)
      .where(eq(appRateLimits.key, key));
    expect(row?.count).toBe(1);
    // nové okno se posunulo do budoucnosti
    expect(row!.resetAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('záchrana zaseknutých jobů projde bez chyby driveru', { timeout: 30_000 }, async () => {
    const userId = `u-${Date.now()}`;
    await db.insert(user).values({ id: userId, name: 'PG', email: `${userId}@danero.cz` });
    const davno = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db.insert(jobs).values({
      id: `j-${Date.now()}`,
      userId,
      type: 'SYNC_T212',
      dedupeKey: `d-${Date.now()}`,
      status: 'running',
      payload: {},
      startedAt: davno,
      createdAt: davno,
    });

    expect(await recoverStaleJobs(db)).toBeGreaterThanOrEqual(1);
  });
});
