import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, d, sum, TransactionSchema, type Transaction } from '@danero/shared';
import { buildLedger, resolveOptions, WarningCollector, type MatchingMethod } from '../src';
import { run } from './helpers';

interface BuySpec {
  qty: number;
  price: number;
  year: number;
  day: number;
}

const buyTx = (spec: BuySpec, index: number): Transaction =>
  TransactionSchema.parse({
    type: 'BUY',
    id: `b${index}`,
    isin: 'CZ0000000001',
    quantity: String(spec.qty),
    pricePerShare: String(spec.price),
    currency: 'CZK',
    tradeDate: addDays(`${spec.year}-01-01`, spec.day),
    settlementDate: addDays(`${spec.year}-01-01`, spec.day),
  });

const sellTx = (qty: number, price: number): Transaction =>
  TransactionSchema.parse({
    type: 'SELL',
    id: 's1',
    isin: 'CZ0000000001',
    quantity: String(qty),
    pricePerShare: String(price),
    currency: 'CZK',
    tradeDate: '2025-06-02',
    settlementDate: '2025-06-02',
  });

const buysArb = fc.array(
  fc.record({
    qty: fc.integer({ min: 1, max: 100 }),
    price: fc.integer({ min: 1, max: 1000 }),
    year: fc.integer({ min: 2020, max: 2024 }),
    day: fc.integer({ min: 0, max: 350 }),
  }),
  { minLength: 1, maxLength: 8 },
);

const METHODS: MatchingMethod[] = ['FIFO', 'LIFO', 'MAX_PROFIT', 'MAX_LOSS'];
const methodArb = fc.constantFrom(...METHODS);

describe('property: invarianty ledgeru a základu daně', () => {
  it('alokace přesně pokrývají prodej a zbývající množství sedí u všech metod párování', () => {
    fc.assert(
      fc.property(buysArb, fc.integer({ min: 0, max: 100 }), methodArb, (buys, pct, method) => {
        const total = buys.reduce((acc, b) => acc + b.qty, 0);
        const sellQty = Math.floor((total * pct) / 100);
        const txs = buys.map(buyTx);
        if (sellQty > 0) txs.push(sellTx(sellQty, 500));

        const warnings = new WarningCollector();
        const ledger = buildLedger(txs, resolveOptions({ matchingMethod: method }), warnings);

        expect(warnings.has('NEGATIVE_POSITION')).toBe(false);
        expect(sum(ledger.lots.map((l) => l.remaining)).toString()).toBe(String(total - sellQty));
        if (sellQty > 0) {
          const disposal = ledger.disposals[0]!;
          expect(sum(disposal.allocations.map((a) => a.quantity)).toString()).toBe(String(sellQty));
        }
      }),
      { numRuns: 50 },
    );
  });

  it('R-05d: dílčí základ § 10 není nikdy záporný, ať je metoda a cena jakákoli', () => {
    fc.assert(
      fc.property(
        buysArb,
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 2000 }),
        methodArb,
        (buys, pct, sellPrice, method) => {
          const total = buys.reduce((acc, b) => acc + b.qty, 0);
          const sellQty = Math.max(1, Math.floor((total * pct) / 100));
          const txs = buys.map(buyTx);
          txs.push(sellTx(sellQty, sellPrice));

          const result = run(txs, { options: { matchingMethod: method } });
          expect(result.securities.base10Czk.gte(0)).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('R-04a: split zachovává celkovou hodnotu pozice (množství × cena)', () => {
    const ratioArb = fc.constantFrom(
      { from: '1', to: '2' },
      { from: '2', to: '1' },
      { from: '1', to: '3' },
      { from: '3', to: '2' },
    );
    fc.assert(
      fc.property(buysArb, ratioArb, (buys, ratio) => {
        const txs = buys.map(buyTx);
        const before = buildLedger(txs, resolveOptions(), new WarningCollector());
        const valueBefore = sum(before.lots.map((l) => l.remaining.mul(l.costPerShare)));

        const split = TransactionSchema.parse({
          type: 'CORPORATE_ACTION',
          id: 'ca1',
          subtype: 'SPLIT',
          isin: 'CZ0000000001',
          date: '2025-01-02',
          ratio,
        });
        const after = buildLedger([...txs, split], resolveOptions(), new WarningCollector());
        const valueAfter = sum(after.lots.map((l) => l.remaining.mul(l.costPerShare)));

        expect(valueAfter.sub(valueBefore).abs().lt(d('1e-15'))).toBe(true);
      }),
      { numRuns: 50 },
    );
  });
});
