import { describe, expect, it } from 'vitest';
import { TransactionSchema, type Transaction } from '@danero/shared';
import type { MatchingMethod } from '../src';
import { buy, hasWarning, run, sell } from './helpers';

/**
 * Převody mezi brokery (docs/02 R-04i) a jejich souhra s metodou párování
 * (R-05c). Odchozí převod do revize 5 nehlídal jediný test enginu — vypnutí
 * celé větve `TRANSFER_OUT` prošlo všemi sadami (nález L4-01) a stejně tak
 * FIFO bez řazení podle data nabytí (nález L4-06). Vše v CZK na CFG_2025,
 * prodeje jsou nad limitem 100 000 Kč, takže o dani rozhoduje jen časový test.
 */

type Overrides = Record<string, unknown>;

const METHODS: MatchingMethod[] = ['FIFO', 'LIFO', 'MAX_PROFIT', 'MAX_LOSS'];

let seq = 0;

const transferOut = (over: Overrides = {}): Transaction =>
  TransactionSchema.parse({
    type: 'TRANSFER_OUT',
    id: `transfer-out-${(seq += 1)}`,
    isin: 'CZ0000000001',
    quantity: '100',
    date: '2025-01-15',
    ...over,
  });

const transferIn = (over: Overrides = {}): Transaction =>
  TransactionSchema.parse({
    type: 'TRANSFER_IN',
    id: `transfer-in-${(seq += 1)}`,
    isin: 'CZ0000000001',
    quantity: '100',
    date: '2024-02-01',
    ...over,
  });

/** Starší lot (2021, při prodeji v roce 2025 už osvobozený) a mladší lot (12/2024). */
const twoLots = (olderPrice: string, youngerPrice: string): Transaction[] => [
  buy({ quantity: '100', pricePerShare: olderPrice, tradeDate: '2021-01-10' }),
  buy({ quantity: '100', pricePerShare: youngerPrice, tradeDate: '2024-12-01' }),
];

const allocations = (result: ReturnType<typeof run>) =>
  result.securities.disposals.flatMap((disposal) => disposal.allocations);

describe('R-04i: odchozí převod (TRANSFER_OUT) odepisuje loty vždy FIFO', () => {
  for (const method of METHODS) {
    it(`${method}: převod vezme nejstarší lot, prodej pak jde z mladšího a je zdanitelný`, () => {
      // starší lot je levnější — LIFO a MAX_LOSS by pro převod sáhly po mladším
      const result = run(
        [...twoLots('1000', '2000'), transferOut(), sell({ quantity: '100', pricePerShare: '2500', tradeDate: '2025-06-01' })],
        { options: { matchingMethod: method } },
      );
      expect(allocations(result).map((a) => a.acquisitionDate)).toEqual(['2024-12-01']);
      expect(result.securities.base10Czk.toString()).toBe('50000'); // 250 000 − 200 000
      expect(result.securities.timeTestExemptProceedsCzk.toString()).toBe('0');
      expect(result.positions).toHaveLength(0);
      expect(hasWarning(result, 'TRANSFER_OUT_EXCEEDS_POSITION')).toBe(false);
    });

    it(`${method}: FIFO platí i tehdy, když je nejstarší lot dražší`, () => {
      // starší lot je dražší — po mladším by tentokrát sáhly LIFO a MAX_PROFIT
      const result = run(
        [...twoLots('2000', '1000'), transferOut(), sell({ quantity: '100', pricePerShare: '2500', tradeDate: '2025-06-01' })],
        { options: { matchingMethod: method } },
      );
      expect(allocations(result).map((a) => a.acquisitionDate)).toEqual(['2024-12-01']);
      expect(result.securities.base10Czk.toString()).toBe('150000'); // 250 000 − 100 000
      expect(result.securities.timeTestExemptProceedsCzk.toString()).toBe('0');
      expect(result.positions).toHaveLength(0);
    });
  }

  it('převod není prodej: žádný příjem, v pozicích zůstane jen mladší lot', () => {
    const result = run([...twoLots('1000', '2000'), transferOut()], { options: { matchingMethod: 'LIFO' } });
    expect(result.securities.disposals).toHaveLength(0);
    expect(result.securities.totalGrossProceedsCzk.toString()).toBe('0');
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0]!.totalRemaining.toString()).toBe('100');
    expect(result.positions[0]!.lots.map((lot) => lot.acquisitionDate)).toEqual(['2024-12-01']);
  });

  it('převod přes hranu lotu dočerpá starší lot a z mladšího ubere jen zbytek', () => {
    const result = run([...twoLots('1000', '2000'), transferOut({ quantity: '150' })]);
    expect(result.ledger.lots.map((lot) => `${lot.acquisitionDate}:${lot.remaining.toString()}`)).toEqual([
      '2021-01-10:0',
      '2024-12-01:50',
    ]);
    expect(result.positions[0]!.totalRemaining.toString()).toBe('50');
    expect(hasWarning(result, 'TRANSFER_OUT_EXCEEDS_POSITION')).toBe(false);
  });

  it('převod nad evidovanou pozici hlásí TRANSFER_OUT_EXCEEDS_POSITION a pozici vynuluje', () => {
    const result = run([
      buy({ quantity: '50', pricePerShare: '1000', tradeDate: '2024-01-10' }),
      transferOut({ quantity: '80' }),
    ]);
    const warning = result.warnings.find((w) => w.code === 'TRANSFER_OUT_EXCEEDS_POSITION');
    expect(warning?.level).toBe('ERROR');
    expect(warning?.message).toContain('30 ks');
    expect(result.positions).toHaveLength(0);
  });
});

