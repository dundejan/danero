import {
  addDays,
  addYears,
  diffDays,
  sum,
  type AssetClass,
  type IsoDate,
  type Money,
  type TaxpayerProfile,
} from '@danero/shared';
import type { Disposal, Ledger, Lot } from '../ledger/ledger';

/**
 * R-01: příjem je osvobozen, PŘESÁHNE-LI doba mezi nabytím a převodem 3 roky —
 * tj. osvobozeno až od (nabytí + 3 roky) + 1 den.
 */
export const exemptFromDate = (acquisitionDate: IsoDate): IsoDate =>
  addDays(addYears(acquisitionDate, 3), 1);

/** Doplní klasifikaci časového testu do alokací prodejů (mutuje ledger). */
export function classifyTimeTest(disposals: Disposal[], profile: TaxpayerProfile): void {
  for (const disposal of disposals) {
    for (const alloc of disposal.allocations) {
      alloc.exemptFrom = exemptFromDate(alloc.acquisitionDate);
      alloc.timeTestExempt =
        !profile.hasSecuritiesInBusinessAssets && // R-01c
        alloc.origin !== 'SYNTHETIC' &&
        disposal.saleDate >= alloc.exemptFrom;
    }
  }
}

export interface PositionLot {
  lotId: string;
  remaining: Money;
  acquisitionDate: IsoDate;
  exemptFrom: IsoDate;
  isExempt: boolean;
  /** Dní zbývajících do osvobození (0 = už osvobozeno). */
  daysToExempt: number;
  /** Nabývací cena za kus v měně instrumentu — pro zobrazení nerealizovaného P/L. */
  costPerShare: Money;
  interpretive: boolean;
}

export interface Position {
  isin: string;
  assetClass: AssetClass;
  currency: string;
  totalRemaining: Money;
  lots: PositionLot[];
}

/**
 * Otevřené pozice s odpočtem do osvobození — jádro hlídače.
 * Pozn.: ledger je postavený z kompletní historie; `remaining` odráží stav po všech
 * prodejích. Pro historická `atDate` jde tedy o aproximaci — hlídač volá s dneškem.
 */
export function positionsAt(ledger: Ledger, atDate: IsoDate): Position[] {
  const byIsin = new Map<string, Lot[]>();
  for (const lot of ledger.lots) {
    if (lot.remaining.lte(0)) continue;
    if (lot.acquisitionDate > atDate) continue;
    const group = byIsin.get(lot.isin);
    if (group) group.push(lot);
    else byIsin.set(lot.isin, [lot]);
  }

  return [...byIsin.entries()]
    .map(([isin, lots]) => ({
      isin,
      assetClass: lots[0]!.assetClass,
      currency: lots[0]!.currency,
      totalRemaining: sum(lots.map((l) => l.remaining)),
      lots: lots
        .map((lot): PositionLot => {
          const exemptFrom = exemptFromDate(lot.acquisitionDate);
          return {
            lotId: lot.id,
            remaining: lot.remaining,
            acquisitionDate: lot.acquisitionDate,
            exemptFrom,
            isExempt: atDate >= exemptFrom,
            daysToExempt: Math.max(0, diffDays(atDate, exemptFrom)),
            costPerShare: lot.costPerShare,
            interpretive: lot.interpretive,
          };
        })
        .sort((a, b) => a.acquisitionDate.localeCompare(b.acquisitionDate)),
    }))
    .sort((a, b) => a.isin.localeCompare(b.isin));
}
