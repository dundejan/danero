import {
  d,
  Decimal,
  ZERO,
  type DividendTransaction,
  type InterestTransaction,
  type Money,
} from '@danero/shared';
import type { EngineOptions } from '../config/options';
import { czDateText, pctText } from '../format';
import type { FxConverter } from '../fx/fx';
import { WarningCollector } from '../warnings';

export interface DividendItem {
  txId: string;
  /** Datum přijetí — pro časové řady v UI (grafy čerpání limitů, měsíce). */
  date: string;
  isin?: string;
  country: string;
  isCzech: boolean;
  grossCzk: Money;
  withholdingCzk: Money;
  creditableCzk: Money;
}

/** Zdanitelný úrok jako položka — pro časové řady v UI. */
export interface InterestItem {
  txId: string;
  date: string;
  amountCzk: Money;
}

export interface DividendsResult {
  /** České dividendy — srážka u zdroje je konečná, do přiznání nevstupují (R-07a). */
  czechGrossCzk: Money;
  /** Zahraniční dividendy brutto (R-07b) — vstupují i do limitu 50k (R-08d). */
  foreignGrossCzk: Money;
  /**
   * Sražená daň v zahraničí = SOUČET per-country hodnot zaokrouhlených na celé
   * Kč (HALF_UP) — souhrn tak vždy korunově sedí na tabulku po státech.
   */
  foreignWithholdingCzk: Money;
  /**
   * Zápočet po stropu smlouvou (R-07c) = součet per-country hodnot zaokrouhlených
   * na celé Kč (tabulka po státech vždy sedí na součet); finální strop českou
   * daní řeší estimateTax.
   */
  creditableWithholdingCzk: Money;
  /**
   * Agregát po státech: brutto, sražená daň a zápočet. Sražená daň je
   * zaokrouhlená na celé Kč matematicky (HALF_UP), zápočet na celé Kč
   * dolů (konzervativně — R-07c).
   */
  creditableByCountry: Record<
    string,
    { grossCzk: Money; withholdingCzk: Money; creditableCzk: Money }
  >;
  /** Zahraniční úroky (§ 8) — zdanitelné, vstupují do limitu 50k. */
  taxableInterestCzk: Money;
  /** Dílčí základ § 8: zahraniční dividendy brutto + zdanitelné úroky. */
  base8Czk: Money;
  items: DividendItem[];
  interestItems: InterestItem[];
}

const countryFromIsin = (isin?: string): string | undefined => {
  if (!isin || isin.length < 2) return undefined;
  const prefix = isin.slice(0, 2).toUpperCase();
  return /^[A-Z]{2}$/.test(prefix) ? prefix : undefined;
};

