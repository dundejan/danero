import {
  d,
  Decimal,
  sum,
  ZERO,
  type IsoDate,
  type Money,
  type TaxpayerProfile,
} from '@danero/shared';
import type { AssetScope, TaxYearConfig } from '../config/taxYear';
import type { DerivativesResult } from '../basis/derivatives';
import type { DividendsResult } from '../basis/dividends';
import type { SecuritiesResult } from '../basis/securities';
import type { TaxEstimate } from '../tax/estimate';
import { czkText } from '../format';
import { WarningCollector } from '../warnings';

export type LimitZone = 'OK' | 'WARNING' | 'CRITICAL' | 'EXCEEDED';

export interface LimitStatus {
  limitCzk: Money;
  usedCzk: Money;
  ratio: number;
  /** Pásma hlídače: <60 % OK, ≥60 % WARNING, ≥85 % CRITICAL, >100 % EXCEEDED. */
  zone: LimitZone;
  exceeded: boolean;
}

export const limitStatus = (used: Money, limit: Money): LimitStatus => {
  const ratio = limit.gt(0) ? used.div(limit).toNumber() : 0;
  const exceeded = used.gt(limit); // limity jsou „do X včetně“ — přesně X ještě vyhovuje
  const zone: LimitZone = exceeded
    ? 'EXCEEDED'
    : ratio >= 0.85
      ? 'CRITICAL'
      : ratio >= 0.6
        ? 'WARNING'
        : 'OK';
  return { limitCzk: limit, usedCzk: used, ratio, zone, exceeded };
};

export interface FlatTax50kComponents {
  /** Hrubé tržby z neosvobozených prodejů CP — počítá se tržba, ne zisk (R-08d)! */
  nonExemptSecuritiesProceedsCzk: Money;
  /** R-10f: hrubé tržby z neosvobozených prodejů kryptoaktiv (vč. prodejů před 15. 2. 2025). */
  nonExemptCryptoProceedsCzk: Money;
  /** R-12q: úhrn hrubých kladných plnění z derivátů (deriváty osvobození nemají). */
  derivativesIncomeCzk: Money;
  foreignDividendsGrossCzk: Money;
  taxableInterestCzk: Money;
  otherManualCzk: Money;
}

/**
 * R-09d: „jednotlivý příjem“ dle D-59 = v jednom čase z jednoho titulu — proti
 * prahu 5M se posuzuje ÚHRN osvobozených tržeb za (isin, den prodeje), ne každý
 * fill zvlášť (2 × 3M týž den z téhož titulu oznámení podléhá).
 */
export interface Flagged38v {
  /** Prodeje (fill-y), které jednotlivý příjem tvoří. */
  sellTxIds: string[];
  isin: string;
  saleDate: IsoDate;
  /** Druh příjmu — § 38v se týká CP i kryptoaktiv (R-09d/R-10f). */
  assetScope: AssetScope;
  /** Úhrn osvobozených tržeb jednotlivého příjmu (isin + den). */
  exemptProceedsCzk: Money;
}

/**
 * R-08f: počet měsíců v paušálním režimu, se kterým počítáme zálohy. Profil
 * poplatníka ho nenese a z transakcí ho zjistit nejde — kdo do režimu vstoupil
 * nebo z něj vystoupil během roku, zaplatil záloh míň a skutečný doplatek je
 * vyšší (až o 1 100 Kč). Chyba jde jen jedním směrem, ale mlčet se o ní nesmí
 * (nález A1-05) — varování `FLAT_TAX_BROKEN` předpoklad říká nahlas.
 */
const FLAT_TAX_ADVANCE_MONTHS = 12;

/**
 * R-08f: vyčíslení dopadu prolomení limitu 50k. Daň z § 8 + § 10 proti
 * zaplaceným zálohám na daň; pojistné engine nepočítá (chybí základ § 7),
 * varování ho zmiňuje slovně.
 */
