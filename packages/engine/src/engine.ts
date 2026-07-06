import {
  yearOf,
  type DividendTransaction,
  type InterestTransaction,
  type TaxpayerProfile,
  type Transaction,
} from '@danero/shared';
import { computeDividends, type DividendsResult } from './basis/dividends';
import { computeSecurities, type SecuritiesResult } from './basis/securities';
import { resolveOptions, type EngineOptions } from './config/options';
import type { TaxYearConfig } from './config/taxYear';
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
  dividends: DividendsResult;
  limits: LimitsResult;
  tax: TaxEstimate;
  /** Otevřené pozice k 31. 12. cílového roku (hlídač volá positionsAt s dneškem). */
  positions: Position[];
  ledger: Ledger;
  warnings: EngineWarning[];
}

/**
 * Čistá funkce (transakce, konfigurace) → výsledek. Žádné I/O, deterministická —
 * každý přepočet je plně reprodukovatelný od nuly (docs/04, klíčový invariant).
 */
export function analyzeTaxYear(input: EngineInput): TaxYearResult {
  const options = resolveOptions(input.options);
  const warnings = new WarningCollector();
  const fx = new FxConverter(input.config, options.fxMethod, warnings, input.dailyRates);
  const year = input.config.year;

  const ledger = buildLedger(input.transactions, options, warnings);
  classifyTimeTest(ledger.disposals, input.profile);

  const cryptoCount = ledger.disposals.filter(
    (disposal) => disposal.assetClass === 'CRYPTO' && disposal.incomeYear === year,
  ).length;
  if (cryptoCount > 0) {
    warnings.add(
      'CRYPTO_NOT_SUPPORTED',
      'WARNING',
      `${cryptoCount} prodej(ů) kryptoaktiv vynechán(o) — krypto má vlastní limity a je jiný druh příjmu § 10 (R-10, post-MVP).`,
      { count: cryptoCount },
    );
  }

  const securitiesDisposals = ledger.disposals.filter(
    (disposal) => disposal.assetClass !== 'CRYPTO' && disposal.incomeYear === year,
  );
  const securities = computeSecurities(securitiesDisposals, fx, input.config, options, warnings);

  const dividendTxs = input.transactions.filter(
    (tx): tx is DividendTransaction => tx.type === 'DIVIDEND' && yearOf(tx.date) === year,
  );
  const interestTxs = input.transactions.filter(
    (tx): tx is InterestTransaction => tx.type === 'INTEREST' && yearOf(tx.date) === year,
  );
  const dividends = computeDividends(dividendTxs, interestTxs, fx, options, warnings);

  const limits = computeLimits(
    securities,
    dividends,
    input.profile,
    input.config,
    warnings,
    options.limit100kIncludesTimeTestExempt,
  );
  const tax = estimateTax(securities, dividends, input.config, warnings);
  const positions = positionsAt(ledger, `${year}-12-31`);

  return {
    year,
    options,
    securities,
    dividends,
    limits,
    tax,
    positions,
    ledger,
    warnings: warnings.items,
  };
}
