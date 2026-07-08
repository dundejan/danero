import {
  d,
  sum,
  yearOf,
  type DividendTransaction,
  type InterestTransaction,
  type Money,
  type TaxpayerProfile,
  type Transaction,
} from '@danero/shared';
import { computeDividends, type DividendsResult } from './basis/dividends';
import {
  computeSecurities,
  prepareDisposals,
  type PreparedDisposals,
  type SecuritiesResult,
} from './basis/securities';
import { resolveOptions, type EngineOptions } from './config/options';
import type { AssetScope, TaxYearConfig } from './config/taxYear';
import { FxConverter, type DailyRateProvider } from './fx/fx';
import { buildLedger, type Ledger } from './ledger/ledger';
import { computeLimits, type LimitsResult } from './limits/limits';
import { estimateTax, type TaxEstimate } from './tax/estimate';
import { classifyTimeTest, positionsAt, type Position } from './timetest/timeTest';
import { WarningCollector, type EngineWarning } from './warnings';

export interface EngineInput {
  /** Kompletní historie transakcí od prvního nákupu — bez ní nelze párování ani časový test. */
  transactions: Transaction[];
  profile: TaxpayerProfile;
  config: TaxYearConfig;
  options?: Partial<EngineOptions>;
  dailyRates?: DailyRateProvider;
}

export interface TaxYearResult {
  year: number;
  /** Použitá konfigurace přepínačů — tiskne se do reportu (průkaznost). */
  options: EngineOptions;
  securities: SecuritiesResult;
  /** R-10: kryptoaktiva — jiný druh příjmu § 10 s vlastními limity (zj/zk), bez kompenzace s CP. */
  crypto: SecuritiesResult;
  dividends: DividendsResult;
  limits: LimitsResult;
  tax: TaxEstimate;
  /** Otevřené pozice k 31. 12. cílového roku (hlídač volá positionsAt s dneškem). */
  positions: Position[];
  ledger: Ledger;
  warnings: EngineWarning[];
}

/**
 * R-03/R-10d/R-10e: strop § 4 odst. 3 je SPOLEČNÝ přes druhy příjmů, na které se
 * v daném roce vztahuje (2025: CP + krypto; od 2026 jen krypto). Poměr osvobození =
 * strop / kombinovaný úhrn časově osvobozených příjmů; krácení pak každý druh
 * aplikuje na své alokace. Čistá funkce nad připravenými daty obou druhů.
 */
function resolveSharedCapRatios(
  config: TaxYearConfig,
  prepared: Record<AssetScope, PreparedDisposals>,
  warnings: WarningCollector,
): Record<AssetScope, Money> {
  const ratios: Record<AssetScope, Money> = { SECURITIES: d(1), CRYPTO: d(1) };
  const cap = config.limits.timeTestCap;
  if (!cap) return ratios;
  const capCzk = d(cap.amountCzk);
  const combined = sum(cap.appliesTo.map((scope) => prepared[scope].timeTestExemptProceedsCzk));
  if (combined.lte(capCzk)) return ratios;

  const ratio = capCzk.div(combined);
  const scopeLabel = cap.appliesTo
    .map((scope) => (scope === 'SECURITIES' ? 'CP' : 'kryptoaktiva'))
    .join(' + ');
  warnings.add(
    'CAP_40M_REDUCED',
    'WARNING',
    `Úhrn příjmů osvobozených časovým testem (${scopeLabel}) ${combined.toFixed(2)} Kč přesáhl strop ${capCzk.toFixed(0)} Kč (§ 4 odst. 3, R-03/R-10d). Osvobození je kráceno poměrně: osvobozeno zůstává ${ratio.mul(100).toFixed(2)} % těchto příjmů, zbytek vstupuje do dílčího základu § 10 s poměrnou částí výdajů. Rozhodný je moment přijetí peněz — zkontroluj vypořádání přes přelom roku.`,
  );
  for (const scope of cap.appliesTo) ratios[scope] = ratio;
  return ratios;
}

/**
 * Čistá funkce (transakce, konfigurace) → výsledek. Žádné I/O, deterministická —
 * každý přepočet je plně reprodukovatelný od nuly (docs/04, klíčový invariant).
 */
