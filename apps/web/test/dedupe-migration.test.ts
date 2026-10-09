import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { dedupeTransactions, fnv1a64, parseTrading212Csv } from '@danero/importers';
import { TransactionSchema, type Transaction } from '@danero/shared';
import { createPgliteDb } from '@/db';
import { importBatches, transactions, user, verification } from '@/db/schema';
import { importCsvText } from '@/lib/import-service';

/**
 * B-3-2: dedupe klíč stál na otisku SYROVÉHO řádku výpisu, takže změna tvaru
 * exportu (koncová čárka, přidaný sloupec, jiné pořadí) vyrobila jiný klíč
 * a tatáž transakce se uložila podruhé. Klíč nově nese jen obsah události
 * a pořadí výskytu — a migrace 0032 musí srovnat i data, která v databázi
 * už leží. Bez přepočtu by se každý dosud importovaný řádek při dalším importu
 * téhož výpisu uložil znovu.
 *
 * Hash v migraci je ruční port `fnv1a64` do PL/pgSQL, proto se tady porovnává
 * výsledek migrace se skutečným klíčem z TypeScriptu.
 */

const BROKER = 'trading212';

/** Datum do sloupce `tx_date` — stejně jako import-service. */
const txDate = (tx: Transaction): string =>
  tx.type === 'BUY' || tx.type === 'SELL' ? tx.tradeDate : tx.date;

/** Klíč, jak vypadal PŘED opravou: broker + otisk obsahu VČETNĚ id transakce. */
const legacyKey = (tx: Transaction): string =>
  `${BROKER}|${fnv1a64(`${tx.type}|${tx.id}|starý tvar řádku`)}`;

const FIXTURE: Transaction[] = [
  {
    type: 'BUY',
    id: 't212-buy-1',
    isin: 'US0378331005',
    ticker: 'AAPL',
    quantity: '10',
    pricePerShare: '185.5',
    currency: 'USD',
    tradeDate: '2024-06-10',
    settlementDate: '2024-06-11',
  },
  {
    type: 'DIVIDEND',
    id: 't212-div-1',
    isin: 'US0378331005',
    gross: '12.5',
    withholdingTax: '1.88',
    currency: 'USD',
    date: '2025-04-01',
  },
  // dva obsahově NEROZLIŠITELNÉ úroky téhož dne: legitimní, takže je pořadí
  // výskytu musí udržet oddělené (a ne sloučit do jednoho klíče)
  { type: 'INTEREST', id: 't212-int-1', amount: '12.34', currency: 'CZK', date: '2025-05-01' },
  { type: 'INTEREST', id: 't212-int-2', amount: '12.34', currency: 'CZK', date: '2025-05-01' },
  {
    type: 'FX_CONVERSION',
    id: 't212-fx-1',
    fromAmount: '100',
    fromCurrency: 'USD',
    toAmount: '2280',
    toCurrency: 'CZK',
    date: '2025-06-02',
  },
  {
    type: 'CORPORATE_ACTION',
    id: 't212-ca-1',
    subtype: 'SPLIT',
    isin: 'US05606L1008',
    date: '2025-07-30',
    ratio: { from: '1', to: '6' },
  },
  {
    type: 'TRANSFER_IN',
    id: 't212-in-1',
    isin: 'US9219378356',
    quantity: '5',
    date: '2025-08-01',
    acquisition: { date: '2020-01-15', costPerShare: '70', currency: 'USD' },
  },
  // `isin` je v modelu obyčejný string, takže si ho uživatel může přes
  // univerzální šablonu zapsat s diakritikou — a port hashe do PL/pgSQL na tom
  // dřív ztroskotal (XORoval jen spodní bajt kódové jednotky)
  {
    type: 'BUY',
    id: 'uni-diakritika',
    isin: 'ČEZ',
    quantity: '3',
    pricePerShare: '1234.5',
    currency: 'CZK',
    tradeDate: '2025-09-01',
    settlementDate: '2025-09-03',
  },
].map((raw) => TransactionSchema.parse(raw));

