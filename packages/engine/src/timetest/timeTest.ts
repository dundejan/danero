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
import { isEmtIdentifier } from '../basis/emt';
import type { Disposal, Ledger, Lot } from '../ledger/ledger';

/**
 * R-01: příjem je osvobozen, PŘESÁHNE-LI doba mezi nabytím a převodem 3 roky —
 * tj. osvobozeno až od (nabytí + 3 roky) + 1 den.
 */
export const exemptFromDate = (acquisitionDate: IsoDate): IsoDate =>
  addDays(addYears(acquisitionDate, 3), 1);

/**
 * Doplní klasifikaci časového testu do alokací prodejů (mutuje ledger).
 * `cryptoIsins`: flag obchodního majetku (R-01c/R-02f) se týká jen CP —
 * kryptoaktiva mají vlastní vyloučení přímo v textu zj)/zk) a flagem CP
 * se jim časový test nevypíná (R-02f).
 */
export function classifyTimeTest(
  disposals: Disposal[],
  profile: TaxpayerProfile,
  cryptoIsins: ReadonlySet<string> = new Set(),
): void {
  for (const disposal of disposals) {
    // R-01c: CP v obchodním majetku bez nároku na osvobození (krypto flag nevypíná)
    const businessAssets =
      profile.hasSecuritiesInBusinessAssets && !cryptoIsins.has(disposal.isin);
    for (const alloc of disposal.allocations) {
      alloc.exemptFrom = exemptFromDate(alloc.acquisitionDate);
      alloc.timeTestExempt =
        !businessAssets &&
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
  /**
   * Může časový test tenhle lot vůbec osvobodit? `false` u CP v obchodním
   * majetku (R-01c/R-02f), u EMT bez zapnutého sporného výkladu (R-10a/g),
   * u krypta v období bez osvobození (R-10b) a u derivátů (R-12). Konzumenti
   * pak nesmí nabízet odpočet ani hlásit „osvobozeno" (A2-3-04).
   */
  exemptionPossible: boolean;
  /** Dní zbývajících do osvobození (0 = už osvobozeno; bez nároku bez významu). */
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
 * Kdy může časový test pozici vůbec osvobodit (A2-3-04).
 *
 * Hlídač do 9. 8. 2026 znal jediné pravidlo — „tři roky od nabytí“ — a posílal
 * „osvobozeno 🎉, prodej je osvobozený od daně“ i k pozicím, které osvobození
 * nemají nikdy: USDT nakoupený 2021 hlásil `isExempt=true`, přestože jeho
 * skutečný prodej za 220 000 Kč dal základ 20 000 Kč a daň 3 000 Kč. Totéž
 * u cenných papírů v obchodním majetku (R-01c/R-02f) a u krypta ve zdaňovacím
 * období, kdy osvobození ještě neexistovalo (R-10b).
 */
export interface TimeTestContext {
  /** R-01c/R-02f: CP v obchodním majetku osvobození nemají vůbec. */
  securitiesInBusinessAssets: boolean;
  /** R-10b: dostupnost krypto osvobození v daném roce a den účinnosti novely. */
  crypto: { available: boolean; effectiveFrom: IsoDate | null };
  /** R-10a/R-10g: osvobozuje časový test i EMT (stablecoiny)? Sporný přepínač. */
  emtTimeTestExempt: boolean;
}

/** Nejbenevolentnější kontext — bez profilu a konfigurace roku (výchozí chování). */
const OPEN_CONTEXT: TimeTestContext = {
  securitiesInBusinessAssets: false,
  crypto: { available: true, effectiveFrom: null },
  emtTimeTestExempt: false,
};

/** Může časový test tenhle lot osvobodit, nebo je zdanitelný vždycky? */
function timeTestApplies(lot: Lot, context: TimeTestContext): boolean {
  if (lot.assetClass === 'CRYPTO') {
    if (!context.crypto.available) return false;
    // R-10a: EMT vylučuje hodnotové osvobození zj) vždy; časový test zk) jen
    // podle sporného přepínače (default = zdanit)
    return context.emtTimeTestExempt || !isEmtIdentifier(lot.isin);
  }
  // R-12: deriváty nejsou cenné papíry — časový test na ně nedopadá
  if (lot.assetClass === 'DERIVATIVE') return false;
  return !context.securitiesInBusinessAssets;
}

/**
 * Otevřené pozice s odpočtem do osvobození — jádro hlídače.
 * Pozn.: ledger je postavený z kompletní historie; `remaining` odráží stav po všech
 * prodejích. Pro historická `atDate` jde tedy o aproximaci — hlídač volá s dneškem.
 */
export function positionsAt(
  ledger: Ledger,
  atDate: IsoDate,
  context: TimeTestContext = OPEN_CONTEXT,
): Position[] {
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
          const applies = timeTestApplies(lot, context);
          // R-10b: krypto osvobozuje až prodej ode dne účinnosti novely, i když
          // tři roky držby uplynuly dřív
          const effectiveFrom =
            lot.assetClass === 'CRYPTO' ? context.crypto.effectiveFrom : null;
          const testDone = exemptFromDate(lot.acquisitionDate);
          const exemptFrom =
            effectiveFrom && effectiveFrom > testDone ? effectiveFrom : testDone;
          return {
            lotId: lot.id,
            remaining: lot.remaining,
            acquisitionDate: lot.acquisitionDate,
            exemptFrom,
            exemptionPossible: applies,
            isExempt: applies && atDate >= exemptFrom,
            daysToExempt: Math.max(0, diffDays(atDate, exemptFrom)),
            costPerShare: lot.costPerShare,
            interpretive: lot.interpretive,
          };
        })
        .sort((a, b) => a.acquisitionDate.localeCompare(b.acquisitionDate)),
    }))
    // ordinálně, ne `localeCompare` — pod českým locale se digraf „ch“ řadí
    // až za „h“, takže by se švýcarské ISINy (CH…) přeskládaly za české (CZ…)
    // podle jazykového nastavení serveru. Na daň to nemá vliv, na
    // reprodukovatelnost výstupu ano (A2-3-10).
    .sort((a, b) => (a.isin < b.isin ? -1 : a.isin > b.isin ? 1 : 0));
}
