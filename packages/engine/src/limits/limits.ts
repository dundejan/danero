import { d, sum, ZERO, type IsoDate, type Money, type TaxpayerProfile } from '@danero/shared';
import type { AssetScope, TaxYearConfig } from '../config/taxYear';
import type { DerivativesResult } from '../basis/derivatives';
import type { DividendsResult } from '../basis/dividends';
import type { SecuritiesResult } from '../basis/securities';
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

export interface LimitsResult {
  limit100k: LimitStatus & { includesTimeTestExempt: boolean };
  /** R-10a: samostatný limit 100k pro kryptoaktiva (§ 4/1 zj) — čerpá se nezávisle na CP. */
  cryptoLimit100k: LimitStatus;
  flatTax50k: { applicable: boolean; status: LimitStatus; components: FlatTax50kComponents };
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
  // R-10a: vlastní pool kryptoaktiv (prodeje před 15. 2. 2025 do něj nevstupují — R-10b)
  const cryptoLimit100k = limitStatus(
    crypto.pool100kCzk,
    d(config.limits.cryptoProceedsExemption),
  );

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
  if (profile.regime === 'PAUSAL' && flatStatus.exceeded) {
    warnings.add(
      'FLAT_TAX_BROKEN',
      'WARNING',
      `Prolomen limit ${czkText(d(config.limits.flatTaxOtherIncome))} pro daň rovnou paušální dani (§ 7a): zdanitelné příjmy § 8–10 činí ${czkText(sideIncome)}. Vzniká povinnost podat přiznání a přehledy ČSSZ/ZP; v paušálním režimu zůstáváš.`,
      { usedCzk: sideIncome.toFixed(2) },
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
  const exemptByScope: Record<AssetScope, Money> = {
    SECURITIES: securities.timeTestExemptProceedsCzk,
    CRYPTO: crypto.timeTestExemptProceedsCzk,
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
      applicable: profile.regime === 'PAUSAL',
      status: flatStatus,
      components,
    },
    employee20k: { applicable: profile.regime === 'ZAMESTNANEC', status: employeeStatus },
    generalFiling50k: { applicable: profile.regime === 'JINE', status: generalStatus },
    reporting38v,
    cap40M,
  };
}
