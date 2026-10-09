import { and, eq } from 'drizzle-orm';
import type { IsinInstrumentMap, XtbInstrumentMap } from '@danero/importers';
import type { Db } from '@/db';
import { instrumentAliases, transactions } from '@/db/schema';

/**
 * Číselník instrumentů pro brokery, jejichž export neuvádí ISIN (a u XTB ani
 * měnu instrumentu). Plní ho uživatel formulářem při importu; další importy
 * ho použijí samy.
 */

/** Brokeři s mapou symbol → ISIN (měnu mají ve výpisu, resp. vždy USD). */
export const ISIN_ONLY_BROKERS = ['fio', 'etoro', 'revolut', 'schwab', 'tastytrade'] as const;
export type IsinOnlyBroker = (typeof ISIN_ONLY_BROKERS)[number];

export type IsinMap = IsinInstrumentMap;

export interface AliasMaps {
  xtb: XtbInstrumentMap;
  isinOnly: Record<IsinOnlyBroker, IsinMap>;
}

export const isIsinOnlyBroker = (broker: string): broker is IsinOnlyBroker =>
  (ISIN_ONLY_BROKERS as readonly string[]).includes(broker);

export async function loadAliases(db: Db, userId: string): Promise<AliasMaps> {
  const rows = await db
    .select()
    .from(instrumentAliases)
    .where(eq(instrumentAliases.userId, userId));
  // prázdné mapy odvozené ze seznamu — ruční literál by se při přidání
  // brokera rozjel a spadl až v produkci na undefined[symbol]
  const maps: AliasMaps = {
    xtb: {},
    isinOnly: Object.fromEntries(ISIN_ONLY_BROKERS.map((broker) => [broker, {}])) as Record<
      IsinOnlyBroker,
      IsinMap
    >,
  };
  for (const row of rows) {
    if (row.broker === 'xtb') {
      // alias bez měny se dřív TIŠE zahodil — přitom dividendám XTB stačí ISIN
      // (jsou v měně účtu); měna chybí jen obchodům, ty si o ni řeknou samy
      maps.xtb[row.symbol] = {
        isin: row.isin,
        ...(row.currency ? { currency: row.currency } : {}),
      };
    } else if (isIsinOnlyBroker(row.broker)) {
      maps.isinOnly[row.broker][row.symbol] = { isin: row.isin };
    }
  }
  return maps;
}

export interface AliasInput {
  broker: string;
  symbol: string;
  isin: string;
  currency?: string;
}

/**
 * Řádky, které by přepsaly ISIN u symbolu, pod jehož dosavadním ISIN už má
 * uživatel u téhož brokera uložené transakce (L23-02).
 *
 * ISIN je součást dedupe klíče i identity pozice. Po přepisu by další nahrání
 * téhož výpisu uložilo obchody i dividendy podruhé — pod novým ISIN je
 * aplikace jako tytéž nepozná. Uložené řádky se schválně nepřepisují
 * (transakce jsou zdroj pravdy); správná cesta je vrátit import, opravit ISIN
 * a nahrát výpis znovu. Bez uložených transakcí není co zdvojit a přepis projde.
 */
export async function aliasesBlockedByTransactions(
  db: Db,
  userId: string,
  rows: AliasInput[],
): Promise<AliasInput[]> {
  const blocked: AliasInput[] = [];
  for (const row of rows) {
    const [existing] = await db
      .select({ isin: instrumentAliases.isin })
      .from(instrumentAliases)
      .where(
        and(
          eq(instrumentAliases.userId, userId),
          eq(instrumentAliases.broker, row.broker),
          eq(instrumentAliases.symbol, row.symbol),
        ),
      );
    if (!existing || existing.isin === row.isin) continue;
    const [used] = await db
      .select({ key: transactions.dedupeKey })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.broker, row.broker),
          eq(transactions.isin, existing.isin),
        ),
      )
      .limit(1);
    if (used) blocked.push(row);
  }
  return blocked;
}

export async function saveAliases(db: Db, userId: string, rows: AliasInput[]): Promise<void> {
  for (const row of rows) {
    await db
      .insert(instrumentAliases)
      .values({
        userId,
        broker: row.broker,
        symbol: row.symbol,
        isin: row.isin,
        currency: row.currency ?? null,
      })
      .onConflictDoUpdate({
        target: [instrumentAliases.userId, instrumentAliases.broker, instrumentAliases.symbol],
        set: { isin: row.isin, currency: row.currency ?? null },
      });
  }
}
