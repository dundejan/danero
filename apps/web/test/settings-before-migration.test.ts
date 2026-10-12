import { readFileSync } from 'node:fs';
import { eq, getTableColumns, getTableName, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';
import { createPgliteDb, type Db } from '@/db';
import * as schema from '@/db/schema';
import { auditLog, notificationPrefs, taxpayerProfiles, user } from '@/db/schema';
import { notificationPrefData, taxpayerProfileData } from '@/db/settings-data';
import { saveNotificationPrefs, saveProfile } from '@/app/(app)/nastaveni/save';
import { notificationFormEntries, profileFormEntries } from '@/app/(app)/nastaveni/form-state';
import {
  BASELINE_FIELD,
  CHANGED_FIELD,
  encodeBaseline,
  SUBMISSION_FIELD,
} from '@/lib/form-baseline';
import {
  getNotificationPrefs,
  listNotificationTargets,
  processUserNotifications,
} from '@/lib/notifications';
import { getProfile, unpinTaxYear } from '@/lib/portfolio';

/**
 * Revize R8, B1 — nový kód nad databází, kde migrace 0047 ještě neproběhla.
 *
 * Push do `main` spouští migraci a build na Vercelu souběžně a pořadí nikdo
 * nezaručuje (`docs/08-provoz.md`, M-5). Kód z `ed392c3` četl i zapisoval
 * tabulky nastavení se všemi sloupci, takže nad databází bez `save_instance`
 * a `save_sequence` končil každý dotaz chybou `column "save_instance" does not
 * exist` — a profil čte každá stránka aplikace, `/api/epo` i cron upozornění.
 *
 * Kód teď ty dva sloupce jmenuje jen v zápisu s pořadím, a ten se při jejich
 * absenci uloží bez pořadí (`orderedOrPlain` v `save.ts`). Test prochází
 * totéž dvakrát — před migrací a po ní — nad PGlite a nad opravdovým
 * Postgresem: postgres.js balí chybu jinak než PGlite a kód SQLSTATE se čte
 * z příčiny.
 *
 * Až migrace 0047 doběhne na produkci a nasazení na ní přestane záviset,
 * může odolnost i tenhle test zmizet (viz `docs/08-provoz.md`).
 */
type Entries = Array<[string, string]>;

const ORDER_COLUMNS = ['save_instance', 'save_sequence'];
const TABLES = ['taxpayer_profiles', 'notification_prefs'];
const MIGRATION = readFileSync('db/migrations/0047_save_order.sql', 'utf8');

/** Odeslání panelu vykresleného se stavem `rendered`: změna `changes`, pořadí `mark`. */
function submission(rendered: Entries, changes: Record<string, string>, mark?: string): FormData {
  const data = new FormData();
  data.append(BASELINE_FIELD, encodeBaseline(rendered));
  for (const name of Object.keys(changes)) data.append(CHANGED_FIELD, name);
  for (const [name, value] of rendered) if (!(name in changes)) data.append(name, value);
  for (const [name, value] of Object.entries(changes)) data.append(name, value);
  if (mark !== undefined) data.append(SUBMISSION_FIELD, mark);
  return data;
}

/** Kolik sloupců pořadí databáze má (0 před migrací, 4 po ní). */
async function orderColumnCount(db: Db): Promise<number> {
  const result = await db.execute(
    sql`SELECT count(*)::int AS count FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN (${sql.join(TABLES.map((name) => sql`${name}`), sql`, `)})
          AND column_name IN (${sql.join(ORDER_COLUMNS.map((name) => sql`${name}`), sql`, `)})`,
  );
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as Array<{
    count: number;
  }>;
  return Number(rows[0]!.count);
}

/** Vrátí databázi do stavu před migrací 0047 — ta jen přidává tyhle čtyři sloupce. */
async function dropOrderColumns(db: Db): Promise<void> {
  for (const table of TABLES) {
    for (const column of ORDER_COLUMNS) {
      await db.execute(sql.raw(`ALTER TABLE "${table}" DROP COLUMN "${column}"`));
    }
  }
  expect(await orderColumnCount(db)).toBe(0);
}

/** Pustí migraci 0047 tak, jak ji pouští migrátor: příkaz po příkazu. */
async function applyMigration(db: Db): Promise<void> {
  for (const statement of MIGRATION.split('--> statement-breakpoint')) {
    if (statement.trim() !== '') await db.execute(sql.raw(statement));
  }
  expect(await orderColumnCount(db)).toBe(4);
}

const savedOrderWarnings = (warn: { mock: { calls: unknown[][] } }): number =>
  warn.mock.calls.filter(([line]) => String(line).includes('settings.save_order_unavailable'))
    .length;

/** Celý průchod: stav před migrací, migrace, stav po ní. */
async function beforeAndAfterMigration(db: Db, tag: string): Promise<void> {
  const userId = `u-b1-${tag}-${Date.now()}`;
  await db.insert(user).values({ id: userId, name: 'B1', email: `${userId}@priklad.test`, emailVerified: true });
  const audits = async (): Promise<number> =>
    (await db.select().from(auditLog).where(eq(auditLog.userId, userId))).filter(
      (event) => event.type === 'PROFILE_CHANGE',
    ).length;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    // ── PŘED MIGRACÍ ────────────────────────────────────────────────────────
    await dropOrderColumns(db);

    // čtení, které dělá každá stránka aplikace i cron
    expect(await getProfile(db, userId)).toBeNull();
    expect(await getNotificationPrefs(db, userId)).toMatchObject({ emailFrequency: 'DAILY' });

    // první uložení profilu tlačítkem (bez pořadí)
    expect(
      await saveProfile(userId, submission(profileFormEntries(null), { rezim: 'PAUSAL' }), db),
    ).toEqual({ ok: true, firstSave: true });
    const panel = profileFormEntries(await getProfile(db, userId));
    expect(savedOrderWarnings(warn)).toBe(0);

    // auto-save nese pořadí: uloží se bez něj a řekne to do logu — ne chybou
    expect(
      await saveProfile(userId, submission(panel, { parovani: 'LIFO' }, 'mezera.1'), db),
    ).toEqual({ ok: true, firstSave: false });
    expect((await getProfile(db, userId))!.matchingMethod).toBe('LIFO');
    expect(savedOrderWarnings(warn)).toBe(1);
    expect(await audits()).toBe(2);
    // bez paměti na pořadí platí, kdo přišel poslední — jako před `ed392c3`
    await saveProfile(userId, submission(panel, { parovani: 'MAX_LOSS' }, 'mezera.3'), db);
    await saveProfile(userId, submission(panel, { parovani: 'FIFO' }, 'mezera.2'), db);
    expect((await getProfile(db, userId))!.matchingMethod).toBe('FIFO');

    // nastavení upozornění: řádek vzniká zápisem s pořadím, pak se mění bez něj
    const prefsPanel = notificationFormEntries(await getNotificationPrefs(db, userId));
    await saveNotificationPrefs(
      userId,
      submission(prefsPanel, { 'frekvence-emailu': 'WEEKLY' }, 'mezera.1'),
      db,
    );
    expect((await getNotificationPrefs(db, userId)).emailFrequency).toBe('WEEKLY');
    await saveNotificationPrefs(userId, submission(prefsPanel, { 'frekvence-emailu': 'DAILY' }), db);
    expect((await getNotificationPrefs(db, userId)).emailFrequency).toBe('DAILY');

    // ostatní, co na ty dvě tabulky sahá: cron upozornění a zrušení fixace roku
    expect((await listNotificationTargets(db)).map((target) => target.id)).toContain(userId);
    await processUserNotifications(
      db,
      { id: userId, email: `${userId}@priklad.test` },
      { send: async () => {}, today: '2026-10-12' },
    );
    await unpinTaxYear(db, userId, 2025);

    // ── MIGRACE ─────────────────────────────────────────────────────────────
    await applyMigration(db);
    // podruhé nesmí spadnout ani nic změnit (obnova ze zálohy, ruční spuštění)
    await applyMigration(db);
    // data z doby před migrací zůstala
    expect(await getProfile(db, userId)).toMatchObject({ regime: 'PAUSAL', matchingMethod: 'FIFO' });
    expect((await getNotificationPrefs(db, userId)).emailFrequency).toBe('DAILY');

    // ── PO MIGRACI ──────────────────────────────────────────────────────────
    const warningsBefore = savedOrderWarnings(warn);
    // pořadí platí: starší odeslání téhož formuláře, které dorazí později, nic nezapíše
    await saveProfile(userId, submission(panel, { parovani: 'LIFO' }, 'po.2'), db);
    await saveProfile(userId, submission(panel, { parovani: 'MAX_PROFIT' }, 'po.1'), db);
    expect((await getProfile(db, userId))!.matchingMethod).toBe('LIFO');
    const [row] = await db.select().from(taxpayerProfiles).where(eq(taxpayerProfiles.userId, userId));
    expect(row).toMatchObject({ saveInstance: 'po', saveSequence: 2 });
    await saveNotificationPrefs(
      userId,
      submission(prefsPanel, { 'frekvence-emailu': 'WEEKLY' }, 'po.2'),
      db,
    );
    await saveNotificationPrefs(
      userId,
      submission(prefsPanel, { 'frekvence-emailu': 'DAILY' }, 'po.1'),
      db,
    );
    expect((await getNotificationPrefs(db, userId)).emailFrequency).toBe('WEEKLY');
    const [prefsRow] = await db
      .select()
      .from(notificationPrefs)
      .where(eq(notificationPrefs.userId, userId));
    expect(prefsRow).toMatchObject({ saveInstance: 'po', saveSequence: 2 });
    expect(savedOrderWarnings(warn)).toBe(warningsBefore);
    // a pořadí se do profilu ani do nastavení upozornění nedostane
    expect(await getProfile(db, userId)).not.toHaveProperty('saveInstance');
    expect(await getNotificationPrefs(db, userId)).not.toHaveProperty('saveSequence');
  } finally {
    warn.mockRestore();
  }
}

