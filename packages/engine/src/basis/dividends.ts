import {
  d,
  Decimal,
  ZERO,
  type DividendTransaction,
  type InterestTransaction,
  type Money,
} from '@danero/shared';
import type { EngineOptions } from '../config/options';
import type { FxConverter } from '../fx/fx';
import { WarningCollector } from '../warnings';

export interface DividendItem {
  txId: string;
  country: string;
  isCzech: boolean;
  grossCzk: Money;
  withholdingCzk: Money;
  creditableCzk: Money;
}

export interface DividendsResult {
  /** České dividendy — srážka u zdroje je konečná, do přiznání nevstupují (R-07a). */
  czechGrossCzk: Money;
  /** Zahraniční dividendy brutto (R-07b) — vstupují i do limitu 50k (R-08d). */
  foreignGrossCzk: Money;
  foreignWithholdingCzk: Money;
  /** Zápočet po stropu smlouvou (R-07c); finální strop českou daní řeší estimateTax. */
  creditableWithholdingCzk: Money;
  creditableByCountry: Record<string, { grossCzk: Money; creditableCzk: Money }>;
  /** Zahraniční úroky (§ 8) — zdanitelné, vstupují do limitu 50k. */
  taxableInterestCzk: Money;
  /** Dílčí základ § 8: zahraniční dividendy brutto + zdanitelné úroky. */
  base8Czk: Money;
  items: DividendItem[];
}

const countryFromIsin = (isin?: string): string | undefined => {
  if (!isin || isin.length < 2) return undefined;
  const prefix = isin.slice(0, 2).toUpperCase();
  return /^[A-Z]{2}$/.test(prefix) ? prefix : undefined;
};

export function computeDividends(
  dividends: DividendTransaction[],
  interests: InterestTransaction[],
  fx: FxConverter,
  options: EngineOptions,
  warnings: WarningCollector,
): DividendsResult {
  let czechGross = ZERO;
  let foreignGross = ZERO;
  let foreignWithholding = ZERO;
  let creditable = ZERO;
  const byCountry: Record<string, { grossCzk: Money; creditableCzk: Money }> = {};
  const items: DividendItem[] = [];

  for (const tx of dividends) {
    const country = tx.sourceCountry ?? countryFromIsin(tx.isin) ?? 'XX';
    if (country === 'XX') {
      warnings.add(
        'DIVIDEND_UNKNOWN_COUNTRY',
        'WARNING',
        `Dividenda ${tx.id}: nelze určit zemi zdroje (chybí sourceCountry i ISIN) — použit výchozí smluvní strop zápočtu ${options.defaultTreatyCap}.`,
        { txId: tx.id },
      );
    }
    const grossCzk = fx.toCzk(tx.gross, tx.currency, tx.date);
    const withholdingCzk = fx.toCzk(tx.withholdingTax, tx.currency, tx.date);
    const isCzech = country === 'CZ';

    if (isCzech) {
      czechGross = czechGross.plus(grossCzk);
      items.push({ txId: tx.id, country, isCzech, grossCzk, withholdingCzk, creditableCzk: ZERO });
      continue;
    }

    // R-07c: prostý zápočet — strop sazbou dle smlouvy o zamezení dvojího zdanění.
    // Sraženo-li více (např. US 30 % bez W-8BEN), rozdíl v ČR propadá.
    const cap = d(options.treatyWithholdingCap[country] ?? options.defaultTreatyCap);
    const creditableCzk = Decimal.min(withholdingCzk, grossCzk.mul(cap));
    if (withholdingCzk.gt(grossCzk.mul(cap))) {
      warnings.add(
        'WITHHOLDING_ABOVE_TREATY',
        'WARNING',
        `Dividenda ${tx.id} (${country}): v zahraničí ti srazili víc daně, než dovoluje mezinárodní smlouva — rozdíl v ČR započíst nejde a propadá. ${
          country === 'US'
            ? 'U amerických akcií tomu příště předejdeš formulářem W-8BEN — u většiny brokerů stačí potvrdit v nastavení účtu (sníží srážku z 30 % na 15 %).'
            : 'Přeplatek lze zkusit vymáhat po zahraničním správci daně.'
        }`,
        { txId: tx.id, country },
      );
    }

    foreignGross = foreignGross.plus(grossCzk);
    foreignWithholding = foreignWithholding.plus(withholdingCzk);
    creditable = creditable.plus(creditableCzk);
    const agg = byCountry[country] ?? { grossCzk: ZERO, creditableCzk: ZERO };
    byCountry[country] = {
      grossCzk: agg.grossCzk.plus(grossCzk),
      creditableCzk: agg.creditableCzk.plus(creditableCzk),
    };
    items.push({ txId: tx.id, country, isCzech, grossCzk, withholdingCzk, creditableCzk });
  }

  let taxableInterest = ZERO;
  for (const tx of interests) {
    if (tx.sourceCountry === 'CZ') {
      warnings.add(
        'CZ_INTEREST_WITHHELD',
        'INFO',
        `Úrok ${tx.id} ze zdroje v ČR — předpoklad srážkové daně u zdroje, do základu § 8 nevstupuje.`,
        { txId: tx.id },
      );
      continue;
    }
    taxableInterest = taxableInterest.plus(fx.toCzk(tx.amount, tx.currency, tx.date));
  }

  return {
    czechGrossCzk: czechGross,
    foreignGrossCzk: foreignGross,
    foreignWithholdingCzk: foreignWithholding,
    creditableWithholdingCzk: creditable,
    creditableByCountry: byCountry,
    taxableInterestCzk: taxableInterest,
    base8Czk: foreignGross.plus(taxableInterest),
    items,
  };
}
