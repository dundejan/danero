import { describe, expect, it } from 'vitest';
import { TaxpayerProfileSchema } from '@danero/shared';
import { analyzeTaxYear, type TaxYearConfig } from '@danero/engine';
import { parseTrading212Csv } from '../src';
import { T212_FIXTURE as FIXTURE } from './fixtures/t212';

/** Testovací kurzy (kulaté, NE skutečné) — stejné jako engine fixtures. */
const CFG: TaxYearConfig = {
  year: 2025,
  unifiedRatesByYear: {
    2024: { USD: '23' },
    2025: { USD: '20' },
  },
  limits: {
    securitiesProceedsExemption: '100000',
    cryptoProceedsExemption: '100000',
    flatTaxOtherIncome: '50000',
    employeeSideIncome: '20000',
    generalFiling: '50000',
    exemptIncomeReporting: '5000000',
    timeTestCap: { amountCzk: '40000000', appliesTo: ['SECURITIES', 'CRYPTO'] },
  },
  cryptoRules: { exemptionsAvailable: true, effectiveFrom: '2025-02-15' },
  progressiveThreshold: '1676052',
};

describe('e2e: T212 CSV → kanonický model → daňový engine', () => {
  it('kompletní řetězec dá konzistentní rok 2025 (vč. dopočtu vypořádání)', () => {
    const imported = parseTrading212Csv(FIXTURE);
    expect(imported.errors).toEqual([]);

    const result = analyzeTaxYear({
      transactions: imported.transactions,
      profile: TaxpayerProfileSchema.parse({ regime: 'PAUSAL' }),
      config: CFG,
    });

    // nákup 100 × 185.50 USD (2024, kurz 23) = 426 650 + poplatky 2.10 + 3.00 CZK
    // prodej 100 × 210 USD (2025, kurz 20) = 420 000 → celková ztráta → základ 0
    expect(result.securities.totalGrossProceedsCzk.toString()).toBe('420000');
    expect(result.securities.rawGainLossCzk.toString()).toBe('-6655.1');
    expect(result.securities.base10Czk.toString()).toBe('0');
    expect(result.warnings.some((w) => w.code === 'LOSS_NOT_DEDUCTIBLE')).toBe(true);

    // dividenda 25 USD brutto → 500 Kč; srážka 3.75 USD → 75 Kč, plně započitatelná
    expect(result.dividends.foreignGrossCzk.toString()).toBe('500');
    expect(result.dividends.creditableWithholdingCzk.toString()).toBe('75');
    // § 8 = dividendy 500 + úroky 12.34
    expect(result.dividends.base8Czk.toString()).toBe('512.34');

    // hlídač 50k: tržba 420 000 (přes 100k, bez časového testu) + 500 + 12.34
    expect(result.limits.flatTax50k.status.usedCzk.toString()).toBe('420512.34');
    expect(result.limits.flatTax50k.status.exceeded).toBe(true);

    // vypořádání dopočteno: nákup T+2 (leden 2024), prodej T+1 (US, březen 2025)
    const disposal = result.ledger.disposals[0]!;
    expect(disposal.settlementDate).toBe('2025-03-06');
    expect(disposal.allocations[0]!.expenseDate).toBe('2024-01-12');
  });
});
