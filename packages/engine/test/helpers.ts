import {
  TaxpayerProfileSchema,
  TransactionSchema,
  type TaxpayerProfile,
  type Transaction,
} from '@danero/shared';
import type { EngineOptions } from '../src/config/options';
import type { TaxYearConfig } from '../src/config/taxYear';
import { analyzeTaxYear, type DailyRateProvider, type TaxYearResult } from '../src';

/** Testovací konfigurace s FIXTURE kurzy (kulaté hodnoty pro čitelné výpočty, NE skutečné). */
export const CFG_2025: TaxYearConfig = {
  year: 2025,
  unifiedRatesByYear: {
    2019: { USD: '23', EUR: '25' },
    2020: { USD: '23', EUR: '26' },
    2021: { USD: '22', EUR: '25' },
    2022: { USD: '23', EUR: '25' },
    2023: { USD: '22', EUR: '24' },
    2024: { USD: '23', EUR: '25' },
    2025: { USD: '20', EUR: '25', GBP: '30' },
  },
  limits: {
    securitiesProceedsExemption: '100000',
    cryptoProceedsExemption: '100000',
    flatTaxOtherIncome: '50000',
    employeeSideIncome: '20000',
    generalFiling: '50000',
    exemptIncomeReporting: '5000000',
    // R-10d: v ZO 2025 společný strop 40M pro CP i krypto
    timeTestCap: { amountCzk: '40000000', appliesTo: ['SECURITIES', 'CRYPTO'] },
  },
  // R-10b: krypto osvobození v ZO 2025 jen pro příjmy od 15. 2. 2025
  cryptoRules: { exemptionsAvailable: true, effectiveFrom: '2025-02-15' },
  progressiveThreshold: '1676052',
  // R-08f: paušální záloha 1. pásma 2025 (daňová složka 100 Kč/měsíc)
  flatTaxAdvance: { monthlyTotalCzk: '8716', monthlyTaxCzk: '100' },
};

let seq = 0;
const nextId = (prefix: string): string => `${prefix}-${(seq += 1)}`;

type Overrides = Record<string, unknown>;

/**
 * Vypořádání se defaultně rovná dni obchodu — test, který přepíše jen
 * `tradeDate`, tak nezdědí vypořádání z jiného roku. Dopočet vypořádání
 * (R-01a) se testuje adresně přes `inferSettlementDate` a scénáře, které
 * `settlementDate` schválně vynechají.
 */
const trade = (type: 'BUY' | 'SELL', defaults: Overrides, over: Overrides): Transaction => {
  const tradeDate = over.tradeDate ?? defaults.tradeDate;
  return TransactionSchema.parse({ type, ...defaults, tradeDate, settlementDate: tradeDate, ...over });
};

export const buy = (over: Overrides = {}): Transaction =>
  trade(
    'BUY',
    {
      id: nextId('buy'),
      isin: 'CZ0000000001',
      quantity: '100',
      pricePerShare: '1000',
      currency: 'CZK',
      tradeDate: '2024-01-10',
    },
    over,
  );

export const sell = (over: Overrides = {}): Transaction =>
  trade(
    'SELL',
    {
      id: nextId('sell'),
      isin: 'CZ0000000001',
      quantity: '100',
      pricePerShare: '1200',
      currency: 'CZK',
      tradeDate: '2025-03-05',
    },
    over,
  );

export const dividend = (over: Overrides = {}): Transaction =>
  TransactionSchema.parse({
    type: 'DIVIDEND',
    id: nextId('div'),
    sourceCountry: 'US',
    gross: '1000',
    currency: 'CZK',
    withholdingTax: '0',
    date: '2025-04-01',
    ...over,
  });

export const interest = (over: Overrides = {}): Transaction =>
  TransactionSchema.parse({
    type: 'INTEREST',
    id: nextId('int'),
    amount: '1000',
    currency: 'CZK',
    sourceCountry: 'GB',
    date: '2025-05-01',
    ...over,
  });

export const corpAction = (over: Overrides = {}): Transaction =>
  TransactionSchema.parse({
    type: 'CORPORATE_ACTION',
    id: nextId('ca'),
    subtype: 'SPLIT',
    isin: 'CZ0000000001',
    date: '2024-06-01',
    ...over,
  });

export const profile = (over: Overrides = {}): TaxpayerProfile =>
  TaxpayerProfileSchema.parse({ regime: 'PAUSAL', ...over });

export interface RunOpts {
  profile?: Overrides;
  options?: Partial<EngineOptions>;
  config?: TaxYearConfig;
  dailyRates?: DailyRateProvider;
}

export const run = (transactions: Transaction[], opts: RunOpts = {}): TaxYearResult =>
  analyzeTaxYear({
    transactions,
    profile: profile(opts.profile),
    config: opts.config ?? CFG_2025,
    options: opts.options,
    dailyRates: opts.dailyRates,
  });

export const hasWarning = (result: TaxYearResult, code: string): boolean =>
  result.warnings.some((w) => w.code === code);