/** Tělo migrace, jak ho pouští migrátor — po `--> statement-breakpoint`. */
async function runMigration(
  db: Awaited<ReturnType<typeof createPgliteDb>>,
  file = '0032_semantic_dedupe_key.sql',
): Promise<void> {
  const migrace = readFileSync(`db/migrations/${file}`, 'utf8');
  for (const prikaz of migrace.split('--> statement-breakpoint')) {
    if (prikaz.trim() !== '') await db.execute(sql.raw(prikaz));
  }
}

describe('migrace 0032: přepočet dedupe klíčů uložených transakcí (B-3-2)', () => {
  it('klíče po migraci sedí na to, co spočítá importér', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u-dedupe', name: 'Test', email: 'dedupe@danero.cz' });
    // dávka musí existovat: transactions.batch_id na ni má od 0042 cizí klíč (K5-08)
    await db.insert(importBatches).values({
      id: 'stara-davka',
      userId: 'u-dedupe',
      broker: BROKER,
      filename: 'stara-davka.csv',
      added: FIXTURE.length,
      duplicates: 0,
      errorCount: 0,
      skippedCount: 0,
      warningCount: 0,
      issues: { errors: [], skipped: [], warnings: [] },
    });
    await db.insert(transactions).values(
      FIXTURE.map((tx) => ({
        userId: 'u-dedupe',
        dedupeKey: legacyKey(tx),
        batchId: 'stara-davka',
        broker: BROKER,
        type: tx.type,
        txDate: txDate(tx),
        isin: 'isin' in tx ? (tx.isin ?? null) : null,
        payload: JSON.parse(JSON.stringify(tx)) as unknown,
      })),
    );

    await runMigration(db);

    const rows = await db
      .select({ key: transactions.dedupeKey })
      .from(transactions)
      .where(eq(transactions.userId, 'u-dedupe'));
    const ocekavane = dedupeTransactions(BROKER, FIXTURE).fresh.map((row) => row.key);

    expect(rows.map((r) => r.key).sort()).toEqual([...ocekavane].sort());
    // dva identické úroky si drží dvě různá pořadí, ne jeden společný klíč
    expect(new Set(ocekavane).size).toBe(FIXTURE.length);

    // druhý běh migrace (obnova ze zálohy, ruční spuštění) nesmí klíče hýbat
    await runMigration(db);
    const poDruhem = await db
      .select({ key: transactions.dedupeKey })
      .from(transactions)
      .where(eq(transactions.userId, 'u-dedupe'));
    expect(poDruhem.map((r) => r.key).sort()).toEqual(rows.map((r) => r.key).sort());

    // a hlavně: opakovaný import TÉHOŽ výpisu už nesmí přidat ani řádek —
    // ani kdyby broker mezitím změnil tvar exportu (id se nepočítají)
    const znovu = FIXTURE.map((tx) => TransactionSchema.parse({ ...tx, id: `jiny-tvar-${tx.id}` }));
    const outcome = dedupeTransactions(BROKER, znovu, rows.map((r) => r.key));
    expect(outcome.fresh).toEqual([]);
    expect(outcome.duplicates).toBe(FIXTURE.length);
  });
});

/**
 * L14-01, R-07b: parser Trading 212 bral „Price / share“ u dividendy jako
 * brutto, a přitom je to částka na kus PO srážce. Oprava parseru (brutto =
 * kusy × cena + srážka) mění obsahový otisk, takže bez přepočtu uložených dat
 * by se každá dividenda se srážkou při dalším nahrání nebo synchronizaci
 * uložila podruhé. Migrace 0045 proto uloženým dividendám srážku přičte,
 * označí je `grossFromNet` a přepočítá `dedupe_key`.
 *
 * Výpis je smyšlený; čísla jsou volená tak, aby se v součtu objevila koncová
 * nula (28,22 + 4,98 = 33,20 → „33.2“), celé číslo (8,5 + 1,5 = „10“)
 * i zlomkové kusy — formát čísla v SQL musí sedět na `Decimal.toString()`.
 */
