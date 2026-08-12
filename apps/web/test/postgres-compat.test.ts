import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@/db';
import * as schema from '@/db/schema';
import {
  appRateLimits,
  auditLog,
  brokerAccounts,
  fxRates,
  importBatches,
  instrumentPrices,
  jobs,
  notificationPrefs,
  notifications,
  reportPurchases,
  session,
  subscriptions,
  taxpayerProfiles,
  taxYearSettings,
  transactions,
  user,
  verification,
} from '@/db/schema';
import { logAudit, pruneAuditLog } from '@/lib/audit';
import { recordReportPurchase, upsertSubscription } from '@/lib/billing';
import { fetchCnbYear, loadCnbRateProvider } from '@/lib/cnb';
import { importCsvText, loadImportState } from '@/lib/import-service';
import {
  enqueueSyncJob,
  processPendingJobs,
  pruneJobs,
  recoverStaleJobs,
} from '@/lib/jobs';
import { processUserNotifications } from '@/lib/notifications';
import { getProfile, loadTransactions, pinTaxYear } from '@/lib/portfolio';
import { upsertInstrumentPrices } from '@/lib/prices';
import { checkRateLimit, pruneRateLimits } from '@/lib/rate-limit';
import {
  pruneImportBatches,
  pruneNotifications,
  pruneSessions,
  pruneVerifications,
} from '@/lib/retention';

