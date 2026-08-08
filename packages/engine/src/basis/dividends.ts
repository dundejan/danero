import {
  d,
  Decimal,
  ZERO,
  type DividendTransaction,
  type InterestTransaction,
  type Money,
} from '@danero/shared';
import type { EngineOptions } from '../config/options';
import { czDateText, czkText, pctText } from '../format';
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
  /** R-07f: daň sražená v zahraničí (často 0 — brokeři z úroků obvykle nesráží). */
  withholdingCzk: Money;
  /** R-07f: z toho započitatelné po stropu dle čl. 11 smlouvy. */
  creditableCzk: Money;
}

export interface DividendsResult {
  /** České dividendy — srážka u zdroje je konečná, do přiznání nevstupují (R-07a). */
  czechGrossCzk: Money;
  /** Zahraniční dividendy brutto (R-07b) — vstupují i do limitu 50k (R-08d). */
  foreignGrossCzk: Money;
  /**
   * Sražená daň v zahraničí z dividend I ÚROKŮ (R-07f) = SOUČET per-country
   * hodnot zaokrouhlených na celé Kč (HALF_UP) — souhrn tak vždy korunově
   * sedí na tabulku po státech.
   */
  foreignWithholdingCzk: Money;
  /**
   * Zápočet po stropu smlouvou (R-07c/R-07f) = součet per-country hodnot
   * zaokrouhlených na celé Kč (tabulka po státech vždy sedí na součet);
   * finální strop českou daní řeší estimateTax.
   */
  creditableWithholdingCzk: Money;
  /**
   * Agregát po státech pro Přílohu 3 (§ 38f počítá zápočet za každý stát
   * zvlášť, přes všechny druhy příjmů dohromady): dividendy brutto, úroky
   * brutto, sražená daň a zápočet za celý stát. Sražená daň je zaokrouhlená
   * na celé Kč matematicky (HALF_UP), zápočet na celé Kč dolů (konzervativně
   * — R-07c).
   *
   * `interestGrossCzk` = úroky, které do koeficientu zápočtu skutečně patří:
   * jen se sraženou daní A jen ze států, kde smlouva zdanění u zdroje dovoluje
   * (R-07f). Nezdaněný úrok i úrok zdaněný proti smlouvě zůstává v § 8
   * (`taxableInterestCzk`), ale strop zápočtu nezvedá.
   */
  creditableByCountry: Record<
    string,
    { grossCzk: Money; interestGrossCzk: Money; withholdingCzk: Money; creditableCzk: Money }
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
    { grossCzk: Money; interestGrossCzk: Money; withholdingCzk: Money; creditableCzk: Money }
  > = {};
  const emptyCountry = {
    grossCzk: ZERO,
    interestGrossCzk: ZERO,
    withholdingCzk: ZERO,
    creditableCzk: ZERO,
  };
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
      if (withholdingCzk.isZero() && grossCzk.gt(0)) {
        // R-07a stojí na tom, že českou dividendu vypořádala 15% srážka u zdroje —
        // proto se do přiznání neuvádí. Nulová srážka tenhle předpoklad boří:
        // buď ji importér nepřečetl, nebo sražena opravdu nebyla. Tiše příjem
        // vypustit znamená podhodnotit daň i všechny limity, tedy riziko doměrku.
        warnings.add(
          'CZECH_DIVIDEND_WITHOUT_WITHHOLDING',
          'WARNING',
          `${dividendLabel(tx)}: český zdroj, ale nulová sražená daň. Počítáme s tím, že příjem vypořádala srážka u zdroje (§ 36), takže do přiznání ani do limitů nevstupuje. Pokud sražena nebyla, patří do § 8 a limity čerpá — zkontroluj sloupec sražené daně ve výpisu.`,
          { txId: tx.id, isin: tx.isin },
        );
      }
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
        // Fakt, ne pokyn: individualizovaná rada nad konkrétními čísly poplatníka
        // je za hranicí § 1 zákona 523/1992 Sb. o daňovém poradenství (docs/13 V-4,
        // nález E-26). Informační hodnota zůstává, imperativ mizí.
        `${dividendLabel(tx)} (${country}): v zahraničí ti srazili víc daně, než dovoluje mezinárodní smlouva — rozdíl v ČR započíst nejde a propadá. ${
          country === 'US'
            ? 'Sazba 30 % odpovídá účtu bez potvrzeného formuláře W-8BEN; smluvní sazba pro portfoliového investora je 15 % (čl. 10 smlouvy č. 32/1994 Sb.).'
            : 'Vrácení nadměrné srážky se řídí právem státu zdroje.'
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
    const agg = byCountry[country] ?? emptyCountry;
    byCountry[country] = {
      ...agg,
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

  let taxableInterest = ZERO;
  const interestItems: InterestItem[] = [];
  /** Propadlá srážka z úroků per země (viz varování za smyčkou). */
  const forfeitedInterest = new Map<string, { cap: Money; overCzk: Money }>();
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
    const withholdingCzk = fx.toCzk(tx.withholdingTax, tx.currency, tx.date);
    taxableInterest = taxableInterest.plus(amountCzk);

    // R-07f: zápočet z úroku jde stejným postupem jako u dividendy, ale strop
    // je dle čl. 11 smlouvy — ten skoro vždy nechává právo zdanit úrok jen
    // státu rezidenta (0 %), takže sražená daň se typicky žádá zpět v zahraničí.
    // Úrok bez srážky do rozpisu po státech nepatří: nemá co započítat a řádek
    // navíc by jen mátl (Příloha 3 se plní jen za státy se zápočtem).
    if (withholdingCzk.lte(0)) {
      interestItems.push({ txId: tx.id, date: tx.date, amountCzk, withholdingCzk, creditableCzk: ZERO });
      continue;
    }
    const country = tx.sourceCountry ?? 'XX';
    const cap = d(
      options.treatyInterestWithholdingCap[country] ?? options.defaultInterestTreatyCap,
    );
    const creditableCzk = Decimal.min(withholdingCzk, amountCzk.mul(cap));
    if (withholdingCzk.gt(creditableCzk)) {
      // Varujeme jednou per země, ne per transakci: brokeři připisují úrok
      // z hotovosti klidně denně a stovka řádků se stejnou hláškou by souhrn
      // kontrol zavalila. Částky se proto sčítají a warning se vydá až za smyčkou.
      const over = forfeitedInterest.get(country) ?? { cap, overCzk: ZERO };
      forfeitedInterest.set(country, {
        cap,
        overCzk: over.overCzk.plus(withholdingCzk.sub(creditableCzk)),
      });
    }
    const agg = byCountry[country] ?? emptyCountry;
    byCountry[country] = {
      ...agg,
      // Do koeficientu § 38f (příjmy státu / základ daně) úrok vstupuje jen tam,
      // kde smlouva zdanění u zdroje vůbec dovoluje. Jinak by zvedl strop
      // zápočtu i DIVIDENDÁM téhož státu, na což nárok není — daň sraženou
      // proti smlouvě vrací stát zdroje, ne české přiznání.
      interestGrossCzk: cap.gt(0) ? agg.interestGrossCzk.plus(amountCzk) : agg.interestGrossCzk,
      withholdingCzk: agg.withholdingCzk.plus(withholdingCzk),
      creditableCzk: agg.creditableCzk.plus(creditableCzk),
    };
    interestItems.push({ txId: tx.id, date: tx.date, amountCzk, withholdingCzk, creditableCzk });
  }

  for (const [country, { cap, overCzk }] of forfeitedInterest) {
    warnings.add(
      'INTEREST_WITHHOLDING_ABOVE_TREATY',
      'WARNING',
      // Fakt, ne pokyn (docs/13 V-4): pojmenuj situaci a smluvní strop; „zažádej
      // si o vrácení“ nad konkrétní částkou by byla individualizovaná rada.
      `${country === 'XX' ? 'Úroky bez určené země zdroje' : `Úroky ze zdroje v zemi ${country}`}: v zahraničí z nich srazili ${czkText(overCzk)} daně, kterou v ČR započíst nejde. Úroky řeší jiný článek mezinárodní smlouvy než dividendy a ten obvykle nechává právo zdanit úrok jen státu, kde bydlíš — započíst lze nejvýš ${pctText(cap)} z úroku. Nadměrná srážka se vrací ve státě zdroje.`,
      { country, overCzk: overCzk.toFixed(2) },
    );
  }

  // R-07c/R-07f: zápočet po státech zaokrouhlujeme na celé Kč DOLŮ (nárokovanou
  // částku nikdy nenadhodnocujeme — konzervativně), sraženou daň matematicky
  // (HALF_UP) a OBA souhrny počítáme jako SOUČET zaokrouhlených hodnot —
  // tabulka po státech tak vždy korunově sedí na souhrn § 8 (žádný rozdíl
  // ±1 Kč mezi řádky a hlavičkou). Zaokrouhluje se až po přičtení úroků:
  // § 38f počítá zápočet za stát jako celek, ne za každý druh příjmu zvlášť.
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