const T212_DIVIDENDS_CSV = [
  'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID',
  'Market buy,2025-01-10 14:30:02,US0000000001,ZZTA,Zeta Test Corp,40,61.50,USD,,,,,,,,,EOF1',
  'Dividend (Dividend),2025-03-14 09:00:00,US0000000001,ZZTA,Zeta Test Corp,40,0.7055,USD,,,,25.90,EUR,4.98,USD,,',
  'Dividend (Dividend),2025-05-20 09:00:00,DE0000000002,ZZTB,Beta Test AG,3,5.963625,EUR,,,,17.89,EUR,6.41,EUR,,',
  // dvě obsahově shodné dividendy téhož dne: pořadí 1 a 2 musí přežít
  'Dividend (Dividend),2025-06-02 09:00:00,US0000000003,ZZTC,Gamma Test Inc,10,0.85,USD,,,,7.80,EUR,1.5,USD,,',
  'Dividend (Dividend),2025-06-02 09:00:00,US0000000003,ZZTC,Gamma Test Inc,10,0.85,USD,,,,7.80,EUR,1.5,USD,,',
  // bez srážky: brutto se nemění, řádek zůstává, jak je
  'Dividend (Dividend),2025-07-01 09:00:00,IE0000000004,ZZTD,Delta Test ETF,5,0.3,EUR,,,,1.50,EUR,,,,',
  // srážka v jiné měně: parser ji nuluje a k brutto nepřičítá — migrace taky ne
  'Dividend (Dividend),2025-08-01 09:00:00,US0000000005,ZZTE,Epsilon Test Corp,20,0.425,USD,,,,7.80,EUR,1.38,EUR,,',
  'Dividend (Dividend),2025-09-15 09:00:00,US0000000001,ZZTA,Zeta Test Corp,0.1234567,0.44625,USD,,,,0.05,EUR,0.01,USD,,',
].join('\n');

const GROSS_MIGRATION = '0045_t212_dividend_gross_from_net.sql';

type TestDb = Awaited<ReturnType<typeof createPgliteDb>>;

/** Transakce, jak ji uložil parser PŘED opravou: brutto bez srážky a bez značky. */
function beforeParserFix(tx: Transaction): Transaction {
  if (tx.type !== 'DIVIDEND' || !tx.grossFromNet) return tx;
  const raw = JSON.parse(JSON.stringify(tx)) as Record<string, unknown>;
  delete raw.grossFromNet;
  raw.gross = tx.gross.minus(tx.withholdingTax).toString();
  return TransactionSchema.parse(raw);
}

const toRow = (userId: string, broker: string, tx: Transaction, key: string) => ({
  userId,
  dedupeKey: key,
  batchId: `davka-${userId}`,
  broker,
  type: tx.type,
  txDate: txDate(tx),
  isin: 'isin' in tx ? (tx.isin ?? null) : null,
  payload: JSON.parse(JSON.stringify(tx)) as unknown,
});

async function seedUser(db: TestDb, userId: string): Promise<void> {
  await db.insert(user).values({ id: userId, name: 'Test', email: `${userId}@danero.cz` });
  await db.insert(importBatches).values({
    id: `davka-${userId}`,
    userId,
    broker: BROKER,
    filename: 'stara-davka.csv',
    added: 0,
    duplicates: 0,
    errorCount: 0,
    skippedCount: 0,
    warningCount: 0,
    issues: { errors: [], skipped: [], warnings: [] },
  });
}

async function storedRows(db: TestDb, userId: string) {
  const rows = await db.select().from(transactions).where(eq(transactions.userId, userId));
  return rows.sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));
}

