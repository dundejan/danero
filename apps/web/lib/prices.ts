import { eq } from 'drizzle-orm';
import { d, type Money } from '@danero/shared';
import type { Db } from '@/db';
import { instrumentPrices } from '@/db/schema';

/**
 * Poslední známé ceny instrumentů z broker API (G3). Jediný zdroj cen jsou
 * broker účty uživatele (rozhodnutí Jana: žádný externí placený zdroj) —
 * ceny se obnovují při každém syncu, CSV-only uživatel žádné nemá.
 */

export interface InstrumentPrice {
  price: Money;
  currency: string;
  source: string;
  asOf: Date;
}

export interface PriceInput {
  isin: string;
  price: string | number;
  currency?: string;
}

/**
 * Cena z brokera na Decimal, nebo `null`. Brokeři posílají do číselných polí
 * i `N/A`, prázdný řetězec nebo pomlčku (IBKR `markPrice="N/A"` u nástroje bez
 * kotace) — a `new Decimal()` na takovém vstupu vyhodí výjimku.
 */
function safeDecimal(value: string | number): Money | null {
  try {
    return d(value);
  } catch {
    return null;
  }
}

/** GBX/GBp = pence (známá zrada T212) — normalizace na GBP, ať existuje kurz. */
function normalize(price: Money, currency: string): { price: Money; currency: string } {
  if (currency.toUpperCase() === 'GBX' || currency === 'GBp') {
    return { price: price.div(100), currency: 'GBP' };
  }
  return { price, currency };
}

/** Upsert cen po syncu — položky bez ceny nebo měny se přeskočí. */
export async function upsertInstrumentPrices(
  db: Db,
  userId: string,
  source: string,
  prices: PriceInput[],
  asOf: Date,
): Promise<number> {
  let written = 0;
  for (const item of prices) {
    if (!item.currency) continue;
    // Guard MUSÍ být před `d()`, ne za ním: `new Decimal('N/A')` vyhodí, takže
    // `isFinite()` na dalším řádku se nikdy nespustí a jediná nečíselná cena
    // shodí zápis cen celého syncu (u IBKR je volání mimo try/catch).
    // Stejná třída chyby jako G-4 v `cnb.ts` — tam už opravená.
    const raw = safeDecimal(item.price);
    if (!raw || !raw.isFinite() || raw.lte(0)) continue;
    const { price, currency } = normalize(raw, item.currency);
    await db
      .insert(instrumentPrices)
      .values({
        userId,
        isin: item.isin,
        price: price.toString(),
        currency,
        source,
        asOf,
      })
      .onConflictDoUpdate({
        target: [instrumentPrices.userId, instrumentPrices.isin],
        set: { price: price.toString(), currency, source, asOf },
      });
    written += 1;
  }
  return written;
}

export async function loadInstrumentPrices(
  db: Db,
  userId: string,
): Promise<Map<string, InstrumentPrice>> {
  const rows = await db
    .select()
    .from(instrumentPrices)
    .where(eq(instrumentPrices.userId, userId));
  return new Map(
    rows.map((row) => [
      row.isin,
      { price: d(row.price), currency: row.currency, source: row.source, asOf: row.asOf },
    ]),
  );
}
