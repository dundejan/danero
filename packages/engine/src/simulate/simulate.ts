import {
  SellTxSchema,
  type AssetClass,
  type Decimal,
  type IsoDate,
  type Money,
} from '@danero/shared';
import type { DisposalReport } from '../basis/securities';
import type { FxMethod, MatchingMethod } from '../config/options';
import { analyzeTaxYear, type EngineInput, type TaxYearResult } from '../engine';

const SIMULATED_SELL_ID = '__simulated-sale__';

const recommendedTax = (result: TaxYearResult): Money =>
  result.tax.recommended === 'GENERAL' ? result.tax.general.taxCzk : result.tax.separate16a.taxCzk;

export interface TaxSnapshot {
  taxCzk: Money;
  base10Czk: Money;
  base8Czk: Money;
  limit100kUsedCzk: Money;
  exemptUnder100k: boolean;
  /** R-10a: samostatný pool 100k pro kryptoaktiva. */
  cryptoLimit100kUsedCzk: Money;
  cryptoExemptUnder100k: boolean;
  flatTax50kUsedCzk: Money;
  flatTax50kExceeded: boolean;
}

const snapshot = (result: TaxYearResult): TaxSnapshot => ({
  taxCzk: recommendedTax(result),
  // R-10c/R-12l: dílčí základ § 10 = CP + krypto + deriváty (každý druh už max(0, ·))
  base10Czk: result.securities.base10Czk
    .plus(result.crypto.base10Czk)
    .plus(result.derivatives.base10Czk),
  base8Czk: result.dividends.base8Czk,
  limit100kUsedCzk: result.securities.pool100kCzk,
  exemptUnder100k: result.securities.exemptUnder100k,
  cryptoLimit100kUsedCzk: result.crypto.pool100kCzk,
  cryptoExemptUnder100k: result.crypto.exemptUnder100k,
  flatTax50kUsedCzk: result.limits.flatTax50k.status.usedCzk,
  flatTax50kExceeded: result.limits.flatTax50k.status.exceeded,
});

export interface SaleSimulationRequest {
  isin: string;
  quantity: Decimal.Value;
  pricePerShare: Decimal.Value;
  currency: string;
  date: IsoDate;
  assetClass?: AssetClass;
}

export interface SaleSimulationResult {
  baseline: TaxSnapshot;
  simulated: TaxSnapshot;
  /** Rozpad simulovaného prodeje: osvobozená vs. zdanitelná část (R-01/R-02). */
  simulatedDisposal: DisposalReport | undefined;
  deltas: {
    taxCzk: Money;
    flatTax50kUsedCzk: Money;
    limit100kUsedCzk: Money;
    cryptoLimit100kUsedCzk: Money;
  };
}

/** „Co když teď prodám X?“ — dopad zamýšleného prodeje na limity a daň ještě před obchodem. */
export function simulateSale(
  input: EngineInput,
  sale: SaleSimulationRequest,
): SaleSimulationResult {
  const baselineResult = analyzeTaxYear(input);
  const sellTx = SellTxSchema.parse({
    type: 'SELL',
    id: SIMULATED_SELL_ID,
    isin: sale.isin,
    assetClass: sale.assetClass ?? 'STOCK',
    quantity: sale.quantity,
    pricePerShare: sale.pricePerShare,
    currency: sale.currency,
    tradeDate: sale.date,
    settlementDate: sale.date,
  });
  const simulatedResult = analyzeTaxYear({
    ...input,
    transactions: [...input.transactions, sellTx],
  });

  const baseline = snapshot(baselineResult);
  const simulated = snapshot(simulatedResult);
  return {
    baseline,
    simulated,
    simulatedDisposal: [
      ...simulatedResult.securities.disposals,
      ...simulatedResult.crypto.disposals,
    ].find((report) => report.sellTxId === SIMULATED_SELL_ID),
    deltas: {
      taxCzk: simulated.taxCzk.sub(baseline.taxCzk),
      flatTax50kUsedCzk: simulated.flatTax50kUsedCzk.sub(baseline.flatTax50kUsedCzk),
      limit100kUsedCzk: simulated.limit100kUsedCzk.sub(baseline.limit100kUsedCzk),
      cryptoLimit100kUsedCzk: simulated.cryptoLimit100kUsedCzk.sub(
        baseline.cryptoLimit100kUsedCzk,
      ),
    },
  };
}

export interface VariantResult {
  matchingMethod: MatchingMethod;
  fxMethod: FxMethod;
  taxCzk: Money;
  base10Czk: Money;
  base8Czk: Money;
  exemptUnder100k: boolean;
  flatTax50kUsedCzk: Money;
  flatTax50kExceeded: boolean;
}

export interface VariantComparison {
  variants: VariantResult[];
  recommended: VariantResult;
}

/**
 * Porovnání variant výpočtu (metoda párování × metoda kurzu, R-05c × R-06).
 * U paušálního režimu má přednost varianta, která neprolomí limit 50k, pak nejnižší daň.
 */
export function compareVariants(
  input: EngineInput,
  scan?: { methods?: MatchingMethod[]; fxMethods?: FxMethod[] },
): VariantComparison {
  const methods: MatchingMethod[] = scan?.methods ?? ['FIFO', 'LIFO', 'MAX_PROFIT', 'MAX_LOSS'];
  const fxMethods: FxMethod[] =
    scan?.fxMethods ?? (input.dailyRates ? ['UNIFIED', 'CNB_DAILY'] : ['UNIFIED']);

  const variants: VariantResult[] = [];
  for (const matchingMethod of methods) {
    for (const fxMethod of fxMethods) {
      const result = analyzeTaxYear({
        ...input,
        options: { ...input.options, matchingMethod, fxMethod },
      });
      variants.push({
        matchingMethod,
        fxMethod,
        taxCzk: recommendedTax(result),
        base10Czk: result.securities.base10Czk
          .plus(result.crypto.base10Czk)
          .plus(result.derivatives.base10Czk),
        base8Czk: result.dividends.base8Czk,
        exemptUnder100k: result.securities.exemptUnder100k,
        flatTax50kUsedCzk: result.limits.flatTax50k.status.usedCzk,
        flatTax50kExceeded: result.limits.flatTax50k.status.exceeded,
      });
    }
  }

  const flatTaxMatters = input.profile.regime === 'PAUSAL';
  const recommended = [...variants].sort((a, b) => {
    if (flatTaxMatters && a.flatTax50kExceeded !== b.flatTax50kExceeded) {
      return a.flatTax50kExceeded ? 1 : -1;
    }
    return a.taxCzk.cmp(b.taxCzk);
  })[0]!;

  return { variants, recommended };
}
