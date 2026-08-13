import { d, sum, ZERO, type IsoDate, type Money } from '@danero/shared';
import type { EngineOptions } from '../config/options';
import { czkText } from '../format';
import type { FxConverter } from '../fx/fx';
import type { Disposal, DisposalAllocation } from '../ledger/ledger';
import { WarningCollector } from '../warnings';
import { isEmtIdentifier } from './emt';
import type { ShortSalesResult } from './shortSales';

export interface AllocationReport {
  lotId: string;
  quantity: Money;
  /** Datum nabytí lotu (R-01a) — auditovatelnost párování a kurzu roku nákupu. */
  acquisitionDate: IsoDate;
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
  /** R-10a: instrument je EMT (stablecoin) — bez hodnotového osvobození zj). */
  isEmt: boolean;
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
  /** Z toho to, co pod strop 40M skutečně vstupuje (R-03a — per prodej). */
  capExposedProceedsCzk: Money;
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
  /**
   * R-10a: detekovat EMT (stablecoiny) podle tickeru — zapíná jen druh
   * kryptoaktiva (u CP je identifikátorem ISIN, detekce nedává smysl).
   */
  detectEmt?: boolean;
}

interface PreparedDisposal {
  disposal: Disposal;
  grossCzk: Money;
  allocations: Array<{ alloc: DisposalAllocation; proceedsCzk: Money }>;
  /** R-10a: instrument je EMT (stablecoin) — zůstává ve stejném druhu § 10. */
  isEmt: boolean;
  /** Nárok na hodnotové osvobození zj)/t) — u EMT nikdy (R-10a), jinak dle R-10b. */
  valueExemptionEligible: boolean;
  /** Nárok na časový test zk)/u) — u EMT jen s přepínačem emtTimeTestExempt (R-10g). */
  timeTestEligible: boolean;
  /** Část tržby osvobozená časovým testem (0 u prodejů bez nároku na osvobození). */
  exemptCzk: Money;
  taxableCzk: Money;
  /** Příspěvek do poolu 100k (R-02c; prodeje bez nároku a EMT nepřispívají). */
  pool100kContributionCzk: Money;
  /**
   * R-10g: tržby EMT alokací splňujících časový test (jen prodeje s nárokem dle
   * R-10b) — vyčíslení dopadu mírnějšího výkladu, počítá se bez ohledu na přepínač.
   */
  emtTimeTestableCzk: Money;
}

export interface PreparedDisposals {
  items: PreparedDisposal[];
  totalGrossCzk: Money;
  pool100kCzk: Money;
  /** Příjmy osvobozené časovým testem — vstup pro SDÍLENÝ strop 40M (R-03/R-10d). */
  timeTestExemptProceedsCzk: Money;
  /** R-10a: úhrn hrubých tržeb z prodejů EMT (pro varování CRYPTO_EMT_DETECTED). */
  emtProceedsCzk: Money;
  /**
   * R-10g: tržby EMT alokací splňujících časový test — vyčíslení, co by mírnější
   * výklad (emtTimeTestExempt) osvobodil. Počítá se vždy, bez ohledu na přepínač.
   */
  emtTimeTestableProceedsCzk: Money;
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
    // R-05a/R-06a: příjem se realizuje připsáním peněz (settlement) — kurz tržby
    // jde VŽDY po vypořádání; přepínač timeTestDateBasis (R-01a) mění jen saleDate
    // pro časový test, roku příjmu ani kurzu se netýká
    const grossCzk = fx.toCzk(disposal.grossProceeds, disposal.currency, disposal.settlementDate);
    // R-10b: rozhodný je den realizace příjmu (vypořádání) — prodej vypořádaný
    // před účinností zák. 32/2025 Sb. nemá nárok na žádné osvobození
    const eligible =
      exemption.available &&
      (exemption.effectiveFrom === null || disposal.settlementDate >= exemption.effectiveFrom);
    // R-10a: EMT (stablecoin) je z hodnotového osvobození zj) vyloučen vždy;
    // časový test zk) se na něj vztahuje jen při mírnějším výkladu (R-10g)
    const isEmt = exemption.detectEmt === true && isEmtIdentifier(disposal.isin);
    const valueExemptionEligible = eligible && !isEmt;
    const timeTestEligible = eligible && (!isEmt || options.emtTimeTestExempt);
    const allocations = disposal.allocations.map((alloc) => {
      const share = disposal.quantity.gt(0) ? alloc.quantity.div(disposal.quantity) : ZERO;
      return { alloc, proceedsCzk: grossCzk.mul(share) };
    });
    const timeTestableCzk = eligible
      ? sum(allocations.filter((a) => a.alloc.timeTestExempt).map((a) => a.proceedsCzk))
      : ZERO;
    const exemptCzk = timeTestEligible ? timeTestableCzk : ZERO;
    const taxableCzk = grossCzk.sub(exemptCzk);
    // R-02c: striktně celá tržba, mírněji jen testem neosvobozená část; prodeje
    // bez nároku (R-10b) a EMT (R-10a) do limitu 100k nevstupují vůbec
    const pool100kContributionCzk = !valueExemptionEligible
      ? ZERO
      : options.limit100kIncludesTimeTestExempt
        ? grossCzk
        : taxableCzk;
    return {
      disposal,
      grossCzk,
      allocations,
      isEmt,
      valueExemptionEligible,
      timeTestEligible,
      exemptCzk,
      taxableCzk,
      pool100kContributionCzk,
      emtTimeTestableCzk: isEmt ? timeTestableCzk : ZERO,
    };
  });

  const emtItems = items.filter((p) => p.isEmt);
  return {
    items,
    totalGrossCzk: sum(items.map((p) => p.grossCzk)),
    pool100kCzk: sum(items.map((p) => p.pool100kContributionCzk)),
    timeTestExemptProceedsCzk: sum(items.map((p) => p.exemptCzk)),
    emtProceedsCzk: sum(emtItems.map((p) => p.grossCzk)),
    emtTimeTestableProceedsCzk: sum(emtItems.map((p) => p.emtTimeTestableCzk)),
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
  /** R-02c: vstupují do úhrnu 100k i časově osvobozené tržby? (striktní výklad) */
  includesTimeTestExempt: boolean;
  /** Popisek druhu do textů varování ('CP' | 'kryptoaktiv'). */
  label: string;
  /** ID pravidla kompenzace ztrát do varování (R-05d pro CP, R-10c pro krypto). */
  lossRuleId: string;
  /**
   * R-10b: existuje v tomhle zdaňovacím období hodnotové osvobození vůbec?
   * U CP vždy, u kryptoaktiv až od účinnosti zák. č. 32/2025 Sb. V roce bez
   * osvobození je pool nulový, takže by `pool ≤ limit` vyšlo `true` a report
   * by u každého lotu tvrdil „osvobozeno úhrnem do 100 000 Kč“, přestože se
   * celý prodej daní (nález A2-12).
   */
  valueExemptionAvailable: boolean;
  /**
   * R-13: prodeje nakrátko téhož druhu (kód D). Loty nemají, takže se počítají
   * zvlášť — do stovky (R-13e) i do kompenzace uvnitř druhu (§ 10/4) ale patří
   * dohromady s ostatními prodeji. U kryptoaktiv se nepředává (short na spotu
   * u nich neevidujeme).
   */
  shortSales?: ShortSalesResult;
}