export interface FlatTaxBreachImpact {
  /** Orientační daň z investičních příjmů (§ 8 + § 10) po zápočtu zahraniční srážky. */
  taxCzk: Money;
  /** Zálohy na daň zaplacené v paušálním režimu — jen daňová složka paušální zálohy. */
  advancesCreditCzk: Money;
  /** Počet měsíců, za který jsme zálohy započetli (vždy 12 — viz FLAT_TAX_ADVANCE_MONTHS). */
  advanceMonths: number;
  /** Doplatek daně = daň − zálohy (min. 0). */
  additionalTaxCzk: Money;
  /** Celková měsíční paušální záloha 1. pásma (pro kontext v UI). */
  monthlyAdvanceCzk: Money | null;
}

export interface LimitsResult {
  limit100k: LimitStatus & { includesTimeTestExempt: boolean };
  /**
   * R-10a: samostatný limit 100k pro kryptoaktiva (§ 4/1 zj) — čerpá se
   * nezávisle na CP. `applicable: false` v roce, kdy krypto osvobození vůbec
   * nemá (ZO ≤ 2024, R-10b): měřák „0/100 000, zóna OK“ by tam lhal.
   * Příznak (místo `null`) proto, že limit100k má stejný tvar a konzument tak
   * nemusí řešit dvě různé struktury — stačí, aby příznak respektoval.
   */
  cryptoLimit100k: LimitStatus & { applicable: boolean };
  flatTax50k: {
    applicable: boolean;
    status: LimitStatus;
    components: FlatTax50kComponents;
    /** R-08f: vyčíslení dopadu — jen když je limit prolomený a profil paušální. */
    breachImpact: FlatTaxBreachImpact | null;
  };
  employee20k: { applicable: boolean; status: LimitStatus };
  generalFiling50k: { applicable: boolean; status: LimitStatus };
  reporting38v: Flagged38v[];
  cap40M: {
    applicable: boolean;
    capCzk: Money;
    /** Druhy příjmů pod stropem (R-10d/R-10e): 2025 CP + krypto, od 2026 jen krypto. */
    appliesTo: AssetScope[];
    /** Kombinovaný úhrn časově osvobozených příjmů druhů pod stropem (před krácením). */
    exemptProceedsCzk: Money;
    exceeded: boolean;
  } | null;
}