export function analyzeTaxYear(input: EngineInput): TaxYearResult {
  const options = resolveOptions(input.options);
  const warnings = new WarningCollector();
  const fx = new FxConverter(input.config, options.fxMethod, warnings, input.dailyRates);
  const config = input.config;
  const year = config.year;

  const ledger = buildLedger(input.transactions, options, warnings);
  classifyTimeTest(ledger.disposals, input.profile);

  // R-10: druh příjmu je vlastnost INSTRUMENTU, ne řádku — stačí jediná transakce
  // označená CRYPTO a celý ISIN se počítá jako kryptoaktivum. Jinak by prodej
  // s nevyplněným asset_class tiše sklouzl pod CP limit a CP časový test.
  const cryptoIsins = new Set(
    input.transactions.flatMap((tx) =>
      'assetClass' in tx && tx.assetClass === 'CRYPTO' ? [tx.isin] : [],
    ),
  );
  const isCryptoDisposal = (disposal: (typeof ledger.disposals)[number]) =>
    cryptoIsins.has(disposal.isin);
  for (const disposal of ledger.disposals) {
    if (disposal.assetClass !== 'CRYPTO' && cryptoIsins.has(disposal.isin)) {
      warnings.add(
        'ASSET_CLASS_NORMALIZED',
        'INFO',
        `Instrument ${disposal.isin} má u části transakcí vyplněný druh kryptoaktivum a u části ne — počítáme celý instrument jako kryptoaktivum (vlastní limit 100k, pravidla R-10). Sjednoť sloupec asset_class v importu.`,
        { isin: disposal.isin },
      );
      break;
    }
  }

  const yearDisposals = ledger.disposals.filter((disposal) => disposal.incomeYear === year);
  const securitiesPrepared = prepareDisposals(
    yearDisposals.filter((disposal) => !isCryptoDisposal(disposal)),
    fx,
    options,
    { available: true, effectiveFrom: null },
  );
  // R-10b: krypto osvobození až od účinnosti zák. č. 32/2025 Sb. (2025: od 15. 2.;
  // ZO ≤ 2024 žádné) — dřívější prodeje jsou plně zdanitelné a nečerpají limit 100k
  const cryptoPrepared = prepareDisposals(
    yearDisposals.filter((disposal) => isCryptoDisposal(disposal)),
    fx,
    options,
    {
      available: config.cryptoRules.exemptionsAvailable,
      effectiveFrom: config.cryptoRules.effectiveFrom,
    },
  );

  const capRatios = resolveSharedCapRatios(
    config,
    { SECURITIES: securitiesPrepared, CRYPTO: cryptoPrepared },
    warnings,
  );
  const securities = computeSecurities(
    securitiesPrepared,
    fx,
    {
      exemptionLimitCzk: d(config.limits.securitiesProceedsExemption),
      capExemptRatio: capRatios.SECURITIES,
      label: 'CP',
      lossRuleId: 'R-05d',
    },
    warnings,
  );
  const crypto = computeSecurities(
    cryptoPrepared,
    fx,
    {
      exemptionLimitCzk: d(config.limits.cryptoProceedsExemption),
      capExemptRatio: capRatios.CRYPTO,
      label: 'kryptoaktiv',
      lossRuleId: 'R-10c',
    },
    warnings,
  );

  // R-10g: osvobození zj) nezahrnuje elektronické peněžní tokeny (EMT), které
  // z dat brokera nedetekujeme — při každé aplikaci krypto osvobození poctivě upozorni
  const cryptoExemptCzk = sum(crypto.disposals.map((report) => report.exemptProceedsCzk));
  if (cryptoExemptCzk.gt(0)) {
    warnings.add(
      'CRYPTO_EMT_ASSUMPTION',
      'WARNING',
      `Osvobozené příjmy z kryptoaktiv ${cryptoExemptCzk.toFixed(2)} Kč: předpokládáme, že nejde o elektronické peněžní tokeny (např. USDT/USDC) — ty mají hodnotové osvobození 100 000 Kč (§ 4/1 zj) vyloučené (R-10a/R-10g). Pokud jsi prodával stablecoiny, vyřaď je nebo označ ručně.`,
      { exemptCzk: cryptoExemptCzk.toFixed(2) },
    );
  }

  const dividendTxs = input.transactions.filter(
    (tx): tx is DividendTransaction => tx.type === 'DIVIDEND' && yearOf(tx.date) === year,
  );
  const interestTxs = input.transactions.filter(
    (tx): tx is InterestTransaction => tx.type === 'INTEREST' && yearOf(tx.date) === year,
  );
  const dividends = computeDividends(dividendTxs, interestTxs, fx, options, warnings);

  const limits = computeLimits(
    securities,
    crypto,
    dividends,
    input.profile,
    config,
    warnings,
    options.limit100kIncludesTimeTestExempt,
  );
  const tax = estimateTax(securities, crypto, dividends, config, warnings);
  const positions = positionsAt(ledger, `${year}-12-31`);

  return {
    year,
    options,
    securities,
    crypto,
    dividends,
    limits,
    tax,
    positions,
    ledger,
    warnings: warnings.items,
  };
}
