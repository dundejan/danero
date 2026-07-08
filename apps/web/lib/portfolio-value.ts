import { d, ZERO, type Money } from '@danero/shared';
import type { Position } from '@danero/engine';
import type { InstrumentPrice } from '@/lib/prices';
import { UNIFIED_RATES } from '@/lib/tax-config';

/**
 * Ocenění portfolia (G3): poslední ceny z broker API × jednotný kurz běžného
 * roku (ORIENTAČNÍ — přesný kurz vyhlašuje GFŘ až po konci roku). Pozice bez
 * ceny se poctivě ukazují jako neoceněné, žádný externí zdroj (rozhodnutí Jana).
 */

export interface ValuedPosition {
  isin: string;
  label: string;
  quantity: Money;
  exemptQuantity: Money;
  /** Cena za kus v měně instrumentu (undefined = broker cenu nedodal). */
  price?: Money;
  currency?: string;
  priceAsOf?: Date;
  /** Hodnota pozice v měně instrumentu a orientačně v CZK. */
  value?: Money;
  valueCzk?: Money;
  /** Nabývací cena zbývajících kusů (měna instrumentu) a nerealizovaný P/L. */
  cost?: Money;
  unrealized?: Money;
  unrealizedPct?: number;
}

export interface PortfolioValuation {
  rows: ValuedPosition[];
  /** Součet oceněných pozic v CZK (orientační jednotný kurz). */
  totalCzk: Money;
  /** Pozice započtené do totalCzk (cena od brokera + známý kurz). */
  pricedCount: number;
  /** Pozice mimo součet (bez ceny od brokera, nebo bez jednotného kurzu měny). */
  unpricedCount: number;
  /** Nejstarší datum ceny mezi oceněnými — poctivé „ceny k". */
  oldestPriceAt: Date | null;
  /** Rok, jehož jednotným kurzem se přepočítává. */
  fxYear: number;
}

const rateToCzk = (currency: string, year: number): Money | null => {
  if (currency === 'CZK') return d(1);
  const rate = UNIFIED_RATES[year]?.[currency];
  return rate ? d(rate) : null;
};

export function valuePositions(
  positions: Position[],
  labels: Map<string, string>,
  prices: Map<string, InstrumentPrice>,
  fxYear: number,
): PortfolioValuation {
  const rows: ValuedPosition[] = [];
  let totalCzk = ZERO;
  let pricedCount = 0;
  let oldestPriceAt: Date | null = null;

  for (const position of positions) {
    const priceInfo = prices.get(position.isin);
    const exemptQuantity = position.lots
      .filter((lot) => lot.isExempt)
      .reduce((sum, lot) => sum.plus(lot.remaining), ZERO);

    const row: ValuedPosition = {
      isin: position.isin,
      label: labels.get(position.isin) ?? position.isin,
      quantity: position.totalRemaining,
      exemptQuantity,
    };

    if (priceInfo) {
      row.price = priceInfo.price;
      row.currency = priceInfo.currency;
      row.priceAsOf = priceInfo.asOf;
      row.value = position.totalRemaining.mul(priceInfo.price);
      const rate = rateToCzk(priceInfo.currency, fxYear);
      if (rate) {
        row.valueCzk = row.value.mul(rate);
        totalCzk = totalCzk.plus(row.valueCzk);
        // do součtu (a „ceny k") se počítá jen skutečně oceněná pozice
        pricedCount += 1;
        if (!oldestPriceAt || priceInfo.asOf < oldestPriceAt) oldestPriceAt = priceInfo.asOf;
      }

      // nerealizovaný P/L jen když měna lotů odpovídá měně ceny (jinak by šlo o mix)
      if (position.currency === priceInfo.currency) {
        const cost = position.lots.reduce(
          (sum, lot) => sum.plus(lot.remaining.mul(lot.costPerShare)),
          ZERO,
        );
        row.cost = cost;
        row.unrealized = row.value.minus(cost);
        if (cost.gt(0)) row.unrealizedPct = row.unrealized.div(cost).mul(100).toNumber();
      }
    }

    rows.push(row);
  }

  // oceněné podle hodnoty sestupně, neoceněné nakonec podle počtu kusů
  rows.sort((a, b) => {
    if (a.valueCzk && b.valueCzk) return b.valueCzk.comparedTo(a.valueCzk);
    if (a.valueCzk) return -1;
    if (b.valueCzk) return 1;
    return b.quantity.comparedTo(a.quantity);
  });

  return {
    rows,
    totalCzk,
    pricedCount,
    unpricedCount: positions.length - pricedCount,
    oldestPriceAt,
    fxYear,
  };
}