describe('R-04i × R-12: odchozí převod derivátu', () => {
  const isin = 'OPT:AAPL260619C200';
  const derivative = { isin, assetClass: 'DERIVATIVE', quantity: '1' };

  it('převedený kontrakt už nejde zavřít jako long — další prodej je výpis (SHORT_OPEN)', () => {
    const result = run([
      buy({ ...derivative, pricePerShare: '10000', tradeDate: '2025-02-03' }),
      transferOut({ ...derivative, date: '2025-03-01' }),
      sell({ ...derivative, pricePerShare: '15000', tradeDate: '2025-06-10' }),
    ]);
    expect(result.derivatives.items.map((item) => item.kind)).toEqual(['SHORT_OPEN']);
    // prémie 10 000 odešla s převodem, proti prodeji se už neuplatní
    expect(result.derivatives.taxableIncomeCzk.toString()).toBe('15000');
    expect(result.derivatives.expensesCzk.toString()).toBe('0');
    expect(result.derivatives.base10Czk.toString()).toBe('15000');
    expect(hasWarning(result, 'TRANSFER_OUT_EXCEEDS_POSITION')).toBe(false);
  });

  it('převod nad evidovanou derivátovou pozici hlásí TRANSFER_OUT_EXCEEDS_POSITION', () => {
    const result = run([
      transferOut({ ...derivative, date: '2025-03-01' }),
      buy({ ...derivative, pricePerShare: '10000', tradeDate: '2025-04-03' }),
      sell({ ...derivative, pricePerShare: '15000', tradeDate: '2025-06-10' }),
    ]);
    const warning = result.warnings.find((w) => w.code === 'TRANSFER_OUT_EXCEEDS_POSITION');
    expect(warning?.level).toBe('ERROR');
    // převod do prázdna pozdější nákup nespotřebuje — ten se zavře běžným prodejem
    expect(result.derivatives.items.map((item) => item.kind)).toEqual(['LONG_CLOSE']);
    expect(result.derivatives.base10Czk.toString()).toBe('5000');
  });
});

describe('R-05c × R-04i: párování řadí loty podle data nabytí, ne podle pořadí zápisu', () => {
  // Příchozí převod nese původní datum nabytí (R-04i: převod držbu nepřerušuje),
  // takže lot zapsaný později může být starší než nákup u nového brokera.
  // Id jsou schválně proti směru: nákup z roku 2023 je abecedně PRVNÍ, převod
  // s nabytím 2021 DRUHÝ — řazení jen podle id (nebo žádné) tak dá opačné pořadí
  // než řazení podle data nabytí.
  const history = (): Transaction[] => [
    buy({ id: 'a-buy-2023', quantity: '100', pricePerShare: '1000', tradeDate: '2023-05-10' }),
    transferIn({
      id: 'b-transfer-acquired-2021',
      acquisition: { date: '2021-01-11', costPerShare: '500', currency: 'CZK' },
    }),
    sell({ quantity: '100', pricePerShare: '1200', tradeDate: '2025-03-05' }),
  ];

  it('FIFO spáruje převedený lot z roku 2021 — prodej je osvobozený', () => {
    const result = run(history(), { options: { matchingMethod: 'FIFO' } });
    const [first] = allocations(result);
    expect(first!.lotId).toBe('lot-b-transfer-acquired-2021');
    expect(first!.acquisitionDate).toBe('2021-01-11');
    expect(first!.timeTestExempt).toBe(true);
    expect(result.securities.timeTestExemptProceedsCzk.toString()).toBe('120000');
    expect(result.securities.base10Czk.toString()).toBe('0');
    expect(result.positions[0]!.lots.map((lot) => lot.acquisitionDate)).toEqual(['2023-05-10']);
  });

  it('LIFO spáruje nákup z roku 2023 — prodej je zdanitelný', () => {
    const result = run(history(), { options: { matchingMethod: 'LIFO' } });
    const [first] = allocations(result);
    expect(first!.lotId).toBe('lot-a-buy-2023');
    expect(first!.acquisitionDate).toBe('2023-05-10');
    expect(first!.timeTestExempt).toBe(false);
    expect(result.securities.timeTestExemptProceedsCzk.toString()).toBe('0');
    expect(result.securities.base10Czk.toString()).toBe('20000'); // 120 000 − 100 000
    expect(result.positions[0]!.lots.map((lot) => lot.acquisitionDate)).toEqual(['2021-01-11']);
  });

  it('dva převody téhož dne se řadí podle svého data nabytí', () => {
    const sameDay = (): Transaction[] => [
      transferIn({
        id: 'a-transfer-acquired-2023',
        acquisition: { date: '2023-06-01', costPerShare: '1000', currency: 'CZK' },
      }),
      transferIn({
        id: 'b-transfer-acquired-2021',
        acquisition: { date: '2021-01-11', costPerShare: '500', currency: 'CZK' },
      }),
      sell({ quantity: '100', pricePerShare: '1200', tradeDate: '2025-03-05' }),
    ];
    const fifo = run(sameDay(), { options: { matchingMethod: 'FIFO' } });
    expect(allocations(fifo).map((a) => a.acquisitionDate)).toEqual(['2021-01-11']);
    expect(fifo.securities.base10Czk.toString()).toBe('0');

    const lifo = run(sameDay(), { options: { matchingMethod: 'LIFO' } });
    expect(allocations(lifo).map((a) => a.acquisitionDate)).toEqual(['2023-06-01']);
    expect(lifo.securities.base10Czk.toString()).toBe('20000');
  });
});