describe('migrace 0045: brutto uložených dividend Trading 212 (L14-01, R-07b)', () => {
  const parsedNow = parseTrading212Csv(T212_DIVIDENDS_CSV).transactions;
  const expected = dedupeTransactions(BROKER, parsedNow).fresh;
  const legacy = dedupeTransactions(BROKER, parsedNow.map(beforeParserFix)).fresh;

  it('výpis ve fixtuře opravdu mění klíče — jinak by test nic nehlídal', () => {
    const changed = legacy.filter((row, i) => row.key !== expected[i]!.key);
    // pět dividend se srážkou v měně titulu; nákup, dividenda bez srážky
    // a dividenda se srážkou v jiné měně mají klíč stejný jako dřív
    expect(changed).toHaveLength(5);
    expect(parsedNow).toHaveLength(8);
  });

  it(
    'klíče i brutto po migraci sedí na nový parser a opakované nahrání nepřidá ani řádek',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      await seedUser(db, 'u-t212');
      await db
        .insert(transactions)
        .values(legacy.map(({ tx, key }) => toRow('u-t212', BROKER, tx, key)));

      await runMigration(db, GROSS_MIGRATION);

      const rows = await storedRows(db, 'u-t212');
      expect(rows.map((r) => r.dedupeKey)).toEqual(expected.map((row) => row.key).sort());
      const byKey = new Map(rows.map((r) => [r.dedupeKey, r.payload as Record<string, unknown>]));
      for (const { tx, key } of expected) {
        if (tx.type !== 'DIVIDEND') continue;
        const payload = byKey.get(key)!;
        expect(payload.gross).toBe(tx.gross.toString());
        expect(payload.withholdingTax).toBe(tx.withholdingTax.toString());
        // značku dostane jen řádek, kterému se brutto opravdu zvedlo
        expect(payload.grossFromNet).toBe(tx.withholdingTax.gt(0) ? true : undefined);
        // a payload musí dál projít modelem — čte ho z něj engine
        expect(TransactionSchema.parse(payload).type).toBe('DIVIDEND');
      }
      // koncová nula i celé číslo: stejný zápis jako Decimal.toString()
      const grossValues = rows.map((r) => (r.payload as { gross?: string }).gross);
      expect(grossValues).toContain('33.2');
      expect(grossValues.filter((value) => value === '10')).toHaveLength(2);

      // opakované nahrání téhož výpisu jde stejnou cestou jako synchronizace
      // (týž parser, týž dedupe) — nesmí přidat ani jednu dividendu
      const again = await importCsvText(db, 'u-t212', 't212-znovu.csv', T212_DIVIDENDS_CSV);
      expect(again.errors).toEqual([]);
      expect(again.added).toBe(0);
      expect(again.duplicates).toBe(parsedNow.length);
      expect(await storedRows(db, 'u-t212')).toHaveLength(parsedNow.length);
    },
  );

  it(
    'dividenda bez srážky, jiný broker, jiný typ a řádek se značkou se nezmění; druhý běh nezmění nic',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      await seedUser(db, 'u-mix');
      const withTax = legacy.find(({ tx }) => tx.type === 'DIVIDEND' && tx.withholdingTax.gt(0))!;
      const untouched = [
        // stejná dividenda u jiného brokera: jeho „brutto“ migrace neposuzuje
        toRow('u-mix', 'degiro', withTax.tx, dedupeTransactions('degiro', [withTax.tx]).fresh[0]!.key),
        // řádek uložený už novým parserem — srážka se nesmí přičíst podruhé
        ...expected
          .filter(({ tx }) => tx.type === 'DIVIDEND' && tx.grossFromNet && tx.withholdingTax.gt(0))
          .slice(0, 1)
          .map(({ tx, key }) => toRow('u-mix', BROKER, tx, key)),
        // dividenda bez srážky, se srážkou v jiné měně a nákup
        ...legacy
          .filter(({ tx }) => tx.type !== 'DIVIDEND' || tx.withholdingTax.eq(0))
          .map(({ tx, key }) => toRow('u-mix', BROKER, tx, key)),
      ];
      expect(untouched).toHaveLength(5);
      // a jedna, která se přepočítat MÁ — ať je vidět, že migrace vůbec běžela
      const pending = legacy.filter(({ tx }) => tx.type === 'DIVIDEND' && tx.withholdingTax.gt(0))[1]!;
      await db.insert(transactions).values([...untouched, toRow('u-mix', BROKER, pending.tx, pending.key)]);
      const before = await storedRows(db, 'u-mix');

      await runMigration(db, GROSS_MIGRATION);

      const afterFirst = await storedRows(db, 'u-mix');
      const untouchedKeys = new Set(untouched.map((row) => row.dedupeKey));
      expect(afterFirst.filter((r) => untouchedKeys.has(r.dedupeKey))).toEqual(
        before.filter((r) => untouchedKeys.has(r.dedupeKey)),
      );
      expect(afterFirst.map((r) => r.dedupeKey)).not.toContain(pending.key);
      expect(afterFirst).toHaveLength(before.length);

      // druhý běh (obnova ze zálohy, ruční spuštění): srážka se z payloadu
      // nepozná, takže bez značky by se přičetla znovu
      await runMigration(db, GROSS_MIGRATION);
      expect(await storedRows(db, 'u-mix')).toEqual(afterFirst);
    },
  );

  it(
    'dividenda uložená starým i novým parserem zároveň: migrace nespadne a nic nesmaže',
    { timeout: 30_000 },
    async () => {
      // Nasazení kódu a migrace neběží v zaručeném pořadí. Když nový parser
      // stihne výpis uložit dřív, leží v databázi tatáž dividenda dvakrát —
      // a cílový klíč starého řádku je obsazený. Migrace ho nechá být (řádek
      // zůstane poznatelný podle chybějící značky), nesmí spadnout na
      // primárním klíči ani mazat data.
      const db = await createPgliteDb();
      await seedUser(db, 'u-dvojice');
      const index = legacy.findIndex(({ tx }) => tx.type === 'DIVIDEND' && tx.withholdingTax.gt(0));
      const pair = [legacy[index]!, expected[index]!];
      expect(pair[0]!.key).not.toBe(pair[1]!.key);
      await db
        .insert(transactions)
        .values(pair.map(({ tx, key }) => toRow('u-dvojice', BROKER, tx, key)));
      const before = await storedRows(db, 'u-dvojice');

      await runMigration(db, GROSS_MIGRATION);
      expect(await storedRows(db, 'u-dvojice')).toEqual(before);
    },
  );
});

