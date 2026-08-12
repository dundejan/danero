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
  /**
   * Vstoupil úrok do dílčího základu § 8 (a tím i do limitů)? České úroky
   * vypořádané srážkou u zdroje ne (R-07g) — ve výpisu ale zůstávají, aby
   * nemizely z časových řad v UI.
   */
  inBase8: boolean;
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
  /**
   * R-07h: zdanitelný zbytek vratky kapitálu z ledgeru (v měně výplaty).
   * Chybějící záznam = daní se celá — přepínač se tak vyhodnocuje na jednom
   * místě (v ledgeru, kde se snížení nabývací ceny opravdu děje).
   */
  returnOfCapitalTaxable: Map<string, Money> = new Map(),
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

  for (let tx of dividends) {
    // R-07h: vratka kapitálu, kterou ledger vstřebal do nabývací ceny, není
    // příjmem — do § 8 jde jen nevstřebaný zbytek (a s ním i poměrná srážka,
    // která u vratky stejně nemá co dělat, viz mantinel 4 v docs/02).
    const roc = returnOfCapitalTaxable.get(tx.id);
    if (roc !== undefined) {
      if (roc.lte(0)) continue;
      tx = { ...tx, gross: roc };
    } else if (tx.returnOfCapital && !options.returnOfCapitalReducesBasis) {
      warnings.add(
        'RETURN_OF_CAPITAL_TAXED_AS_DIVIDEND',
        'INFO',
        `${dividendLabel(tx)}: broker označil výplatu za vrácení vloženého kapitálu. Daníme ji jako dividendu (§ 8) a čerpá limity — je to bezpečnější výklad. Mírnější výklad (R-07h) by jí snížil nabývací cenu pozice a daň odložil na prodej; přepnout jde v nastavení.`,
        { txId: tx.id, isin: tx.isin },
      );
    } else if (tx.returnOfCapital) {
      // Mírnější výklad je ZAPNUTÝ, a přesto se k výplatě nedostal ledger —
      // stane se to u instrumentu vedeného jako derivát (ten se z ledgeru
      // vyřazuje, `engine.ts`). Radit uživateli přepnout něco, co má zapnuté,
      // by ho poslalo hledat chybu na špatné místo.
      warnings.add(
        'RETURN_OF_CAPITAL_NOT_APPLIED',
        'WARNING',
        `${dividendLabel(tx)}: vratku kapitálu nešlo promítnout do nabývací ceny — instrument je vedený jako derivát, a ten pozice v lotech nemá. Daní se jako dividenda (§ 8).`,
        { txId: tx.id, isin: tx.isin },
      );
    }
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
  /**
   * A1-3-05: srážka z úroku, u kterého smlouva státu zdroje zdanit nedovoluje.
   * Do rozpisu po státech nepatří (zkreslila by koeficient § 38f i Přílohu 3),
   * ale ze souhrnu sražené daně v zahraničí zmizet nesmí.
   */
  let nonCreditableInterestWithholding = ZERO;
  for (const tx of interests) {
    const amountCzk = fx.toCzk(tx.amount, tx.currency, tx.date);
    const withholdingCzk = fx.toCzk(tx.withholdingTax, tx.currency, tx.date);

    // R-07g: český úrok se do přiznání neuvádí jen tehdy, když ho opravdu
    // vypořádala srážka u zdroje. Rozhoduje tedy sražená daň v datech, ne země:
    // úrok z poskytnutých zápůjček a úvěrů (P2P platformy) srážce nepodléhá
    // a je běžným příjmem § 8. Dokud se to poznávalo podle země, zmizelo
    // 80 000 Kč nezdaněného úroku ze základu i z limitu 50k a verdikt zněl
    // „paušál v pořádku“ (nález A1-3-03).
    if (tx.sourceCountry === 'CZ') {
      if (withholdingCzk.gt(0)) {
        warnings.add(
          'CZ_INTEREST_WITHHELD',
          'INFO',
          `Úrok z ${czDateText(tx.date)} ze zdroje v ČR se sraženou daní — je vypořádaný u zdroje (§ 36), do základu § 8 ani do limitů nevstupuje.`,
          { txId: tx.id },
        );
      } else if (amountCzk.gt(0)) {
        warnings.add(
          'CZ_INTEREST_WITHOUT_WITHHOLDING',
          'WARNING',
          `Úrok z ${czDateText(tx.date)} ze zdroje v ČR, ale bez sražené daně — počítáme ho proto do základu § 8 a do limitů (tak se daní třeba úrok z P2P půjček). Pokud ti srážka strhnuta byla a jen ji výpis neuvádí, oprav sraženou daň u téhle transakce; jinak by ti vyšla vyšší daň, než máš platit.`,
          { txId: tx.id },
        );
        taxableInterest = taxableInterest.plus(amountCzk);
      }
      // do rozpisu po státech český úrok nepatří (není co započítat), ale ve
      // výpisu úroků zůstat musí — jinak mizí i z časových řad v UI
      interestItems.push({
        txId: tx.id,
        date: tx.date,
        amountCzk,
        withholdingCzk,
        creditableCzk: ZERO,
        inBase8: withholdingCzk.lte(0) && amountCzk.gt(0),
      });
      continue;
    }
    taxableInterest = taxableInterest.plus(amountCzk);

    // R-07f: zápočet z úroku jde stejným postupem jako u dividendy, ale strop
    // je dle čl. 11 smlouvy — ten skoro vždy nechává právo zdanit úrok jen
    // státu rezidenta (0 %), takže sražená daň se typicky žádá zpět v zahraničí.
    // Úrok bez srážky do rozpisu po státech nepatří: nemá co započítat a řádek
    // navíc by jen mátl (Příloha 3 se plní jen za státy se zápočtem).
    if (withholdingCzk.lte(0)) {
      interestItems.push({
        txId: tx.id,
        date: tx.date,
        amountCzk,
        withholdingCzk,
        creditableCzk: ZERO,
        inBase8: true,
      });
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
    // Do koeficientu § 38f (příjmy státu / základ daně) úrok vstupuje jen tam,
    // kde smlouva zdanění u zdroje vůbec dovoluje. Jinak by zvedl strop
    // zápočtu i DIVIDENDÁM téhož státu, na což nárok není — daň sraženou
    // proti smlouvě vrací stát zdroje, ne české přiznání.
    //
    // A1-3-05: při nulovém stropu se do řádku nesmí přičíst ani SRÁŽKA. Dřív
    // se přičítala, takže US s dividendami 100 000/15 000 a úrokem 10 000/3 000
    // vycházel jako {příjem 100 000, srážka 18 000} = 18 % nad smluvních 15 %,
    // a úrok bez uvedené země vyrobil řádek `XX` s příjmem 0 a srážkou 1 500 Kč.
    // Nezapočitatelná srážka zůstává vidět ve výpisu úroků a ve varování
    // INTEREST_WITHHOLDING_ABOVE_TREATY — v Příloze 3 nemá co dělat.
    if (cap.gt(0)) {
      const agg = byCountry[country] ?? emptyCountry;
      byCountry[country] = {
        ...agg,
        interestGrossCzk: agg.interestGrossCzk.plus(amountCzk),
        withholdingCzk: agg.withholdingCzk.plus(withholdingCzk),
        creditableCzk: agg.creditableCzk.plus(creditableCzk),
      };
    } else {
      // Sražená daň v zahraničí padla, i když se nedá započíst — v souhrnu
      // (§ 8 i UI) zůstat musí, jen mimo rozpis po státech.
      nonCreditableInterestWithholding = nonCreditableInterestWithholding.plus(withholdingCzk);
    }
    interestItems.push({
      txId: tx.id,
      date: tx.date,
      amountCzk,
      withholdingCzk,
      creditableCzk,
      inBase8: true,
    });
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
  withholdingRounded = withholdingRounded.plus(
    nonCreditableInterestWithholding.toDecimalPlaces(0, Decimal.ROUND_HALF_UP),
  );

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