/**
 * Kompatibilita s PRODUKČNÍM Postgresem.
 *
 * Zbytek testů běží na PGlite, které je tolerantnější než postgres.js — a přesně
 * proto 6. 8. 2026 prošel do produkce rozbitý import: `Date` v syrovém `sql`
 * fragmentu driver odmítne, PGlite ne. Tenhle soubor jede proti opravdovému
 * Postgresu, aby se to už neopakovalo.
 *
 * Pokrývané produkční cesty: import výpisu, načtení transakcí, fronta jobů
 * (včetně souběhu na parciálním unikátním indexu), notifikační digest, denní
 * úklid, kurzy ČNB, předplatné a nákup podkladů, ceny instrumentů, fixace roku
 * a kaskádové smazání účtu.
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

  /** Vlastní uživatel na test — souběžné běhy si tak nelezou do zelí. */
  let seq = 0;
  async function makeUser(): Promise<string> {
    seq += 1;
    const id = `pg-${Date.now()}-${seq}`;
    await db.insert(user).values({ id, name: 'PG', email: `${id}@danero.cz` });
    await db.insert(taxpayerProfiles).values({ userId: id, regime: 'PAUSAL' });
    return id;
  }


  /**
   * A2-3-06 + B-3-2: migrace 0031 přepisuje eToro derivátům klíč instrumentu na
   * `CFD:<ticker>` a 0032 přepočítává `dedupe_key` všech uložených transakcí na
   * sémantický tvar. Obě sahají na týž sloupec, takže se testují jako řetěz —
   * rozhodující je stav PO obou. Bez přepočtu by se tytéž řádky při dalším
   * importu téhož výpisu uložily podruhé.
   *
   * Hash v migracích je ruční port `fnv1a64` do PL/pgSQL, takže tenhle test
   * porovnává výsledek migrace se skutečným klíčem z TypeScriptu.
   */
  it('migrace 0031 + 0032: eToro derivát dostane klíč CFD: a sedící dedupe_key', async () => {
    const userId = await makeUser();
    const { dedupeKey } = await import('@danero/importers');
    const { TransactionSchema } = await import('@danero/shared');

    const puvodni = TransactionSchema.parse({
      type: 'SELL',
      id: 'etoro-2400000011-open',
      isin: 'BTC',
      ticker: 'BTC',
      assetClass: 'DERIVATIVE',
      settlementStyle: 'MARGIN',
      quantity: '1',
      pricePerShare: '150',
      currency: 'USD',
      tradeDate: '2024-04-01',
      settlementDate: '2024-04-01',
    });
    await db.insert(transactions).values({
      userId,
      dedupeKey: dedupeKey('etoro', puvodni),
      batchId: 'davka-0031',
      broker: 'etoro',
      type: 'SELL',
      txDate: '2024-04-01',
      isin: 'BTC',
      payload: JSON.parse(JSON.stringify(puvodni)) as unknown,
    });

    const { readFileSync } = await import('node:fs');
    // stejně jako migrátor: soubor se dělí na `--> statement-breakpoint`,
    // driver víc příkazů v jednom dotazu nepřijme
    for (const soubor of [
      '0031_etoro_derivative_isin.sql',
      '0032_semantic_dedupe_key.sql',
    ]) {
      const migrace = readFileSync(`db/migrations/${soubor}`, 'utf8');
      for (const prikaz of migrace.split('--> statement-breakpoint')) {
        if (prikaz.trim() !== '') await db.execute(sql.raw(prikaz));
      }
    }

    const [radek] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.batchId, 'davka-0031')));

    expect(radek!.isin).toBe('CFD:BTC');
    expect((radek!.payload as { isin: string }).isin).toBe('CFD:BTC');

    // klíč musí sedět na to, co by spočítal importér po opravě parseru —
    // jinak by se řádek při dalším importu uložil podruhé
    const poOprave = TransactionSchema.parse({ ...puvodni, isin: 'CFD:BTC' });
    expect(radek!.dedupeKey).toBe(dedupeKey('etoro', poOprave));
  });

  /** Dvě dávky insertu (chunk = 500) + jedna transakce s extrémní přesností. */
  function csvRows(count: number): string {
    const lines = ['type,date,isin,ticker,quantity,price,currency,note'];
    for (let i = 0; i < count; i += 1) {
      lines.push(
        `BUY,2024-03-11,US${String(i % 40).padStart(9, '0')}5,T${i % 40},1.000000001,123456789.123456789,USD,b${i}`,
      );
    }
    return lines.join('\n');
  }

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

  it('stav importu čte id z payloadu i na ostrém Postgresu', { timeout: 30_000 }, async () => {
    // `payload ->> 'id'` je syrový SQL fragment — PGlite je tolerantnější než
    // produkční driver, takže tenhle dotaz patří sem (viz „známé zrady“).
    const userId = `u-${Date.now()}`;
    await db.insert(user).values({ id: userId, name: 'PG', email: `${userId}@danero.cz` });
    await db.insert(transactions).values({
      userId,
      dedupeKey: `etoro|${Date.now()}|1`,
      batchId: crypto.randomUUID(),
      broker: 'etoro',
      type: 'BUY',
      txDate: '2026-01-15',
      isin: 'US0378331005',
      payload: { id: 'etoro-42-open', type: 'BUY' },
    });

    const state = await loadImportState(db, userId);
    expect(state.keys.size).toBe(1);
    expect(state.brokerIds.has('etoro|etoro-42-open')).toBe(true);
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

  it('stav databáze projde i nad čerstvou, nezmigrovanou databází (G-M1)', {
    timeout: 60_000,
  }, async () => {
    // V .github/workflows/migrate.yml běží `db/status.mjs` jako krok „Stav
    // před" PŘED migrací. Dokud padal na chybějící `drizzle.__drizzle_migrations`,
    // workflow nad novou databází skončil dřív, než se k migraci vůbec dostal —
    // bootstrap přes CI tedy nebyl možný.
    const { execFileSync } = await import('node:child_process');

    const client = postgres(URL!, { max: 1, prepare: false });
    const name = `status_test_${Date.now()}`;
    await client.unsafe(`CREATE DATABASE ${name}`);
    const target = new global.URL(URL!);
    target.pathname = `/${name}`;

    let output = '';
    let failed = false;
    try {
      output = String(
        execFileSync('node', ['db/status.mjs'], {
          env: { ...process.env, DATABASE_URL: target.toString() },
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      );
    } catch (error) {
      const err = error as { stdout: Buffer; stderr: Buffer };
      failed = true;
      output = `${err.stdout}${err.stderr}`;
    } finally {
      await client.unsafe(`DROP DATABASE IF EXISTS ${name}`);
      await client.end();
    }

    expect(failed).toBe(false);
    expect(output).toContain('tabulek:              0');
    expect(output).toContain('databáze ještě nebyla migrovaná');
    // a nesmí to být pád driveru přeposlaný do CI logu
    expect(output).not.toContain('PostgresError');
  });

  it(
    'import výpisu: dvě dávky insertu, jsonb payload i opakovaný import',
    { timeout: 60_000 },
    async () => {
      const userId = await makeUser();
      const csv = csvRows(600); // > chunk 500 → dva inserty, druhý musí navázat

      const first = await importCsvText(db, userId, 'vypis.csv', csv);
      expect(first.added).toBe(600);
      // idempotence: týž soubor podruhé nesmí přidat ani řádek (PK userId+dedupeKey)
      const second = await importCsvText(db, userId, 'vypis.csv', csv);
      expect(second.added).toBe(0);
      expect(second.duplicates).toBe(600);

      // jsonb → Zod → Decimal: postgres.js vrací jsonb jako objekt, PGlite taky —
      // ale peníze musí projít TAM I ZPĚT bez ztráty jediné číslice
      const txs = await loadTransactions(db, userId);
      expect(txs).toHaveLength(600);
      const buy = txs[0]!;
      if (buy.type !== 'BUY') throw new Error('první transakce má být BUY');
      expect(buy.pricePerShare.toString()).toBe('123456789.123456789');
      expect(buy.quantity.toString()).toBe('1.000000001');

      // dávka importu i audit záznam vzniknou (obojí je součást téže cesty)
      const batches = await db
        .select()
        .from(importBatches)
        .where(eq(importBatches.userId, userId));
      expect(batches).toHaveLength(2);
      const audit = await db.select().from(auditLog).where(eq(auditLog.userId, userId));
      expect(audit).toHaveLength(2);
    },
  );

  it(
    'fronta jobů: souběžný enqueue na parciálním unikátním indexu a zpracování',
    { timeout: 60_000 },
    async () => {
      const userId = await makeUser();
      const accountId = `acc-${userId}`;
      await db.insert(brokerAccounts).values({
        id: accountId,
        userId,
        broker: 'trading212',
        credentialsEncrypted: 'nepodstatné',
      });

      // dvě spojení = skutečný souběh; index jobs_active_unique_idx smí pustit
      // jen jeden aktivní job a druhý enqueue musí unique_violation přežít
      const other = drizzle(postgres(URL!, { max: 1, prepare: false }), {
        schema,
      }) as unknown as Db;
      const [a, b] = await Promise.all([
        enqueueSyncJob(db, userId, accountId, 't212-sync'),
        enqueueSyncJob(other, userId, accountId, 't212-sync'),
      ]);
      expect(a.id).toBe(b.id);
      const active = await db
        .select()
        .from(jobs)
        .where(and(eq(jobs.userId, userId), eq(jobs.dedupeKey, accountId)));
      expect(active).toHaveLength(1);

      // zpracování: účet má neplatný klíč, takže job skončí chybou — podstatné
      // je, že se claimne, dojde do koncového stavu a nezůstane viset v running
      await processPendingJobs(db);
      const [finished] = await db.select().from(jobs).where(eq(jobs.id, a.id));
      expect(['success', 'error']).toContain(finished!.status);
      expect(finished!.finishedAt).not.toBeNull();
    },
  );

  it('digest notifikací: claim před odesláním a timestamptz okna', { timeout: 60_000 }, async () => {
    const userId = await makeUser();
    await db.insert(notifications).values({
      userId,
      dedupeKey: 'limit|100k|EXCEEDED|2026',
      type: 'LIMIT_EXCEEDED',
      title: 'Prolomen limit',
      body: 'test',
    });

    const sent: string[] = [];
    const target = { id: userId, email: `${userId}@danero.cz` };
    const send = async (message: { subject: string }) => void sent.push(message.subject);

    const first = await processUserNotifications(db, target, { send, today: '2026-08-07' });
    expect(first.emailed).toBe(1);
    // druhý běh téhož dne (ruční re-trigger nebo dvojí doručení cronu) už nesmí
    // poslat nic — claim je zapsaný v emailedAt
    const again = await processUserNotifications(db, target, { send, today: '2026-08-07' });
    expect(again.emailed).toBe(0);
    expect(sent).toHaveLength(1);

    const pending = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.emailedAt)));
    expect(pending).toHaveLength(0);

    // lastDigestAt je timestamptz — round-trip musí sedět na milisekundu
    const [prefs] = await db
      .select()
      .from(notificationPrefs)
      .where(eq(notificationPrefs.userId, userId));
    expect(prefs!.lastDigestAt?.toISOString()).toBe('2026-08-07T00:00:00.000Z');
  });

  it('denní úklid: audit, rate limity i joby se smažou a podruhé nemají co', {
    timeout: 60_000,
  }, async () => {
    const userId = await makeUser();
    const stary = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    await db
      .insert(auditLog)
      .values({ id: `al-${userId}`, userId, type: 'LOGIN', createdAt: stary });
    await db
      .insert(appRateLimits)
      .values({ key: `rl-${userId}`, count: 1, resetAt: stary });
    // dva joby na týž klíč: nejnovější zůstává (nese resume plného syncu)
    await db.insert(jobs).values([
      {
        id: `j1-${userId}`,
        userId,
        type: 't212-sync',
        dedupeKey: `k-${userId}`,
        status: 'success',
        createdAt: stary,
      },
      {
        id: `j2-${userId}`,
        userId,
        type: 't212-sync',
        dedupeKey: `k-${userId}`,
        status: 'success',
        createdAt: new Date(stary.getTime() + 1000),
      },
    ]);

    // tabulky, které do 8. 8. 2026 neuklízel nikdo (G-R1) — mažou se přes
    // `IN (poddotaz LIMIT …)`, což je konstrukce, kterou PGlite spolkne vždycky
    await db.insert(session).values({
      id: `s-${userId}`,
      userId,
      token: `tok-${userId}`,
      expiresAt: stary,
    });
    await db.insert(verification).values({
      id: `v-${userId}`,
      identifier: `reset:${userId}`,
      value: 'token',
      expiresAt: stary,
    });
    await db.insert(importBatches).values({
      id: `ib-${userId}`,
      userId,
      broker: 'trading212',
      filename: 'stary.csv',
      added: 1,
      duplicates: 0,
      errorCount: 0,
      skippedCount: 0,
      warningCount: 0,
      issues: {},
      createdAt: stary,
    });

    expect(await pruneAuditLog(db)).toBeGreaterThanOrEqual(1);
    expect(await pruneRateLimits(db)).toBeGreaterThanOrEqual(1);
    expect(await pruneJobs(db)).toBeGreaterThanOrEqual(1);
    expect(await pruneSessions(db)).toBeGreaterThanOrEqual(1);
    expect(await pruneVerifications(db)).toBeGreaterThanOrEqual(1);
    expect(await pruneImportBatches(db)).toBeGreaterThanOrEqual(1);
    expect(await pruneNotifications(db)).toBeGreaterThanOrEqual(0);

    const zbylo = await db.select().from(jobs).where(eq(jobs.userId, userId));
    expect(zbylo).toHaveLength(1);
    expect(zbylo[0]!.id).toBe(`j2-${userId}`);
    expect(await db.select().from(session).where(eq(session.userId, userId))).toHaveLength(0);
    expect(
      await db.select().from(importBatches).where(eq(importBatches.userId, userId)),
    ).toHaveLength(0);
    // druhý běh téže údržby už nemá co mazat (idempotence cronu)
    expect(await pruneAuditLog(db)).toBe(0);
    expect(await pruneSessions(db)).toBe(0);
    expect(await pruneImportBatches(db)).toBe(0);
    const audit = await db.select().from(auditLog).where(eq(auditLog.userId, userId));
    expect(audit).toHaveLength(0);
  });

  it('kurzy ČNB: numeric se vrátí jako string bez ztráty přesnosti', {
    timeout: 60_000,
  }, async () => {
    const text = ['Datum|1 USD|100 JPY|1000 IDR', '02.01.1998|22,123456|15,987654|1,5074'].join(
      '\n',
    );
    const fetchImpl: typeof fetch = (async () =>
      new Response(text, { status: 200 })) as typeof fetch;
    await fetchCnbYear(db, 1998, fetchImpl);

    const [row] = await db
      .select()
      .from(fxRates)
      .where(and(eq(fxRates.day, '1998-01-02'), eq(fxRates.currency, 'USD')));
    // numeric přes postgres.js MUSÍ přijít jako string — number by tiše ořezal
    // přesnost a s ním i každý přepočet, který ten kurz použije
    // (numeric(18,10) doplní hodnotu nulami na deklarovaný scale)
    expect(typeof row!.rate).toBe('string');
    expect(row!.rate).toBe('22.1234560000');

    const provider = await loadCnbRateProvider(db, 1998, 1998);
    expect(provider.getRate('USD', '1998-01-02')?.toString()).toBe('22.123456');
    // Kotace za 100/1000 se normalizuje na jednotku a desetinná místa přibývají:
    // 15,987654 / 100 = 0,15987654 a 1,5074 / 1000 = 0,0015074. Do 7. 8. 2026 byl
    // sloupec numeric(18,6) a obě hodnoty se tiše ZAOKROUHLILY (0,159877 a
    // 0,001507) — u kotace za 1000 to je chyba v desetinách procenta. Reálný
    // kurzovní lístek ČNB má 3 desetinná místa, takže se to zatím nedělo, ale
    // scale 6 na to stačil přesně na doraz (IDR: 1,507/1000 = 0,001507).
    expect(provider.getRate('JPY', '1998-01-02')?.toString()).toBe('0.15987654');
    expect(provider.getRate('IDR', '1998-01-02')?.toString()).toBe('0.0015074');
  });

  it('předplatné a nákup podkladů: upsert i unikátní index (rok se neprodá dvakrát)', {
    timeout: 60_000,
  }, async () => {
    const userId = await makeUser();
    const konec = new Date('2027-01-01T00:00:00Z');
    await upsertSubscription(db, {
      userId,
      status: 'active',
      currentPeriodEnd: konec,
      cancelAtPeriodEnd: false,
      stripeCustomerId: 'cus_test',
      stripeSubscriptionId: 'sub_test',
      promoCode: 'PARTNER',
      eventAt: new Date('2026-01-01T00:00:00Z'),
    });
    // obnova nenese promokód — upsert ho nesmí přepsat na null
    await upsertSubscription(db, {
      userId,
      status: 'active',
      currentPeriodEnd: new Date('2028-01-01T00:00:00Z'),
      cancelAtPeriodEnd: false,
      eventAt: new Date('2027-01-01T00:00:00Z'),
    });
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    expect(sub!.promoCode).toBe('PARTNER');
    expect(sub!.currentPeriodEnd.toISOString()).toBe('2028-01-01T00:00:00.000Z');

    expect(await recordReportPurchase(db, { userId, taxYear: 2025 })).toBe(true);
    // druhý webhook o téže platbě narazí na report_purchases_user_year_idx
    expect(await recordReportPurchase(db, { userId, taxYear: 2025 })).toBe(false);
    const purchases = await db
      .select()
      .from(reportPurchases)
      .where(eq(reportPurchases.userId, userId));
    expect(purchases).toHaveLength(1);
  });

  it('ceny instrumentů a fixace roku: upsert na složeném klíči', {
    timeout: 60_000,
  }, async () => {
    const userId = await makeUser();
    const asOf = new Date('2026-08-07T09:00:00Z');
    expect(
      await upsertInstrumentPrices(
        db,
        userId,
        'trading212',
        [
          { isin: 'US0000000015', price: '123.456', currency: 'USD' },
          // GBX se převádí na GBP dělením stem — ověřuje se i tady, protože
          // hodnota jde do numeric/text sloupce a musí přežít round-trip
          { isin: 'GB0000000015', price: '250', currency: 'GBX' },
        ],
        asOf,
      ),
    ).toBe(2);
    // druhý sync tytéž ISINy přepíše, nezdvojí
    await upsertInstrumentPrices(
      db,
      userId,
      'trading212',
      [{ isin: 'US0000000015', price: '130.5', currency: 'USD' }],
      asOf,
    );
    const prices = await db
      .select()
      .from(instrumentPrices)
      .where(eq(instrumentPrices.userId, userId));
    expect(prices).toHaveLength(2);
    expect(prices.find((p) => p.isin === 'US0000000015')!.price).toBe('130.5');
    expect(prices.find((p) => p.isin === 'GB0000000015')!.price).toBe('2.5');

    // R-05c: fixace konfigurace roku — onConflictDoNothing().returning() na
    // složeném primárním klíči, dvakrát za sebou nesmí přepsat ani spadnout
    const profile = (await getProfile(db, userId))!;
    await pinTaxYear(db, profile, 2024, 2026);
    await pinTaxYear(
      db,
      { ...profile, matchingMethod: 'LIFO', fxMethod: 'CNB_DAILY', limit100kStrict: false },
      2024,
      2026,
    );
    const pinned = await db
      .select()
      .from(taxYearSettings)
      .where(eq(taxYearSettings.userId, userId));
    expect(pinned).toHaveLength(1);
    // text i boolean musí přežít round-trip přes postgres.js (ne jen PGlite)
    expect(pinned[0]).toMatchObject({
      matchingMethod: 'FIFO',
      fxMethod: 'UNIFIED',
      limit100kStrict: true,
    });
  });

  it('smazání účtu odnese kaskádou všechna navázaná data', { timeout: 60_000 }, async () => {
    const userId = await makeUser();
    await importCsvText(
      db,
      userId,
      'x.csv',
      ['type,date,isin,ticker,quantity,price,currency,note', 'BUY,2024-01-02,US0000000015,A,1,10,USD,x'].join(
        '\n',
      ),
    );
    await db.insert(brokerAccounts).values({
      id: `acc-del-${userId}`,
      userId,
      broker: 'trading212',
      credentialsEncrypted: 'x',
    });
    await db.insert(notifications).values({
      userId,
      dedupeKey: 'x',
      type: 'LIMIT_EXCEEDED',
      title: 't',
      body: 'b',
    });

    await db.delete(user).where(eq(user.id, userId));

    for (const [label, rows] of [
      ['transactions', await db.select().from(transactions).where(eq(transactions.userId, userId))],
      ['import_batches', await db.select().from(importBatches).where(eq(importBatches.userId, userId))],
      ['audit_log', await db.select().from(auditLog).where(eq(auditLog.userId, userId))],
      ['broker_accounts', await db.select().from(brokerAccounts).where(eq(brokerAccounts.userId, userId))],
      ['notifications', await db.select().from(notifications).where(eq(notifications.userId, userId))],
      ['taxpayer_profiles', await db.select().from(taxpayerProfiles).where(eq(taxpayerProfiles.userId, userId))],
    ] as const) {
      expect(rows, `po smazání účtu zůstaly řádky v ${label}`).toHaveLength(0);
    }
  });

  it('health endpoint: počet migrací se přečte i přes postgres.js', {
    timeout: 60_000,
  }, async () => {
    // /api/health je jediná cesta, kterou vidí monitoring — a jako jediná
    // používá `db.transaction()` se `SET LOCAL statement_timeout`. Dosud se
    // testovala jen na PGlite; postgres.js má vlastní tvar výsledku (pole řádků
    // místo objektu s `rows`), takže právě tady by se rozdíl driverů schoval.
    const journal = (await import('@/db/migrations/meta/_journal.json')).default;
    const vysledek = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = 4000`);
      return tx.execute(sql`SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations`);
    });
    const rows = (
      Array.isArray(vysledek) ? vysledek : ((vysledek as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ applied?: number | string }>;
    expect(Number(rows[0]?.applied ?? 0)).toBe(journal.entries.length);
  });

  it('logAudit zapíše i bez detailu a čte se seřazeně', { timeout: 30_000 }, async () => {
    const userId = await makeUser();
    await logAudit(db, userId, 'LOGIN');
    await logAudit(db, userId, 'IMPORT', 'x.csv (universal): 1 nových');
    const rows = await db.select().from(auditLog).where(eq(auditLog.userId, userId));
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.detail === null)).toBe(true);
  });
});