describe('nastavení nad databází před migrací 0047 a po ní', () => {
  it('PGlite: čtení i ukládání fungují před migrací, pořadí platí po ní', { timeout: 60_000 }, async () => {
    await beforeAndAfterMigration(await createPgliteDb(), 'pglite');
  });

  /**
   * Opravdový Postgres ve vlastní databázi, která po testu zanikne: sloupce se
   * tu odebírají, a to se nesmí stát databázi, ve které právě běží jiné testy.
   * Bez `TEST_DATABASE_URL` se lokálně přeskočí; že v CI nechybí, hlídá
   * `postgres-compat.test.ts`.
   */
  const URL_BASE = process.env.TEST_DATABASE_URL;
  (URL_BASE ? it : it.skip)(
    'Postgres: totéž přes postgres.js',
    { timeout: 120_000 },
    async () => {
      const name = `danero_b1_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      const admin = postgres(URL_BASE!, { max: 1, prepare: false, onnotice: () => {} });
      await admin.unsafe(`CREATE DATABASE "${name}"`);
      const target = new URL(URL_BASE!);
      target.pathname = `/${name}`;
      const client = postgres(target.toString(), { max: 1, prepare: false, onnotice: () => {} });
      try {
        const { migrate } = await import('drizzle-orm/postgres-js/migrator');
        await migrate(drizzle(client), { migrationsFolder: 'db/migrations' });
        await beforeAndAfterMigration(drizzle(client, { schema }) as unknown as Db, 'pg');
      } finally {
        await client.end();
        await admin.unsafe(`DROP DATABASE "${name}"`);
        await admin.end();
      }
    },
  );
});

/**
 * Pohled bez sloupců pořadí (`db/settings-data.ts`) a úplná tabulka
 * (`db/schema.ts`) popisují tutéž tabulku. Uživatelské sloupce sdílejí, takže
 * se rozejít nemůžou — tohle hlídá zbytek: stejné jméno tabulky, nic navíc,
 * a že úplná tabulka má navíc právě jen pořadí.
 */
describe('pohled na tabulky nastavení bez pořadí odeslání', () => {
  const describeColumns = (table: Parameters<typeof getTableColumns>[0]): Record<string, string> =>
    Object.fromEntries(
      Object.entries(getTableColumns(table)).map(([key, column]) => [
        key,
        `${column.name} ${column.getSQLType()} notNull=${column.notNull} default=${column.hasDefault} pk=${column.primary}`,
      ]),
    );

  it.each([
    ['taxpayer_profiles', taxpayerProfiles, taxpayerProfileData],
    ['notification_prefs', notificationPrefs, notificationPrefData],
  ] as const)('%s: úplná tabulka = pohled + pořadí', (name, full, data) => {
    const { saveInstance, saveSequence, ...rest } = describeColumns(full);
    expect(describeColumns(data)).toEqual(rest);
    expect(saveInstance).toContain('save_instance text');
    expect(saveSequence).toContain('save_sequence integer');
    expect(getTableName(data)).toBe(name);
    expect(getTableName(full)).toBe(name);
  });
});
