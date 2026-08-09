import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { dedupeTransactions, fnv1a64 } from '@danero/importers';
import { TransactionSchema, type Transaction } from '@danero/shared';
import { createPgliteDb } from '@/db';
import { transactions, user } from '@/db/schema';

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
async function runMigration(db: Awaited<ReturnType<typeof createPgliteDb>>): Promise<void> {
  const migrace = readFileSync('db/migrations/0032_semantic_dedupe_key.sql', 'utf8');
  for (const prikaz of migrace.split('--> statement-breakpoint')) {
    if (prikaz.trim() !== '') await db.execute(sql.raw(prikaz));
  }
}

describe('migrace 0032: přepočet dedupe klíčů uložených transakcí (B-3-2)', () => {
  it('klíče po migraci sedí na to, co spočítá importér', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u-dedupe', name: 'Test', email: 'dedupe@danero.cz' });
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
