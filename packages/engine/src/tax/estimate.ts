import { d, Decimal, roundBaseDownTo100, ZERO, type Money } from '@danero/shared';
import type { TaxYearConfig } from '../config/taxYear';
import type { DividendsResult } from '../basis/dividends';
import type { SecuritiesResult } from '../basis/securities';
import { WarningCollector } from '../warnings';

export interface TaxVariant {
  /** Obecný základ (zaokrouhlení na stovky dolů se aplikuje až při výpočtu daně). */
  baseCzk: Money;
  taxBeforeCreditCzk: Money;
  foreignTaxCreditCzk: Money;
  taxCzk: Money;
}

export interface TaxEstimate {
  /** Varianta A: zahraniční příjmy § 8 v obecném základu (15/23 %). */
  general: TaxVariant;
  /** Varianta B (R-07d, § 16a): zahraniční dividendy a úroky v samostatném základu 15 %. */
  separate16a: TaxVariant & { separateBaseCzk: Money; separateTaxCzk: Money };
  recommended: 'GENERAL' | 'SEPARATE_16A';
  note: string;
}

const RATE_BASE = '0.15';
const RATE_HIGHER = '0.23';

function progressiveTax(base: Money, threshold: Money | null): Money {
  const rounded = roundBaseDownTo100(base);
  if (rounded.lte(0)) return ZERO;
  if (threshold === null || rounded.lte(threshold)) return rounded.mul(RATE_BASE);
  return threshold.mul(RATE_BASE).plus(rounded.sub(threshold).mul(RATE_HIGHER));
}

/** R-07c: prostý zápočet po státech — strop podílem příjmu státu na základu daně. */
function allocateCredit(tax: Money, base: Money, dividends: DividendsResult): Money {
  if (base.lte(0) || tax.lte(0)) return ZERO;
  let credit = ZERO;
  for (const { grossCzk, creditableCzk } of Object.values(dividends.creditableByCountry)) {
    const maxCredit = tax.mul(grossCzk.div(base));
    credit = credit.plus(Decimal.min(creditableCzk, maxCredit));
  }
  return Decimal.min(credit, tax);
}

/**
 * Orientační daň z investičních příjmů (§ 8 + § 10) ve dvou variantách.
 * Skutečná progrese závisí na celkovém základu vč. § 7 — viz `note`.
 */
export function estimateTax(
  securities: SecuritiesResult,
  crypto: SecuritiesResult,
  dividends: DividendsResult,
  config: TaxYearConfig,
  warnings: WarningCollector,
): TaxEstimate {
  const threshold = config.progressiveThreshold === null ? null : d(config.progressiveThreshold);
  if (threshold === null) {
    warnings.add(
      'PROGRESSIVE_THRESHOLD_UNKNOWN',
      'WARNING',
      `Hranice 23% sazby pro rok ${config.year} není v konfiguraci — orientační daň počítám celou 15% sazbou.`,
    );
  }

  // R-05d/R-10c: dílčí základ § 10 = max(0, CP) + max(0, krypto) — druhy se
  // NEkompenzují, každý base10Czk už je nezáporný per druh
  const base10 = securities.base10Czk.plus(crypto.base10Czk);

  // Varianta A: vše v obecném základu
  const baseA = base10.plus(dividends.base8Czk);
  const taxA = progressiveTax(baseA, threshold);
  const creditA = allocateCredit(taxA, baseA, dividends);

  // Varianta B: § 16a — jen zahraniční dividendy/úroky (§ 8) v samostatném
  // základu 15 %; kryptoaktiv se § 16a netýká (R-10)
  const baseB = base10;
  const separateBase = dividends.base8Czk;
  const taxB = progressiveTax(baseB, threshold);
  const separateTax = roundBaseDownTo100(separateBase).mul(RATE_BASE);
  const creditB = allocateCredit(separateTax, separateBase, dividends);

  const general: TaxVariant = {
    baseCzk: baseA,
    taxBeforeCreditCzk: taxA,
    foreignTaxCreditCzk: creditA,
    taxCzk: taxA.sub(creditA),
  };
  const separate16a = {
    baseCzk: baseB,
    separateBaseCzk: separateBase,
    separateTaxCzk: separateTax,
    taxBeforeCreditCzk: taxB.plus(separateTax),
    foreignTaxCreditCzk: creditB,
    taxCzk: taxB.plus(separateTax).sub(creditB),
  };

  return {
    general,
    separate16a,
    recommended: separate16a.taxCzk.lt(general.taxCzk) ? 'SEPARATE_16A' : 'GENERAL',
    note: 'Orientační výpočet pouze z investičních příjmů — skutečná progrese (23 %) závisí na celkovém základu daně včetně § 7.',
  };
}
