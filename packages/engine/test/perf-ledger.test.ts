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

  /**
   * Měří se **procesorový** čas, ne hodinový: na vytíženém stroji (v auditu
   * běželo souběžně pět agentů) hodinový čas počítá i dobu, kdy proces vůbec
   * neběžel, a poměr pak náhodně vyskočí. `process.cpuUsage()` odstavení
   * neúčtuje. Z pěti běhů se bere nejnižší hodnota.
   */
  const nejnizsiCpuMs = (pairs: number): number => {
    const txs = dayTrader(pairs);
    let nej = Infinity;
    for (let i = 0; i < 5; i += 1) {
      const t0 = process.cpuUsage();
      analyzeTaxYear({ transactions: txs, profile: profile(), config: CFG_2025 });
      const { user, system } = process.cpuUsage(t0);
      nej = Math.min(nej, (user + system) / 1000);
    }
    return Math.max(nej, 0.5); // dolní mez proti dělení nulou u velmi rychlých strojů
  };

  it('osminásobek obchodů nesmí zabrat čtyřiašedesátinásobek času', { timeout: 60_000 }, () => {
    // OSMINÁSOBEK dat, ne dvojnásobek: lineární průchod z toho udělá ~8×,
    // kvadratický ~64×. Takový odstup nerozhodí ani rozehřívání JITu, ani
    // vytížený stroj — u dvojnásobku (2× vs. 4×) se měření o šum opíralo
    // a test náhodně padal.
    nejnizsiCpuMs(200); // rozehřátí JITu
    const maly = nejnizsiCpuMs(500);
    const velky = nejnizsiCpuMs(4000);
    const pomer = velky / maly;
    expect(
      pomer,
      `osminásobek dat zabral ${pomer.toFixed(1)}× procesorového času (${maly.toFixed(1)} → ${velky.toFixed(1)} ms). ` +
        'Kvadratický průchod dává ~64×, lineární ~8×. Vrátil se filter přes všechny loty?',
    ).toBeLessThan(20);
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

/**
 * Druhá polovina téhož problému: sestavení ledgeru sice není kvadratické
 * v počtu transakcí (G-P1), ale `orderLots` se volalo při KAŽDÉM prodeji.
 * U FIFO/LIFO je pole prakticky seřazené a TimSort ho projde lineárně,
 * u MAX_PROFIT/MAX_LOSS se řadí podle nabývací ceny, tedy nanovo a celé.
 * Naměřeno před opravou (25 000 transakcí, 20 instrumentů, velká zásoba
 * otevřených lotů): FIFO 1,3 s × MAX_PROFIT 9,3 s. Po opravě 0,6 × 0,7 s.
 *
 * Test měří POMĚR, ne absolutní čas — ten je na každém stroji jiný. Práh 3×
 * leží mezi oběma stavy s velkou rezervou na obě strany.
 */
describe('výkon: výběr lotů se nepřeřazuje při každém prodeji', () => {
  /** Držák: nejdřív všechny nákupy, pak prodeje — největší zásoba otevřených lotů. */
  const holder = (pairs: number) => {
    const txs = [];
    for (let i = 0; i < pairs; i += 1) {
      const den = `2024-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`;
      // ceny schválně rozházené, ať MAX_PROFIT nedostane seřazený vstup
      txs.push(
        buy({
          quantity: '10',
          pricePerShare: String(100 + ((i * 37) % 500)),
          tradeDate: den,
          settlementDate: den,
        }),
      );
    }
    for (let i = 0; i < pairs; i += 1) {
      const den = `2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`;
      txs.push(sell({ quantity: '10', pricePerShare: '600', tradeDate: den, settlementDate: den }));
    }
    return txs;
  };

  const cpuMs = (method: 'FIFO' | 'MAX_PROFIT', txs: ReturnType<typeof holder>): number => {
    let nej = Infinity;
    for (let i = 0; i < 3; i += 1) {
      const t0 = process.cpuUsage();
      analyzeTaxYear({
        transactions: txs,
        profile: profile(),
        config: CFG_2025,
        options: { matchingMethod: method },
      });
      const { user, system } = process.cpuUsage(t0);
      nej = Math.min(nej, (user + system) / 1000);
    }
    return Math.max(nej, 0.5);
  };

  it('MAX_PROFIT nesmí být nad velkou zásobou lotů řádově dražší než FIFO', { timeout: 60_000 }, () => {
    const txs = holder(1500);
    cpuMs('FIFO', txs.slice(0, 100)); // rozehřátí JITu
    const fifo = cpuMs('FIFO', txs);
    const maxProfit = cpuMs('MAX_PROFIT', txs);
    const pomer = maxProfit / fifo;
    expect(
      pomer,
      `MAX_PROFIT zabral ${pomer.toFixed(1)}× procesorového času proti FIFO (${fifo.toFixed(0)} → ${maxProfit.toFixed(0)} ms). ` +
        'Řadí se kandidáti při každém prodeji znovu? Zásoba se má přeřazovat jen při změně (viz orderedByIsin).',
    ).toBeLessThan(3);
  });
});
