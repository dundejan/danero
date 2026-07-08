import { d, sum, ZERO, type Money, type TaxpayerProfile } from '@danero/shared';
import type { TaxYearConfig } from '../config/taxYear';
import type { DividendsResult } from '../basis/dividends';
import type { SecuritiesResult } from '../basis/securities';
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
  const exceeded = used.gt(limit); // limity jsou „do X včetně" — přesně X ještě vyhovuje
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
  foreignDividendsGrossCzk: Money;
  taxableInterestCzk: Money;
  otherManualCzk: Money;
}

export interface Flagged38v {
  sellTxId: string;
  isin: string;
  exemptProceedsCzk: Money;
}

export interface LimitsResult {
  limit100k: LimitStatus & { includesTimeTestExempt: boolean };
  flatTax50k: { applicable: boolean; status: LimitStatus; components: FlatTax50kComponents };
  employee20k: { applicable: boolean; status: LimitStatus };
  generalFiling50k: { applicable: boolean; status: LimitStatus };
  reporting38v: Flagged38v[];
  cap40M: {
    applicable: boolean;
    capCzk: Money;
    exemptProceedsCzk: Money;
    exceeded: boolean;
  } | null;
}

export function computeLimits(
  securities: SecuritiesResult,
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

  // R-08c/d: do 50k vstupují jen NEosvobozené příjmy — hrubé tržby, zahraniční
  // dividendy brutto, zdanitelné úroky a ruční ostatní příjmy § 8–10.
  const nonExemptProceeds = securities.exemptUnder100k
    ? ZERO
    : sum(securities.disposals.map((disposal) => disposal.taxableProceedsCzk));
  const components: FlatTax50kComponents = {
    nonExemptSecuritiesProceedsCzk: nonExemptProceeds,
    foreignDividendsGrossCzk: dividends.foreignGrossCzk,
    taxableInterestCzk: dividends.taxableInterestCzk,
    otherManualCzk: profile.otherTaxableIncome8to10Czk,
  };
  const sideIncome = nonExemptProceeds
    .plus(dividends.foreignGrossCzk)
    .plus(dividends.taxableInterestCzk)
    .plus(profile.otherTaxableIncome8to10Czk);

  const flatStatus = limitStatus(sideIncome, d(config.limits.flatTaxOtherIncome));
  if (profile.regime === 'PAUSAL' && flatStatus.exceeded) {
    warnings.add(
      'FLAT_TAX_BROKEN',
      'WARNING',
      `Prolomen limit ${config.limits.flatTaxOtherIncome} Kč pro daň rovnou paušální dani (§ 7a): zdanitelné příjmy § 8–10 činí ${sideIncome.toFixed(2)} Kč. Vzniká povinnost podat přiznání a přehledy ČSSZ/ZP (R-08e); v paušálním režimu zůstáváš (R-08a).`,
      { usedCzk: sideIncome.toFixed(2) },
    );
  }

  const employeeStatus = limitStatus(sideIncome, d(config.limits.employeeSideIncome));
  const generalStatus = limitStatus(sideIncome, d(config.limits.generalFiling));

  // R-09d: oznámení jednotlivého osvobozeného příjmu > 5M (§ 38v)
  const reportingThreshold = d(config.limits.exemptIncomeReporting);
  const reporting38v: Flagged38v[] = securities.disposals
    .filter((disposal) => disposal.exemptProceedsCzk.gt(reportingThreshold))
    .map((disposal) => ({
      sellTxId: disposal.sellTxId,
      isin: disposal.isin,
      exemptProceedsCzk: disposal.exemptProceedsCzk,
    }));
  if (reporting38v.length > 0) {
    warnings.add(
      'REPORTING_38V',
      'WARNING',
      `${reporting38v.length} osvobozený příjem/příjmy z prodeje CP přesahují 5 mil. Kč — povinnost oznámit správci daně (§ 38v) ve lhůtě pro přiznání; pokuty dle § 38w až 15 %.`,
      { count: reporting38v.length },
    );
  }

  // R-03: strop 40M — poměrné krácení počítá computeSecurities (vč. varování
  // CAP_40M_REDUCED s čísly); tady jen strukturovaný stav pro UI.
  const cap = config.limits.timeTestExemptionCap;
  const cap40M = cap
    ? {
        applicable: true,
        capCzk: d(cap),
        exemptProceedsCzk: securities.timeTestExemptProceedsCzk,
        exceeded: securities.timeTestExemptProceedsCzk.gt(d(cap)),
      }
    : null;

  return {
    limit100k,
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
