import { describe, expect, it } from 'vitest';
import { d, ZERO, type Money } from '@danero/shared';
import { simulateSale } from '@danero/engine';
import { demoDataset, demoToday } from '@/lib/demo-data';
import { engineInputForUser } from '@/lib/portfolio';
import { simulatorVerdict, type VerdictInput } from '@/lib/simulator-verdict';

/**
 * Verdikt simulátoru (nález z panelového testování): prodej osvobozený
 * časovým testem, který prolomí úhrn 100k, NESMÍ hlásit „limity ani daň
 * nečerpá" — zpětně zdaňuje dřívější letošní prodeje.
 */

/** Stavebnice vstupu verdiktu — výchozí stav „nic se neděje". */
function input(over: {
  taxable?: Money;
  taxDelta?: Money;
  limit100kDelta?: Money;
  cryptoDelta?: Money;
  baselineExempt?: boolean;
  simulatedExempt?: boolean;
  baselineCryptoExempt?: boolean;
  simulatedCryptoExempt?: boolean;
  baseline50k?: boolean;
  simulated50k?: boolean;
  noDisposal?: boolean;
}): VerdictInput {
  return {
    baseline: {
      exemptUnder100k: over.baselineExempt ?? true,
      cryptoExemptUnder100k: over.baselineCryptoExempt ?? true,
      flatTax50kExceeded: over.baseline50k ?? false,
    },
    simulated: {
      exemptUnder100k: over.simulatedExempt ?? over.baselineExempt ?? true,
      cryptoExemptUnder100k: over.simulatedCryptoExempt ?? over.baselineCryptoExempt ?? true,
      flatTax50kExceeded: over.simulated50k ?? over.baseline50k ?? false,
    },
    deltas: {
      taxCzk: over.taxDelta ?? ZERO,
      flatTax50kUsedCzk: ZERO,
      limit100kUsedCzk: over.limit100kDelta ?? ZERO,
      cryptoLimit100kUsedCzk: over.cryptoDelta ?? ZERO,
    },
    simulatedDisposal: over.noDisposal ? undefined : { taxableProceedsCzk: over.taxable ?? ZERO },
  };
}

describe('simulatorVerdict — čistá logika verdiktu', () => {
  it('celý osvobozený bez zhoršení → EXEMPT_CLEAN', () => {
    expect(simulatorVerdict(input({}))).toEqual({ kind: 'EXEMPT_CLEAN' });
  });

  it('osvobozený, ale prolomí úhrn 100k → EXEMPT_BREAKS_100K s delta daní (knock-on)', () => {
    const verdict = simulatorVerdict(
      input({
        baselineExempt: true,
        simulatedExempt: false,
        limit100kDelta: d('17000'),
        taxDelta: d('473'),
      }),
    );
    expect(verdict.kind).toBe('EXEMPT_BREAKS_100K');
    if (verdict.kind === 'EXEMPT_BREAKS_100K') {
      expect(verdict.crypto).toBe(false);
      expect(verdict.taxDeltaCzk.toString()).toBe('473');
    }
  });

  it('osvobozený, prolomí krypto úhrn → EXEMPT_BREAKS_100K s crypto=true', () => {
    const verdict = simulatorVerdict(
      input({ baselineCryptoExempt: true, simulatedCryptoExempt: false, cryptoDelta: d('60000') }),
    );
    expect(verdict).toMatchObject({ kind: 'EXEMPT_BREAKS_100K', crypto: true });
  });

  it('osvobozený, čerpá limit bez prolomení → EXEMPT_DRAWS_LIMIT (zhoršení bez prolomení)', () => {
    const verdict = simulatorVerdict(input({ limit100kDelta: d('5000') }));
    expect(verdict).toMatchObject({ kind: 'EXEMPT_DRAWS_LIMIT', crypto: false });
  });

  it('osvobozený se zvýšením daně (bez nového prolomení) → EXEMPT_DRAWS_LIMIT', () => {
    const verdict = simulatorVerdict(
      input({ baselineExempt: false, simulatedExempt: false, taxDelta: d('120') }),
    );
    expect(verdict.kind).toBe('EXEMPT_DRAWS_LIMIT');
  });

  it('zdanitelný prodej, který nově prolomí 50k → BREAKS_50K; jinak TAXABLE', () => {
    expect(
      simulatorVerdict(input({ taxable: d('30000'), baseline50k: false, simulated50k: true })).kind,
    ).toBe('BREAKS_50K');
    expect(
      simulatorVerdict(input({ taxable: d('30000'), baseline50k: true, simulated50k: true })).kind,
    ).toBe('TAXABLE');
  });
});

describe('regresní scénář z panelu: demo VWCE 5 ks @ 140 EUR', () => {
  // Y0 v demu: prodeje CP ~91k (osvobozeno úhrnem), VWCE lot splňuje časový
  // test — prodej za ~17k prolomí úhrn a zpětně zdaní letošní prodej AAPL.
  it('verdikt je EXEMPT_BREAKS_100K s kladnou delta daní', { timeout: 30_000 }, () => {
    const today = demoToday(new Date('2026-07-10T10:00:00Z'));
    const { txs, profile } = demoDataset(today);
    const simulation = simulateSale(engineInputForUser(txs, profile, Number(today.slice(0, 4))), {
      isin: 'IE00BK5BQT80',
      quantity: '5',
      pricePerShare: '140',
      currency: 'EUR',
      date: today,
      assetClass: 'ETF',
    });
    expect(simulation.simulatedDisposal?.taxableProceedsCzk.lte(0)).toBe(true); // sám o sobě osvobozený
    expect(simulation.simulated.exemptUnder100k).toBe(false); // ale prolomil úhrn

    const verdict = simulatorVerdict(simulation);
    expect(verdict.kind).toBe('EXEMPT_BREAKS_100K');
    if (verdict.kind === 'EXEMPT_BREAKS_100K') {
      expect(verdict.taxDeltaCzk.gt(0)).toBe(true); // knock-on: daň se zpětně zvýší
    }
  });
});
