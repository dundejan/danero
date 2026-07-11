import type { Money } from '@danero/shared';

/**
 * Verdikt simulátoru prodeje jako čistá funkce (testovatelná bez JSX).
 *
 * Panelové testování odhalilo lhaní verdiktu: prodej osvobozený časovým
 * testem může prolomit úhrn 100 000 Kč (při striktním výkladu R-02c do něj
 * vstupují i osvobozené tržby) a tím ZPĚTNĚ zdanit dřívější letošní prodeje.
 * „Celý osvobozený — limity ani daň nečerpá" proto platí JEN když se nezvýší
 * daň ani čerpání žádného limitu.
 */

/** Strukturální podmnožina SaleSimulationResult z enginu — jen co verdikt potřebuje. */
export interface VerdictInput {
  baseline: {
    exemptUnder100k: boolean;
    cryptoExemptUnder100k: boolean;
    flatTax50kExceeded: boolean;
  };
  simulated: {
    exemptUnder100k: boolean;
    cryptoExemptUnder100k: boolean;
    flatTax50kExceeded: boolean;
  };
  deltas: {
    taxCzk: Money;
    flatTax50kUsedCzk: Money;
    limit100kUsedCzk: Money;
    cryptoLimit100kUsedCzk: Money;
  };
  simulatedDisposal: { taxableProceedsCzk: Money } | undefined;
}

export type SimulatorVerdict =
  /** Celý osvobozený, daň se nezvýší a žádný limit se nezhorší. */
  | { kind: 'EXEMPT_CLEAN' }
  /** Osvobozený testem, ale prolomí úhrn 100k (CP/krypto) → knock-on na dřívější prodeje. */
  | { kind: 'EXEMPT_BREAKS_100K'; crypto: boolean; taxDeltaCzk: Money }
  /** Osvobozený, nic neprolomí, ale zhorší čerpání limitu (příp. i daň). */
  | { kind: 'EXEMPT_DRAWS_LIMIT'; crypto: boolean; taxDeltaCzk: Money }
  /** Zdanitelný prodej, který nově prolomí limit 50k paušální daně. */
  | { kind: 'BREAKS_50K' }
  | { kind: 'TAXABLE' };

export function simulatorVerdict(simulation: VerdictInput): SimulatorVerdict {
  const { baseline, simulated, deltas, simulatedDisposal } = simulation;
  const fullyExempt =
    simulatedDisposal !== undefined && simulatedDisposal.taxableProceedsCzk.lte(0);

  if (fullyExempt) {
    // prolomení úhrnu 100k: před prodejem osvobozeno úhrnem, po prodeji už ne
    const breaksSecurities = baseline.exemptUnder100k && !simulated.exemptUnder100k;
    const breaksCrypto = baseline.cryptoExemptUnder100k && !simulated.cryptoExemptUnder100k;
    if (breaksSecurities || breaksCrypto) {
      return {
        kind: 'EXEMPT_BREAKS_100K',
        crypto: breaksCrypto && !breaksSecurities,
        taxDeltaCzk: deltas.taxCzk,
      };
    }
    // zhoršení bez prolomení: vyšší daň, nebo vyšší čerpání některého limitu
    const drawsSecurities = deltas.limit100kUsedCzk.gt(0);
    const drawsCrypto = deltas.cryptoLimit100kUsedCzk.gt(0);
    if (deltas.taxCzk.gt(0) || drawsSecurities || drawsCrypto || deltas.flatTax50kUsedCzk.gt(0)) {
      return {
        kind: 'EXEMPT_DRAWS_LIMIT',
        crypto: drawsCrypto && !drawsSecurities,
        taxDeltaCzk: deltas.taxCzk,
      };
    }
    return { kind: 'EXEMPT_CLEAN' };
  }

  if (simulated.flatTax50kExceeded && !baseline.flatTax50kExceeded) {
    return { kind: 'BREAKS_50K' };
  }
  return { kind: 'TAXABLE' };
}
