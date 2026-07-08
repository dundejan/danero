import { d, sum, ZERO, type IsoDate, type Money } from '@danero/shared';
import type { EngineOptions } from '../config/options';
import type { FxConverter } from '../fx/fx';
import type { Disposal, DisposalAllocation } from '../ledger/ledger';
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
  /** Úhrn hrubých příjmů (tržeb) z prodejů druhu v roce, v CZK. */
  totalGrossProceedsCzk: Money;
  /** Úhrn posuzovaný proti limitu 100k dle přepínače R-02c. */
  pool100kCzk: Money;
  /**
   * R-02/R-10a: úhrn nepřesáhl 100k → příjmy z prodejů osvobozeny (§ 4/1 t / zj).
   * U krypta se osvobození týká jen prodejů s nárokem dle R-10b (od 15. 2. 2025).
   */
  exemptUnder100k: boolean;
  taxableIncomeCzk: Money;
  expensesCzk: Money;
  /** Skutečný rozdíl příjmů a výdajů — může být záporný (informativně). */
  rawGainLossCzk: Money;
  /** Dílčí základ § 10 druhu: max(0, rawGainLoss) — R-05d/R-10c (druhy se nekompenzují). */
  base10Czk: Money;
  /** Příjmy osvobozené časovým testem — vstup pro strop 40M (R-03/R-10d) a § 38v. */
  timeTestExemptProceedsCzk: Money;
  disposals: DisposalReport[];
}

/**
 * R-10b: dostupnost osvobození zj)/zk) pro druh příjmu — u CP vždy; u kryptoaktiv
 * dle účinnosti zák. č. 32/2025 Sb. (ZO ≤ 2024 bez osvobození, 2025 až od 15. 2.).
 */
export interface ExemptionAvailability {
  available: boolean;
  /** Prodeje přede dnem účinnosti nárok na osvobození nemají; null = celé období. */
  effectiveFrom: IsoDate | null;
}

interface PreparedDisposal {
  disposal: Disposal;
  grossCzk: Money;
  allocations: Array<{ alloc: DisposalAllocation; proceedsCzk: Money }>;
  /** Má prodej nárok na osvobození zj)/zk)? U CP vždy true (R-10b). */
  exemptionEligible: boolean;
  /** Část tržby osvobozená časovým testem (0 u prodejů bez nároku na osvobození). */
  exemptCzk: Money;
  taxableCzk: Money;
  /** Příspěvek do poolu 100k (R-02c; prodeje bez nároku nepřispívají — KOOV 625, 2.2.1.5). */
  pool100kContributionCzk: Money;
}

export interface PreparedDisposals {
  items: PreparedDisposal[];
  totalGrossCzk: Money;
  pool100kCzk: Money;
  /** Příjmy osvobozené časovým testem — vstup pro SDÍLENÝ strop 40M (R-03/R-10d). */
  timeTestExemptProceedsCzk: Money;
}

/**
 * 1. fáze výpočtu jednoho druhu příjmu § 10: FX převod tržeb, klasifikace
 * osvobození a pool 100k. Oddělená od computeSecurities, protože strop § 4/3
 * se počítá SPOLEČNĚ přes druhy (CP + krypto, R-10d) — kombinovaný úhrn
 * a výsledný poměr krácení skládá engine.ts z připravených dat obou druhů.
 */
export function prepareDisposals(
  disposals: Disposal[],
  fx: FxConverter,
  options: EngineOptions,
  exemption: ExemptionAvailability,
): PreparedDisposals {
  const items = disposals.map((disposal): PreparedDisposal => {
    const grossCzk = fx.toCzk(disposal.grossProceeds, disposal.currency, disposal.saleDate);
    // R-10b: prodej před účinností zák. 32/2025 Sb. nemá nárok na žádné osvobození
    const eligible =
      exemption.available &&
      (exemption.effectiveFrom === null || disposal.saleDate >= exemption.effectiveFrom);
    const allocations = disposal.allocations.map((alloc) => {
      const share = disposal.quantity.gt(0) ? alloc.quantity.div(disposal.quantity) : ZERO;
      return { alloc, proceedsCzk: grossCzk.mul(share) };
    });
    const exemptCzk = eligible
      ? sum(allocations.filter((a) => a.alloc.timeTestExempt).map((a) => a.proceedsCzk))
      : ZERO;
    const taxableCzk = grossCzk.sub(exemptCzk);
    // R-02c: striktně celá tržba, mírněji jen testem neosvobozená část;
    // prodeje bez nároku (R-10b) do limitu 100k nevstupují vůbec
    const pool100kContributionCzk = !eligible
      ? ZERO
      : options.limit100kIncludesTimeTestExempt
        ? grossCzk
        : taxableCzk;
    return {
      disposal,
      grossCzk,
      allocations,
      exemptionEligible: eligible,
      exemptCzk,
      taxableCzk,
      pool100kContributionCzk,
    };
  });

  return {
    items,
    totalGrossCzk: sum(items.map((p) => p.grossCzk)),
    pool100kCzk: sum(items.map((p) => p.pool100kContributionCzk)),
    timeTestExemptProceedsCzk: sum(items.map((p) => p.exemptCzk)),
  };
}