export function computeLimits(
  securities: SecuritiesResult,
  crypto: SecuritiesResult,
  derivatives: DerivativesResult,
  dividends: DividendsResult,
  tax: TaxEstimate,
  profile: TaxpayerProfile,
  config: TaxYearConfig,
  warnings: WarningCollector,
  includesTimeTestExempt: boolean,
): LimitsResult {
  // R-02: hodnotový test 100k na hrubé tržby z prodeje CP
  const limit100k = {
    ...limitStatus(securities.pool100kCzk, d(config.limits.securitiesProceedsExemption)),
    includesTimeTestExempt,
  };
  // R-10a: vlastní pool kryptoaktiv (prodeje před 15. 2. 2025 do něj nevstupují — R-10b).
  // R-10b: v roce bez krypto osvobození limit neexistuje — hlásí se jako neaplikovatelný.
  const cryptoExemptionsAvailable = config.cryptoRules.exemptionsAvailable;
  const cryptoLimit100k = {
    ...limitStatus(
      crypto.pool100kCzk,
      cryptoExemptionsAvailable ? d(config.limits.cryptoProceedsExemption) : ZERO,
    ),
    applicable: cryptoExemptionsAvailable,
  };

  // R-08c/d: do 50k vstupují jen NEosvobozené příjmy — hrubé tržby, zahraniční
  // dividendy brutto, zdanitelné úroky a ruční ostatní příjmy § 8–10.
  // Součet per prodej i při exemptUnder100k: dodaněná část ze stropu § 4/3
  // (R-03/R-10d) je zdanitelná a limit čerpá i v roce s poolem pod 100k.
  const nonExemptProceeds = sum(
    securities.disposals.map((disposal) => disposal.taxableProceedsCzk),
  );
  // R-10f: u krypta per prodej — prodeje bez nároku na osvobození (R-10b) jsou
  // zdanitelné a čerpají limit i v roce, kdy pool 100k nepřeteče
  const nonExemptCryptoProceeds = sum(
    crypto.disposals.map((disposal) => disposal.taxableProceedsCzk),
  );
  const components: FlatTax50kComponents = {
    nonExemptSecuritiesProceedsCzk: nonExemptProceeds,
    nonExemptCryptoProceedsCzk: nonExemptCryptoProceeds,
    derivativesIncomeCzk: derivatives.taxableIncomeCzk,
    foreignDividendsGrossCzk: dividends.foreignGrossCzk,
    taxableInterestCzk: dividends.taxableInterestCzk,
    otherManualCzk: profile.otherTaxableIncome8to10Czk,
  };
  const sideIncome = nonExemptProceeds
    .plus(nonExemptCryptoProceeds)
    .plus(derivatives.taxableIncomeCzk)
    .plus(dividends.foreignGrossCzk)
    .plus(dividends.taxableInterestCzk)
    .plus(profile.otherTaxableIncome8to10Czk);

  const flatStatus = limitStatus(sideIncome, d(config.limits.flatTaxOtherIncome));
  const flatTaxApplicable = profile.regime === 'PAUSAL';
  // R-08f: dopad prolomení v korunách. Daň bereme z varianty obecného základu —
  // § 16a (samostatný základ) se v roce s přiznáním teprve volí a jeho výhodnost
  // závisí i na § 7, který Danero nezná. Zálohy: jen daňová složka paušální
  // zálohy (§ 38lk); pojistné se vypořádává v přehledech, ne v přiznání.
  const advance = config.flatTaxAdvance;
  const breachImpact: FlatTaxBreachImpact | null =
    flatTaxApplicable && flatStatus.exceeded
      ? (() => {
          const taxCzk = tax.general.taxCzk;
          const advancesCreditCzk = advance
            ? d(advance.monthlyTaxCzk).mul(FLAT_TAX_ADVANCE_MONTHS)
            : ZERO;
          return {
            taxCzk,
            advancesCreditCzk,
            advanceMonths: FLAT_TAX_ADVANCE_MONTHS,
            additionalTaxCzk: Decimal.max(ZERO, taxCzk.sub(advancesCreditCzk)),
            monthlyAdvanceCzk: advance ? d(advance.monthlyTotalCzk) : null,
          };
        })()
      : null;
  if (breachImpact) {
    const advancesPart = advance
      ? `Zaplacené zálohy na daň (${czkText(d(advance.monthlyTaxCzk))} měsíčně z paušální zálohy ${czkText(d(advance.monthlyTotalCzk))}, 1. pásmo) se do ní započtou, takže doplatek daně vychází orientačně na ${czkText(breachImpact.additionalTaxCzk)}. Počítáme s ${FLAT_TAX_ADVANCE_MONTHS} měsíci v paušálním režimu — pokud jsi do něj vstoupil nebo z něj vystoupil během roku, zaplatil jsi záloh míň a doplatek bude vyšší o ${czkText(d(advance.monthlyTaxCzk))} za každý měsíc mimo režim.`
      : `Zálohy na daň za tento rok v konfiguraci nemáme, doplatek daně proto vyčíslujeme bez jejich započtení.`;
    warnings.add(
      'FLAT_TAX_BROKEN',
      'WARNING',
      `Prolomen limit ${czkText(d(config.limits.flatTaxOtherIncome))} pro daň rovnou paušální dani (§ 7a): zdanitelné příjmy § 8–10 činí ${czkText(sideIncome)}. Vzniká povinnost podat přiznání; v paušálním režimu zůstáváš. Daň z investičních příjmů (§ 8 + § 10) vychází na ${czkText(breachImpact.taxCzk)}. ${advancesPart} Nezapočítali jsme daň z podnikání (§ 7), kterou Danero nevidí. Navíc vzniká povinnost podat přehledy ČSSZ a ZP a doplatit pojistné ze skutečných příjmů — to spočítat neumíme, protože neznáme tvůj základ z § 7.`,
      {
        usedCzk: sideIncome.toFixed(2),
        taxCzk: breachImpact.taxCzk.toFixed(2),
        advancesCreditCzk: breachImpact.advancesCreditCzk.toFixed(2),
        advanceMonths: breachImpact.advanceMonths,
        additionalTaxCzk: breachImpact.additionalTaxCzk.toFixed(2),
      },
    );
  }

  const employeeStatus = limitStatus(sideIncome, d(config.limits.employeeSideIncome));
  const generalStatus = limitStatus(sideIncome, d(config.limits.generalFiling));

  // R-09d/R-10f: oznámení jednotlivého osvobozeného příjmu > 5M (§ 38v) — CP i krypto.
  // Jednotlivý příjem = úhrn per (isin, den prodeje) — partial fill-y téhož prodeje
  // se sčítají, jinak by 2 × 3M týž den povinnosti unikly (D-59: „v jednom čase
  // z jednoho titulu od jednoho subjektu“).
  const reportingThreshold = d(config.limits.exemptIncomeReporting);
  const flag38v = (result: SecuritiesResult, assetScope: AssetScope): Flagged38v[] => {
    const groups = new Map<string, Flagged38v>();
    for (const disposal of result.disposals) {
      if (disposal.exemptProceedsCzk.lte(0)) continue;
      const key = `${disposal.isin}|${disposal.saleDate}`;
      const group = groups.get(key);
      if (group) {
        group.sellTxIds.push(disposal.sellTxId);
        group.exemptProceedsCzk = group.exemptProceedsCzk.plus(disposal.exemptProceedsCzk);
      } else {
        groups.set(key, {
          sellTxIds: [disposal.sellTxId],
          isin: disposal.isin,
          saleDate: disposal.saleDate,
          assetScope,
          exemptProceedsCzk: disposal.exemptProceedsCzk,
        });
      }
    }
    return [...groups.values()].filter((group) =>
      group.exemptProceedsCzk.gt(reportingThreshold),
    );
  };
  const reporting38v = [...flag38v(securities, 'SECURITIES'), ...flag38v(crypto, 'CRYPTO')];
  if (reporting38v.length > 0) {
    // lidský tvar podle počtu (1 / 2–4 / 5+) — deterministicky, bez Intl
    const n = reporting38v.length;
    const subject =
      n === 1
        ? 'Osvobozený příjem z prodeje CP či kryptoaktiv přesahuje'
        : n <= 4
          ? `${n} osvobozené příjmy z prodeje CP či kryptoaktiv přesahují`
          : `${n} osvobozených příjmů z prodeje CP či kryptoaktiv přesahuje`;
    warnings.add(
      'REPORTING_38V',
      'WARNING',
      `${subject} 5 mil. Kč — povinnost oznámit správci daně (§ 38v) ve lhůtě pro přiznání; pokuty dle § 38w až 15 %.`,
      { count: reporting38v.length },
    );
  }

  // R-03/R-10d: poměrné krácení počítá engine.ts (sdílený strop přes druhy, vč.
  // varování CAP_40M_REDUCED s čísly); tady jen strukturovaný stav pro UI.
  const cap = config.limits.timeTestCap;
  // Druh osvobozený hodnotovým limitem t)/zj) do stropu nevstupuje — § 4 odst. 3
  // kryje jen q), u) a zk) (nález A2-9). Stejná podmínka jako v engine.ts:
  // hodnotové osvobození časově osvobozené tržby pokryje jen tehdy, když do
  // úhrnu 100k vůbec vstupují, tedy při striktním výkladu R-02c.
  const exemptByScope: Record<AssetScope, Money> = {
    SECURITIES:
      includesTimeTestExempt && securities.exemptUnder100k
        ? ZERO
        : securities.timeTestExemptProceedsCzk,
    CRYPTO:
      includesTimeTestExempt && crypto.exemptUnder100k ? ZERO : crypto.timeTestExemptProceedsCzk,
  };
  const combinedExempt = cap ? sum(cap.appliesTo.map((scope) => exemptByScope[scope])) : ZERO;
  const cap40M = cap
    ? {
        applicable: true,
        capCzk: d(cap.amountCzk),
        appliesTo: cap.appliesTo,
        exemptProceedsCzk: combinedExempt,
        exceeded: combinedExempt.gt(d(cap.amountCzk)),
      }
    : null;

  return {
    limit100k,
    cryptoLimit100k,
    flatTax50k: {
      applicable: flatTaxApplicable,
      status: flatStatus,
      components,
      breachImpact,
    },
    employee20k: { applicable: profile.regime === 'ZAMESTNANEC', status: employeeStatus },
    generalFiling50k: { applicable: profile.regime === 'JINE', status: generalStatus },
    reporting38v,
    cap40M,
  };
}