/**
 * R-03a: kolik z časově osvobozených tržeb druhu vstupuje pod strop 40M.
 *
 * Vyloučení hodnotově osvobozených příjmů je per PRODEJ, ne per DRUH. Dokud se
 * počítalo per druh („pool ≤ 100 000 → celý druh je mimo strop"), unikly stropu
 * i prodeje, které hodnotové osvobození nikdy mít nemohou: § 4/1 zj) vylučuje
 * EMT výslovně (R-10a), takže se jejich tržby do úhrnu 100k vůbec nepočítají
 * a osvobození stojí čistě na zk) — přesně na to strop dopadá. Se zapnutým
 * přepínačem `emtTimeTestExempt` to byl doložený rozdíl daně 1 238 975,04 Kč
 * (nález A2-3-01).
 *
 * Podmínka `includesTimeTestExempt` zůstává: hodnotové osvobození časově
 * osvobozenou tržbu pokryje jen tehdy, když do úhrnu 100k vůbec vstupuje, tedy
 * při striktním výkladu R-02c (default).
 */
export function capExposedProceedsCzk(
  prepared: PreparedDisposals,
  params: {
    exemptionLimitCzk: Money;
    valueExemptionAvailable: boolean;
    includesTimeTestExempt: boolean;
    /** R-13e: tržby ze shortů čerpají tentýž pool — bez nich by test osvobození
        uvnitř stropu vycházel jinak než test v `computeSecurities`. */
    extraPoolCzk?: Money;
  },
): Money {
  const pool = prepared.pool100kCzk.plus(params.extraPoolCzk ?? ZERO);
  const coveredByValue =
    params.includesTimeTestExempt &&
    params.valueExemptionAvailable &&
    pool.lte(params.exemptionLimitCzk);
  if (!coveredByValue) return prepared.timeTestExemptProceedsCzk;
  return sum(prepared.items.filter((p) => !p.valueExemptionEligible).map((p) => p.exemptCzk));
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
  const shortSales = params.shortSales;
  // R-13e: hrubá tržba shortu čerpá tutéž stovku jako běžné prodeje — a může
  // přes ni přetlačit i jinak osvobozené longy. Buď je short úplatný převod CP
  // (pak platí obojí), nebo není (pak ani jedno) — vázané, ne dvě volby.
  const pool100kCzk = prepared.pool100kCzk.plus(shortSales?.proceedsCzk ?? ZERO);
  const exemptUnder100k =
    params.valueExemptionAvailable && pool100kCzk.lte(params.exemptionLimitCzk);
  const exemptRatio = params.capExemptRatio;
  const capApplies = exemptRatio.lt(1);

  let taxableIncome = ZERO;
  let expenses = ZERO;
  const reports: DisposalReport[] = [];

  for (const item of prepared.items) {
    const { disposal, grossCzk, allocations, valueExemptionEligible, timeTestEligible, exemptCzk } =
      item;
    // R-10a: hodnotové osvobození zj)/t) se na EMT nevztahuje (valueExemptionEligible)
    const fullyExemptByValue = valueExemptionEligible && exemptUnder100k;
    const allocationReports: AllocationReport[] = [];
    let realizedResult = ZERO;
    for (const { alloc, proceedsCzk } of allocations) {
      // R-10b/R-10g: bez nároku na osvobození je alokace zdanitelná i po časovém testu
      const allocExempt = timeTestEligible && alloc.timeTestExempt;
      const isTaxable = !allocExempt && !fullyExemptByValue;
      // Nabývací cena + poměrná část nákupního poplatku kurzem dne/roku vynaložení (R-06a),
      // + poměrná část prodejního poplatku kurzem dne/roku vypořádání prodeje
      // (R-06a — stejně jako tržba, nezávisle na bázi časového testu). Počítá se pro
      // všechny alokace (kvůli realizedResultCzk); DAŇOVÝM výdajem je jen u zdanitelných.
      const costCcy = alloc.quantity.mul(alloc.costPerShare);
      const sellFeeShare = disposal.quantity.gt(0)
        ? disposal.sellFee.mul(alloc.quantity).div(disposal.quantity)
        : ZERO;
      const fullExpenseCzk = fx
        .toCzk(costCcy, alloc.lotCurrency, alloc.expenseDate)
        .plus(fx.toCzk(alloc.buyFeeShare, alloc.buyFeeCurrency, alloc.expenseDate))
        .plus(fx.toCzk(sellFeeShare, disposal.sellFeeCurrency, disposal.settlementDate));
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
        acquisitionDate: alloc.acquisitionDate,
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
    reports.push({
      sellTxId: disposal.sellTxId,
      isin: disposal.isin,
      saleDate: disposal.saleDate,
      isEmt: item.isEmt,
      grossProceedsCzk: grossCzk,
      exemptProceedsCzk: fullyExemptByValue ? grossCzk.sub(taxedFromCap) : exemptAfterCap,
      taxableProceedsCzk: fullyExemptByValue ? taxedFromCap : grossCzk.sub(exemptAfterCap),
      limit100kContributionCzk: item.pool100kContributionCzk,
      realizedResultCzk: realizedResult,
      allocations: allocationReports,
    });
  }

  // R-13: short je týž druh — do součtů vstupuje stejně jako ostatní prodeje.
  // Osvobozený druh nepřináší ANI příjem, ANI výdaj: uplatnit zpětný nákup
  // proti nezdaněné tržbě by vyrobilo ztrátu z osvobozeného příjmu (u dlouhých
  // prodejů to `isTaxable` v alokacích řeší stejně).
  if (shortSales) {
    if (exemptUnder100k) {
      // letošní tržby jsou osvobozené → jejich výdaje se neuplatní; výdaj
      // k tržbě zdaněné v dřívějším roce ale zůstává (R-13c)
      expenses = expenses.plus(shortSales.priorYearIncomeExpensesCzk);
    } else {
      taxableIncome = taxableIncome.plus(shortSales.incomeCzk);
      expenses = expenses.plus(shortSales.expensesCzk);
    }
  }

  const raw = taxableIncome.sub(expenses);
  const base10 = raw.gt(0) ? raw : ZERO;
  if (raw.lt(0)) {
    warnings.add(
      'LOSS_NOT_DEDUCTIBLE',
      'INFO',
      `Prodeje ${params.label} skončily celkovou ztrátou ${czkText(raw.abs())} — k zápornému rozdílu se nepřihlíží (§ 10 odst. 4, ${params.lossRuleId}), dílčí základ je 0. Ztrátu nelze přenést ani započíst jinde.`,
    );
  }

  return {
    totalGrossProceedsCzk: prepared.totalGrossCzk.plus(shortSales?.proceedsCzk ?? ZERO),
    pool100kCzk,
    exemptUnder100k,
    taxableIncomeCzk: taxableIncome,
    expensesCzk: expenses,
    rawGainLossCzk: raw,
    base10Czk: base10,
    timeTestExemptProceedsCzk: prepared.timeTestExemptProceedsCzk,
    capExposedProceedsCzk: capExposedProceedsCzk(prepared, {
      exemptionLimitCzk: params.exemptionLimitCzk,
      valueExemptionAvailable: params.valueExemptionAvailable,
      includesTimeTestExempt: params.includesTimeTestExempt,
      extraPoolCzk: shortSales?.proceedsCzk,
    }),
    disposals: reports,
  };
}
