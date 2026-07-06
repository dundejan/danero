import { describe, expect, it } from 'vitest';
import { compareVariants, simulateSale } from '../src';
import { buy, dividend, interest, profile, run, sell, CFG_2025 } from './helpers';

describe('simulace prodeje („co když teď prodám?")', () => {
  const transactions = [
    buy({ isin: 'CZ0000000001', quantity: '100', pricePerShare: '1000', tradeDate: '2019-05-05', settlementDate: '2019-05-05' }),
    buy({ isin: 'CZ0000000002', quantity: '100', pricePerShare: '1150', tradeDate: '2024-06-01', settlementDate: '2024-06-01' }),
    dividend({ gross: '40000' }), // zahraniční dividendy už čerpají 40k z 50k limitu
  ];
  const input = { transactions, profile: profile(), config: CFG_2025 };

  it('prodej mladé pozice prolomí limit 50k — simulace to ukáže před obchodem', () => {
    const simulation = simulateSale(input, {
      isin: 'CZ0000000002',
      quantity: '100',
      pricePerShare: '1200',
      currency: 'CZK',
      date: '2025-08-01',
    });

    expect(simulation.baseline.flatTax50kUsedCzk.toString()).toBe('40000');
    expect(simulation.baseline.flatTax50kExceeded).toBe(false);
    expect(simulation.simulated.flatTax50kUsedCzk.toString()).toBe('160000');
    expect(simulation.simulated.flatTax50kExceeded).toBe(true);
    expect(simulation.deltas.flatTax50kUsedCzk.toString()).toBe('120000');
    expect(simulation.simulatedDisposal?.taxableProceedsCzk.toString()).toBe('120000');
    // daň: baseline 40 000×15 % = 6 000 → po prodeji +5 000 zisku → 6 750
    expect(simulation.deltas.taxCzk.toString()).toBe('750');
  });

  it('prodej pozice po časovém testu limit 50k nečerpá', () => {
    const simulation = simulateSale(input, {
      isin: 'CZ0000000001',
      quantity: '100',
      pricePerShare: '1200',
      currency: 'CZK',
      date: '2025-08-01',
    });

    expect(simulation.simulated.flatTax50kUsedCzk.toString()).toBe('40000');
    expect(simulation.simulated.flatTax50kExceeded).toBe(false);
    expect(simulation.deltas.flatTax50kUsedCzk.toString()).toBe('0');
    expect(simulation.simulatedDisposal?.exemptProceedsCzk.toString()).toBe('120000');
    expect(simulation.deltas.taxCzk.toString()).toBe('0');
  });
});

describe('porovnání variant výpočtu (R-05c × R-06)', () => {
  it('u paušálu vyhrává varianta, která neprolomí 50k — FIFO trefí osvobozený lot', () => {
    const input = {
      transactions: [
        buy({ isin: 'CZ0000000001', quantity: '10', pricePerShare: '10000', tradeDate: '2019-05-05', settlementDate: '2019-05-05' }),
        buy({ isin: 'CZ0000000001', quantity: '10', pricePerShare: '13000', tradeDate: '2024-05-05', settlementDate: '2024-05-05' }),
        sell({ isin: 'CZ0000000001', quantity: '10', pricePerShare: '15000', tradeDate: '2025-06-01', settlementDate: '2025-06-01' }),
      ],
      profile: profile(),
      config: CFG_2025,
    };

    const { variants, recommended } = compareVariants(input);
    expect(variants).toHaveLength(4); // 4 metody × 1 kurzová metoda (bez denních kurzů)

    const byMethod = Object.fromEntries(variants.map((v) => [v.matchingMethod, v]));
    // FIFO spáruje lot z 2019 → prodej osvobozen, limit nedotčen
    expect(byMethod['FIFO']!.taxCzk.toString()).toBe('0');
    expect(byMethod['FIFO']!.flatTax50kExceeded).toBe(false);
    // LIFO spáruje lot z 2024 → tržba 150k prolomí limit a zisk 20k se daní
    expect(byMethod['LIFO']!.flatTax50kExceeded).toBe(true);
    expect(byMethod['LIFO']!.taxCzk.toString()).toBe('3000');

    expect(recommended.matchingMethod).toBe('FIFO');
    expect(recommended.flatTax50kExceeded).toBe(false);
  });
});

describe('smoke: kompletní rok napříč moduly', () => {
  it('kombinace prodejů, dividend a úroků dá konzistentní výsledek', () => {
    const result = run([
      buy({ isin: 'CZ0000000001', quantity: '100', pricePerShare: '1150', tradeDate: '2024-01-10', settlementDate: '2024-01-10' }),
      sell({ isin: 'CZ0000000001', quantity: '100', pricePerShare: '1200', tradeDate: '2025-03-05', settlementDate: '2025-03-05' }),
      dividend({ gross: '100', currency: 'USD', withholdingTax: '15' }), // 2 000 CZK
      interest({ amount: '500', sourceCountry: 'GB' }),
    ]);
    // 50k limit: 120 000 (tržba) + 2 000 (dividenda) + 500 (úrok) = 122 500
    expect(result.limits.flatTax50k.status.usedCzk.toString()).toBe('122500');
    // základy: § 10 = 5 000; § 8 = 2 000 + 500
    expect(result.securities.base10Czk.toString()).toBe('5000');
    expect(result.dividends.base8Czk.toString()).toBe('2500');
    // daň (obecná): (5 000 + 2 500)×15 % = 1 125 − zápočet 300 = 825
    expect(result.tax.general.taxCzk.toString()).toBe('825');
  });
});
