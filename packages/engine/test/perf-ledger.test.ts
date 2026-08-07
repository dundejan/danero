import { describe, expect, it } from 'vitest';
import { analyzeTaxYear } from '../src';
import { CFG_2025, buy, profile, sell } from './helpers';

/**
 * G-P1: sestavení ledgeru bylo O(n²) — `openLots()` procházel při KAŽDÉM
 * prodeji všechny dosavadní loty. U day-tradera s 50 000 transakcemi to dělalo
 * ~472 milionů porovnání a 28 s CPU jen za jeden rok, takže `/report` skončil
 * timeoutem funkce.
 *
 * Test schválně neměří absolutní čas — ten závisí na stroji a na CI je jiný.
 * Měří **poměr** času při zdvojnásobení dat: kvadratický průchod dává ~4×,
 * lineární ~2×. Z každé velikosti se bere nejrychlejší ze tří běhů, aby výkyv
 * vytíženého stroje nerozhodoval; práh 2,8 hlídá řádovou regresi, ne konstantu.
 */
describe('výkon: sestavení ledgeru neroste kvadraticky (G-P1)', () => {
  /** Day-trader: jeden instrument, střídavě nákup a prodej — nejhorší případ. */
  const dayTrader = (pairs: number) => {
    const txs = [];
    for (let i = 0; i < pairs; i += 1) {
      const den = `2025-06-${String(1 + (i % 28)).padStart(2, '0')}`;
      txs.push(buy({ quantity: '10', pricePerShare: '100', tradeDate: den, settlementDate: den }));
      txs.push(sell({ quantity: '10', pricePerShare: '101', tradeDate: den, settlementDate: den }));
    }
    return txs;
  };

  const nejrychlejsiZeTri = (pairs: number): number => {
    const txs = dayTrader(pairs);
    let nej = Infinity;
    for (let i = 0; i < 3; i += 1) {
      const t0 = process.hrtime.bigint();
      analyzeTaxYear({ transactions: txs, profile: profile(), config: CFG_2025 });
      nej = Math.min(nej, Number(process.hrtime.bigint() - t0) / 1e6);
    }
    return Math.max(nej, 0.5); // dolní mez proti dělení nulou u velmi rychlých strojů
  };

  it('dvojnásobek obchodů nesmí zabrat čtyřnásobek času', { timeout: 60_000 }, () => {
    nejrychlejsiZeTri(200); // rozehřátí JITu
    const maly = nejrychlejsiZeTri(1000);
    const velky = nejrychlejsiZeTri(2000);
    const pomer = velky / maly;
    expect(
      pomer,
      `dvojnásobek dat zabral ${pomer.toFixed(2)}× času (${maly.toFixed(1)} → ${velky.toFixed(1)} ms). ` +
        'Kvadratický průchod dává ~4×, lineární ~2×. Vrátil se filter přes všechny loty?',
    ).toBeLessThan(2.8);
  });

  it('vyčerpaný lot z indexu vypadne, ale ze seznamu lotů ne', () => {
    // Index se kvůli výkonu čistí; výstupní `ledger.lots` musí zůstat úplný,
    // protože z něj UI staví historii pozic.
    const result = analyzeTaxYear({
      transactions: dayTrader(5),
      profile: profile(),
      config: CFG_2025,
    });
    expect(result.ledger.lots).toHaveLength(5);
    expect(result.ledger.lots.every((lot) => lot.remaining.isZero())).toBe(true);
    expect(result.ledger.disposals).toHaveLength(5);
  });
});
