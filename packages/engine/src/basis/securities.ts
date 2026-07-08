import { d, sum, ZERO, type IsoDate, type Money } from '@danero/shared';
import type { EngineOptions } from '../config/options';
import type { TaxYearConfig } from '../config/taxYear';
import type { FxConverter } from '../fx/fx';
import type { Disposal } from '../ledger/ledger';
import { WarningCollector } from '../warnings';

export interface AllocationReport {
  lotId: string;
  quantity: Money;
  timeTestExempt: boolean;
  exemptFrom: IsoDate;
  proceedsCzk: Money;
  /** Výdaje jen u zdanitelných alokací — k osvobozeným je uplatnit nelze (R-05b). */
  expenseCzk: Money;
  interpretive: boolean;
}

export interface DisposalReport {
  sellTxId: string;
  isin: string;
  saleDate: IsoDate;
  grossProceedsCzk: Money;
  exemptProceedsCzk: Money;
  taxableProceedsCzk: Money;
  /** Příspěvek prodeje do limitu 100k dle přepínače R-02c (pro UI čerpání). */
  limit100kContributionCzk: Money;
  /**
   * Skutečný obchodní výsledek prodeje (tržby − plné náklady VŠECH alokací,
   * kurzy dle R-06) — informativní metrika pro grafy; do daně nevstupuje
   * (daňový výdaj u osvobozených alokací je 0, viz expenseCzk alokací).
   */
  realizedResultCzk: Money;
  allocations: AllocationReport[];
}

export interface SecuritiesResult {
  /** Úhrn hrubých příjmů (tržeb) z prodeje CP v roce, v CZK. */
  totalGrossProceedsCzk: Money;
  /** Úhrn posuzovaný proti limitu 100k dle přepínače R-02c. */
  pool100kCzk: Money;
  /** R-02: úhrn nepřesáhl 100k → veškeré příjmy z prodeje CP osvobozeny (§ 4/1 t). */
  exemptUnder100k: boolean;
  taxableIncomeCzk: Money;
  expensesCzk: Money;
  /** Skutečný rozdíl příjmů a výdajů — může být záporný (informativně). */
  rawGainLossCzk: Money;
  /** Dílčí základ § 10 z CP: max(0, rawGainLoss) — R-05d. */
  base10Czk: Money;
  /** Příjmy osvobozené časovým testem — vstup pro strop 40M (R-03) a § 38v. */
  timeTestExemptProceedsCzk: Money;
  disposals: DisposalReport[];
}

/**
 * Výpočet dílčího základu § 10 z prodejů CP a vyhodnocení hodnotového testu 100k.
 * Vstupem jsou prodeje cílového roku (bez kryptoaktiv — jiný druh příjmu, R-10).
 */
