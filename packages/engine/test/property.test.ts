import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, d, sum, TransactionSchema, type Transaction } from '@danero/shared';
import { buildLedger, resolveOptions, WarningCollector, type MatchingMethod } from '../src';
import { buy, run, sell } from './helpers';

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

/**
 * Nález „chybějící testy“ z 3. auditu: tyhle mutace přežily celou sadu, tedy
 * příslušná pole nikdo neověřoval. Každý test je psaný tak, aby padl na
 * konkrétní mutaci uvedené v komentáři.
 */
describe('pole, která přežila mutace celé sady (audit 3)', () => {
  // mutace: `base10Czk: ZERO` u krypta i derivátů → 161/161 zeleně
  it('dílčí základ § 10 sečte VŠECHNY tři druhy, ne jen cenné papíry', () => {
    const result = run([
      // CP: tržba 300 000, nákup 200 000 → +100 000
      buy({ quantity: '10', pricePerShare: '20000', tradeDate: '2024-03-01', settlementDate: '2024-03-01' }),
      sell({ quantity: '10', pricePerShare: '30000', tradeDate: '2025-06-01', settlementDate: '2025-06-01' }),
      // krypto: tržba 300 000, nákup 250 000 → +50 000
      buy({ isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '250000', tradeDate: '2025-03-01', settlementDate: '2025-03-01' }),
      sell({ isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '300000', tradeDate: '2025-07-01', settlementDate: '2025-07-01' }),
      // deriváty: prémie 10 000, prodej 25 000 → +15 000
      buy({ isin: 'OPT:X', assetClass: 'DERIVATIVE', quantity: '1', pricePerShare: '10000', tradeDate: '2025-02-01', settlementDate: '2025-02-01' }),
      sell({ isin: 'OPT:X', assetClass: 'DERIVATIVE', quantity: '1', pricePerShare: '25000', tradeDate: '2025-08-01', settlementDate: '2025-08-01' }),
    ]);
    expect(result.securities.base10Czk.toString()).toBe('100000');
    expect(result.crypto.base10Czk.toString()).toBe('50000');
    expect(result.derivatives.base10Czk.toString()).toBe('15000');
    // právě tenhle součet mutaci odhalí — každý druh v něm musí být vidět
    expect(result.tax.general.baseCzk.toString()).toBe('165000');
  });

  // mutace: `PositionLot.isExempt = false` natvrdo → 161/161 zeleně
  it('hlídač pozic označí lot po třech letech držby za osvobozený', () => {
    const result = run([
      buy({ quantity: '10', pricePerShare: '1000', tradeDate: '2021-01-10', settlementDate: '2021-01-10' }),
      buy({ isin: 'CZ0000000002', quantity: '10', pricePerShare: '1000', tradeDate: '2025-01-10', settlementDate: '2025-01-10' }),
    ]);
    const stary = result.positions.find((p) => p.isin === 'CZ0000000001')!;
    const novy = result.positions.find((p) => p.isin === 'CZ0000000002')!;
    expect(stary.lots[0]!.isExempt).toBe(true);
    expect(stary.lots[0]!.daysToExempt).toBe(0);
    expect(novy.lots[0]!.isExempt).toBe(false);
    expect(novy.lots[0]!.daysToExempt).toBeGreaterThan(0);
  });

  // mutace: hranice účinnosti `>=` → `>` prošla
  it('krypto osvobození platí OD 15. 2. 2025 včetně, ne až od 16.', () => {
    const scenario = (saleDate: string) =>
      run([
        buy({ isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '10000', tradeDate: '2020-01-10', settlementDate: '2020-01-10' }),
        sell({ isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '900000', tradeDate: saleDate, settlementDate: saleDate }),
      ]);
    // den před účinností: časový test ještě neexistuje → zdanitelné
    expect(scenario('2025-02-14').crypto.base10Czk.toString()).toBe('890000');
    // přesně v den účinnosti už osvobozuje
    expect(scenario('2025-02-15').crypto.base10Czk.toString()).toBe('0');
  });
});
