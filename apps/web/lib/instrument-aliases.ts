import { eq } from 'drizzle-orm';
import type { IsinInstrumentMap, XtbInstrumentMap } from '@danero/importers';
import type { Db } from '@/db';
import { instrumentAliases } from '@/db/schema';

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