/** Lidské označení dividendy do textu varování — ticker/ISIN a datum, ne technické ID. */
const dividendLabel = (tx: DividendTransaction): string => {
  const instrument = tx.ticker ?? tx.isin;
  return instrument
    ? `Dividenda ${instrument} z ${czDateText(tx.date)}`
    : `Dividenda z ${czDateText(tx.date)}`;
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
  const byCountry: Record<
    string,
    { grossCzk: Money; withholdingCzk: Money; creditableCzk: Money }
  > = {};
  const items: DividendItem[] = [];
  /** Země s už vydaným varováním o neověřené smluvní sazbě — varujeme jednou per země. */
  const unverifiedTreatyWarned = new Set<string>();

  for (const tx of dividends) {
    const country = tx.sourceCountry ?? countryFromIsin(tx.isin) ?? 'XX';
    if (country === 'XX') {
      warnings.add(
        'DIVIDEND_UNKNOWN_COUNTRY',
        'WARNING',
        `${dividendLabel(tx)}: nelze určit zemi zdroje (chybí sourceCountry i ISIN) — použit výchozí smluvní strop zápočtu ${pctText(d(options.defaultTreatyCap))}.`,
        { txId: tx.id },
      );
    }
    const grossCzk = fx.toCzk(tx.gross, tx.currency, tx.date);
    const withholdingCzk = fx.toCzk(tx.withholdingTax, tx.currency, tx.date);
    const isCzech = country === 'CZ';

    if (isCzech) {
      czechGross = czechGross.plus(grossCzk);
      items.push({
        txId: tx.id,
        date: tx.date,
        isin: tx.isin,
        country,
        isCzech,
        grossCzk,
        withholdingCzk,
        creditableCzk: ZERO,
      });
      continue;
    }

    // R-07c: prostý zápočet — strop sazbou dle smlouvy o zamezení dvojího zdanění.
    // Sraženo-li více (např. US 30 % bez W-8BEN), rozdíl v ČR propadá.
    const capVerified = country in options.treatyWithholdingCap;
    const cap = d(options.treatyWithholdingCap[country] ?? options.defaultTreatyCap);
    // Známá země mimo tabulku ověřených smluv → počítáme s defaultem a poctivě
    // varujeme (jednou per země) — skutečná smluvní sazba může být nižší.
    // Bez skutečné srážky riziko nadhodnoceného zápočtu nehrozí (creditable = 0),
    // varování by byl falešný poplach (typicky GB s 0% srážkou z dividend).
    if (
      !capVerified &&
      country !== 'XX' &&
      withholdingCzk.gt(0) &&
      !unverifiedTreatyWarned.has(country)
    ) {
      unverifiedTreatyWarned.add(country);
      warnings.add(
        'TREATY_RATE_UNVERIFIED',
        'WARNING',
        `Dividendy ${country}: smlouvu o zamezení dvojího zdanění s tímto státem nemám ověřenou — zápočet počítám s obvyklými ${pctText(d(options.defaultTreatyCap))}. Skutečná smluvní sazba může být nižší (riziko nadhodnoceného zápočtu).`,
        { country },
      );
    }
    const creditableCzk = Decimal.min(withholdingCzk, grossCzk.mul(cap));
    if (withholdingCzk.gt(grossCzk.mul(cap))) {
      // overCzk = částka sražená NAD smluvní strop — web z contextů skládá souhrn
      warnings.add(
        'WITHHOLDING_ABOVE_TREATY',
        'WARNING',
        `${dividendLabel(tx)} (${country}): v zahraničí ti srazili víc daně, než dovoluje mezinárodní smlouva — rozdíl v ČR započíst nejde a propadá (někdy ho lze žádat zpět přímo v zemi zdroje). ${
          country === 'US'
            ? 'U amerických akcií tomu příště předejdeš formulářem W-8BEN — u většiny brokerů stačí potvrdit v nastavení účtu (sníží srážku z 30 % na 15 %).'
            : 'Přeplatek lze zkusit vymáhat po zahraničním správci daně.'
        }`,
        {
          txId: tx.id,
          isin: tx.isin,
          date: tx.date, // pro kompaktní výpis případů v UI („TICKER · datum · částka“)
          country,
          overCzk: withholdingCzk.sub(grossCzk.mul(cap)).toFixed(2),
        },
      );
    }

    foreignGross = foreignGross.plus(grossCzk);
    const agg = byCountry[country] ?? { grossCzk: ZERO, withholdingCzk: ZERO, creditableCzk: ZERO };
    byCountry[country] = {
      grossCzk: agg.grossCzk.plus(grossCzk),
      withholdingCzk: agg.withholdingCzk.plus(withholdingCzk),
      creditableCzk: agg.creditableCzk.plus(creditableCzk),
    };
    items.push({
      txId: tx.id,
      date: tx.date,
      isin: tx.isin,
      country,
      isCzech,
      grossCzk,
      withholdingCzk,
      creditableCzk,
    });
  }

  // R-07c: zápočet po státech zaokrouhlujeme na celé Kč DOLŮ (nárokovanou
  // částku nikdy nenadhodnocujeme — konzervativně), sraženou daň matematicky
  // (HALF_UP) a OBA souhrny počítáme jako SOUČET zaokrouhlených hodnot —
  // tabulka po státech tak vždy korunově sedí na souhrn § 8 (žádný rozdíl
  // ±1 Kč mezi řádky a hlavičkou).
  let creditable = ZERO;
  let withholdingRounded = ZERO;
  for (const [country, agg] of Object.entries(byCountry)) {
    const roundedCreditable = agg.creditableCzk.toDecimalPlaces(0, Decimal.ROUND_FLOOR);
    const roundedWithholding = agg.withholdingCzk.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    byCountry[country] = {
      ...agg,
      withholdingCzk: roundedWithholding,
      creditableCzk: roundedCreditable,
    };
    creditable = creditable.plus(roundedCreditable);
    withholdingRounded = withholdingRounded.plus(roundedWithholding);
  }

  let taxableInterest = ZERO;
  const interestItems: InterestItem[] = [];
  for (const tx of interests) {
    if (tx.sourceCountry === 'CZ') {
      warnings.add(
        'CZ_INTEREST_WITHHELD',
        'INFO',
        `Úrok z ${czDateText(tx.date)} ze zdroje v ČR — předpoklad srážkové daně u zdroje, do základu § 8 nevstupuje.`,
        { txId: tx.id },
      );
      continue;
    }
    const amountCzk = fx.toCzk(tx.amount, tx.currency, tx.date);
    taxableInterest = taxableInterest.plus(amountCzk);
    interestItems.push({ txId: tx.id, date: tx.date, amountCzk });
  }

  return {
    czechGrossCzk: czechGross,
    foreignGrossCzk: foreignGross,
    foreignWithholdingCzk: withholdingRounded,
    creditableWithholdingCzk: creditable,
    creditableByCountry: byCountry,
    taxableInterestCzk: taxableInterest,
    base8Czk: foreignGross.plus(taxableInterest),
    items,
    interestItems,
  };
}