export interface SecuritiesComputeParams {
  /** Hodnotový limit osvobození úhrnu tržeb (§ 4/1 t — R-02, resp. zj — R-10a). */
  exemptionLimitCzk: Money;
  /**
   * Poměr osvobození pod stropem § 4/3 (R-03/R-10d): strop / kombinovaný úhrn
   * časově osvobozených příjmů VŠECH druhů pod stropem; 1 = bez krácení.
   * Počítá engine.ts (sdílený přes druhy), krácení aplikuje každý druh na své alokace.
   */
  capExemptRatio: Money;
  /** Popisek druhu do textů varování ('CP' | 'kryptoaktiv'). */
  label: string;
  /** ID pravidla kompenzace ztrát do varování (R-05d pro CP, R-10c pro krypto). */
  lossRuleId: string;
}

/**
 * 2. fáze: hodnotový test, krácení stropem § 4/3, výdaje a dílčí základ § 10
 * jednoho druhu příjmu. Stejná logika pro CP i kryptoaktiva — liší se jen
 * parametry (limit, poměr stropu, dostupnost osvobození řeší prepareDisposals).
 */
export function computeSecurities(
  prepared: PreparedDisposals,
  fx: FxConverter,
  params: SecuritiesComputeParams,
  warnings: WarningCollector,
): SecuritiesResult {
  const exemptUnder100k = prepared.pool100kCzk.lte(params.exemptionLimitCzk);
  const exemptRatio = params.capExemptRatio;
  const capApplies = exemptRatio.lt(1);

  let taxableIncome = ZERO;
  let expenses = ZERO;
  const reports: DisposalReport[] = [];

  for (const item of prepared.items) {
    const { disposal, grossCzk, allocations, exemptionEligible, exemptCzk } = item;
    const allocationReports: AllocationReport[] = [];
    let realizedResult = ZERO;
    for (const { alloc, proceedsCzk } of allocations) {
      // R-10b: bez nároku na osvobození je alokace zdanitelná i po časovém testu
      const allocExempt = exemptionEligible && alloc.timeTestExempt;
      const isTaxable = !exemptionEligible || (!exemptUnder100k && !alloc.timeTestExempt);
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
      } else if (capApplies && allocExempt) {
        // R-03/R-10d: dodanění části časově osvobozené alokace nad strop —
        // příjem i výdaj poměrem (1 − exemptRatio)
        const taxableShare = d(1).minus(exemptRatio);
        expenseCzk = fullExpenseCzk.mul(taxableShare);
        taxableIncome = taxableIncome.plus(proceedsCzk.mul(taxableShare));
        expenses = expenses.plus(expenseCzk);
      }
      allocationReports.push({
        lotId: alloc.lotId,
        quantity: alloc.quantity,
        timeTestExempt: allocExempt,
        exemptFrom: alloc.exemptFrom,
        proceedsCzk,
        expenseCzk,
        interpretive: alloc.interpretive,
      });
    }
    // R-03: krácení mění osvobozenou/zdanitelnou část prodeje; dodaněná část
    // časově osvobozených kusů je zdanitelná i v roce s exemptUnder100k
    const taxedFromCap = exemptCzk.mul(d(1).minus(exemptRatio));
    const exemptAfterCap = exemptCzk.mul(exemptRatio);
    const fullyExemptByValue = exemptionEligible && exemptUnder100k;
    reports.push({
      sellTxId: disposal.sellTxId,
      isin: disposal.isin,
      saleDate: disposal.saleDate,
      grossProceedsCzk: grossCzk,
      exemptProceedsCzk: fullyExemptByValue ? grossCzk.sub(taxedFromCap) : exemptAfterCap,
      taxableProceedsCzk: fullyExemptByValue ? taxedFromCap : grossCzk.sub(exemptAfterCap),
      limit100kContributionCzk: item.pool100kContributionCzk,
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
      `Prodeje ${params.label} skončily celkovou ztrátou ${raw.toFixed(2)} Kč — k zápornému rozdílu se nepřihlíží (§ 10 odst. 4, ${params.lossRuleId}), dílčí základ je 0. Ztrátu nelze přenést ani započíst jinde.`,
    );
  }

  return {
    totalGrossProceedsCzk: prepared.totalGrossCzk,
    pool100kCzk: prepared.pool100kCzk,
    exemptUnder100k,
    taxableIncomeCzk: taxableIncome,
    expensesCzk: expenses,
    rawGainLossCzk: raw,
    base10Czk: base10,
    timeTestExemptProceedsCzk: prepared.timeTestExemptProceedsCzk,
    disposals: reports,
  };
}