/**
 * Migrace 0046 (L21-04): smaže dřív vydaná „důvěryhodná zařízení“ — a nic
 * jiného z tabulky `verification`, kde leží i odkazy na obnovu hesla, výzvy
 * druhého faktoru a spory o adresu.
 */
describe('migrace 0046: dřív vydaná důvěryhodná zařízení (L21-04)', () => {
  const TRUST_MIGRATION = '0046_revoke_trusted_devices.sql';
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const identifiers = async (db: TestDb): Promise<string[]> =>
    (await db.select({ identifier: verification.identifier }).from(verification))
      .map((row) => row.identifier)
      .sort();

  it('maže jen záznamy důvěryhodných zařízení a druhý běh nemění nic', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await db.insert(verification).values([
      { id: 'v1', identifier: 'trust-device-abc123', value: 'u1', expiresAt },
      { id: 'v2', identifier: 'trust-device-def456', value: 'u2', expiresAt },
      { id: 'v3', identifier: 'reset-password:token', value: 'u1', expiresAt },
      { id: 'v4', identifier: 'signup-contest:otisk', value: 'x', expiresAt },
      // podobný začátek, ale jiný tvar — pomlčka za „device“ je součást vzoru
      { id: 'v5', identifier: 'trust-deviceless', value: 'u1', expiresAt },
    ]);

    await runMigration(db, TRUST_MIGRATION);
    const kept = ['reset-password:token', 'signup-contest:otisk', 'trust-deviceless'];
    expect(await identifiers(db)).toEqual(kept);

    await runMigration(db, TRUST_MIGRATION);
    expect(await identifiers(db)).toEqual(kept);
  });
});