export function computeSecurities(
  disposals: Disposal[],
  fx: FxConverter,
  config: TaxYearConfig,
  options: EngineOptions,
  warnings: WarningCollector,
): SecuritiesResult {
  const limit = d(config.limits.securitiesProceedsExemption);

  // 1. průchod: hrubé příjmy, klasifikace alokací, pool pro 100k (R-02c)
  const prepared = disposals.map((disposal) => {
    const grossCzk = fx.toCzk(disposal.grossProceeds, disposal.currency, disposal.saleDate);
    const allocations = disposal.allocations.map((alloc) => {
      const share = disposal.quantity.gt(0) ? alloc.quantity.div(disposal.quantity) : ZERO;
      return { alloc, proceedsCzk: grossCzk.mul(share) };
    });
    const exemptCzk = sum(
      allocations.filter((a) => a.alloc.timeTestExempt).map((a) => a.proceedsCzk),
    );
    return { disposal, grossCzk, allocations, exemptCzk, taxableCzk: grossCzk.sub(exemptCzk) };
  });

  const totalGross = sum(prepared.map((p) => p.grossCzk));
  const timeTestExemptProceeds = sum(prepared.map((p) => p.exemptCzk));
  const pool = options.limit100kIncludesTimeTestExempt
    ? totalGross
    : sum(prepared.map((p) => p.taxableCzk));
  const exemptUnder100k = pool.lte(limit);

  // R-03: strop úhrnu příjmů osvobozených časovým testem (2025: 40 mil. Kč;
  // pro CP od 2026 zrušen → cap null). Při překročení se osvobození krátí
  // POMĚRNĚ: osvobozeno zůstává příjem × (strop / úhrn), zbytek se dodaňuje
  // a výdaje k dodaněné části se uplatní týmž poměrem (docs/02 R-03).
  const capRaw = config.limits.timeTestExemptionCap;
  const cap = capRaw ? d(capRaw) : null;
  const capApplies =
    cap !== null && !exemptUnder100k && timeTestExemptProceeds.gt(cap);
  const exemptRatio = capApplies ? cap.div(timeTestExemptProceeds) : d(1);
  if (capApplies) {
    warnings.add(
      'CAP_40M_REDUCED',
      'WARNING',
      `Úhrn příjmů osvobozených časovým testem ${timeTestExemptProceeds.toFixed(2)} Kč přesáhl strop ${cap.toFixed(0)} Kč (§ 4 odst. 3, R-03). Osvobození je kráceno poměrně: osvobozeno zůstává ${exemptRatio.mul(100).toFixed(2)} % těchto příjmů, zbytek vstupuje do dílčího základu § 10 s poměrnou částí výdajů. Rozhodný je moment přijetí peněz — zkontroluj vypořádání přes přelom roku.`,
    );
  }

  // 2. průchod: výdaje a základ jen u zdanitelných alokací
  let taxableIncome = ZERO;
  let expenses = ZERO;
  const reports: DisposalReport[] = [];

  for (const { disposal, grossCzk, allocations, exemptCzk, taxableCzk } of prepared) {
    const allocationReports: AllocationReport[] = [];
    let realizedResult = ZERO;
    for (const { alloc, proceedsCzk } of allocations) {
      const isTaxable = !exemptUnder100k && !alloc.timeTestExempt;
      // Nabývací cena + poměrná část nákupního poplatku kurzem dne/roku vynaložení (R-06a),
      // + poměrná část prodejního poplatku kurzem dne/roku prodeje. Počítá se pro
      // všechny alokace (kvůli realizedResultCzk); DAŇOVÝM výdajem je jen u zdanitelných.
      const costCcy = alloc.quantity.mul(alloc.costPerShare);
      const sellFeeShare = disposal.quantity.gt(0)
        ? disposal.sellFee.mul(alloc.quantity).div(disposal.quantity)
        : ZERO;
      const fullExpenseCzk = fx
        .toCzk(costCcy, alloc.lotCurrency, alloc.expenseDate)
        .plus(fx.toCzk(alloc.buyFeeShare, alloc.buyFeeCurrency, alloc.expenseDate))
        .plus(fx.toCzk(sellFeeShare, disposal.sellFeeCurrency, disposal.saleDate));
      realizedResult = realizedResult.plus(proceedsCzk).minus(fullExpenseCzk);

      let expenseCzk = ZERO;
      if (isTaxable) {
        expenseCzk = fullExpenseCzk;
        taxableIncome = taxableIncome.plus(proceedsCzk);
        expenses = expenses.plus(expenseCzk);
      } else if (capApplies && alloc.timeTestExempt && !exemptUnder100k) {
        // R-03: dodanění části časově osvobozené alokace nad strop —
        // příjem i výdaj poměrem (1 − exemptRatio)
        const taxableShare = d(1).minus(exemptRatio);
        expenseCzk = fullExpenseCzk.mul(taxableShare);
        taxableIncome = taxableIncome.plus(proceedsCzk.mul(taxableShare));
        expenses = expenses.plus(expenseCzk);
      }
      allocationReports.push({
        lotId: alloc.lotId,
        quantity: alloc.quantity,
        timeTestExempt: alloc.timeTestExempt,
        exemptFrom: alloc.exemptFrom,
        proceedsCzk,
        expenseCzk,
        interpretive: alloc.interpretive,
      });
    }
    // R-03: krácení mění osvobozenou/zdanitelnou část prodeje
    const exemptAfterCap = exemptCzk.mul(exemptRatio);
    reports.push({
      sellTxId: disposal.sellTxId,
      isin: disposal.isin,
      saleDate: disposal.saleDate,
      grossProceedsCzk: grossCzk,
      exemptProceedsCzk: exemptUnder100k ? grossCzk : exemptAfterCap,
      taxableProceedsCzk: exemptUnder100k ? ZERO : grossCzk.sub(exemptAfterCap),
      limit100kContributionCzk: options.limit100kIncludesTimeTestExempt ? grossCzk : taxableCzk,
      realizedResultCzk: realizedResult,
      allocations: allocationReports,
    });
  }

  const raw = taxableIncome.sub(expenses);
  const base10 = raw.gt(0) ? raw : ZERO;
  if (raw.lt(0)) {
    warnings.add(
      'LOSS_NOT_DEDUCTIBLE',
      'INFO',
      `Prodeje CP skončily celkovou ztrátou ${raw.toFixed(2)} Kč — k zápornému rozdílu se nepřihlíží (§ 10 odst. 4, R-05d), dílčí základ je 0. Ztrátu nelze přenést ani započíst jinde.`,
    );
  }

  return {
    totalGrossProceedsCzk: totalGross,
    pool100kCzk: pool,
    exemptUnder100k,
    taxableIncomeCzk: taxableIncome,
    expensesCzk: expenses,
    rawGainLossCzk: raw,
    base10Czk: base10,
    timeTestExemptProceedsCzk: timeTestExemptProceeds,
    disposals: reports,
  };
}
