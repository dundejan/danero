import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@/db';
import * as schema from '@/db/schema';
import { appRateLimits, fxRates, jobs, user } from '@/db/schema';
import { fetchCnbYear } from '@/lib/cnb';
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

  it(
    'kurzy ČNB: duplicitní (den, měna) v jedné dávce neshodí upsert (G-5)',
    { timeout: 30_000 },
    async () => {
      // ČNB umí mít měnu v hlavičce dvakrát. Bez deduplikace vrátí Postgres
      // „ON CONFLICT DO UPDATE command cannot affect row a second time“
      // a celý fx cron umře — PGlite tuhle chybu nehlásí stejně, proto test tady.
      const text = ['Datum|1 EUR|1 EUR|1 USD', '02.01.1999|25,120|25,120|22,510'].join('\n');
      const fetchImpl: typeof fetch = (async () =>
        new Response(text, { status: 200 })) as typeof fetch;

      await expect(fetchCnbYear(db, 1999, fetchImpl)).resolves.toBe(2);

      const stored = await db
        .select({ currency: fxRates.currency, rate: fxRates.rate })
        .from(fxRates)
        .where(eq(fxRates.day, '1999-01-02'));
      expect(stored).toHaveLength(2);
    },
  );

  it('neúspěšná migrace vypíše celou chybu včetně SQLSTATE (M-4)', { timeout: 60_000 }, async () => {
    // `drizzle-kit migrate` po selhání vypsal 250 B logu bez jediného vodítka —
    // db/migrate.mjs musí ukázat SQLSTATE, hlášku i dotaz, na kterém to spadlo
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = mkdtempSync(join(tmpdir(), 'danero-migrate-'));
    mkdirSync(join(dir, 'meta'), { recursive: true });
    writeFileSync(join(dir, '0000_rozbita.sql'), 'CREATE TABLE "x" ("a" nonexistent_type);');
    writeFileSync(
      join(dir, 'meta/_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'postgresql',
        entries: [{ idx: 0, version: '7', when: 1, tag: '0000_rozbita', breakpoints: true }],
      }),
    );

    // vlastní prázdná databáze — jinak by drizzle migraci s when=1 přeskočil
    const client = postgres(URL!, { max: 1, prepare: false });
    const name = `mig_test_${Date.now()}`;
    await client.unsafe(`CREATE DATABASE ${name}`);
    const target = new global.URL(URL!);
    target.pathname = `/${name}`;

    let output = '';
    let failed = false;
    try {
      execFileSync('node', ['db/migrate.mjs', dir], {
        env: { ...process.env, DATABASE_URL: target.toString() },
        // bez tohohle propadne stderr skriptu do výpisu testů
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const err = error as { stdout: Buffer; stderr: Buffer };
      failed = true;
      output = `${err.stdout}${err.stderr}`;
    } finally {
      await client.unsafe(`DROP DATABASE IF EXISTS ${name}`);
      await client.end();
    }

    expect(failed).toBe(true);
    expect(output).toContain('42704'); // SQLSTATE: undefined_object
    expect(output).toContain('nonexistent_type');
    expect(output).toContain('Migrace SELHALA');
  });
});
