import { describe, expect, it } from 'vitest';
import { dedupeTransactions, parseTrading212Csv, TRADING212_BROKER } from '../src';
import { T212_FIXTURE as FIXTURE, T212_HEADER as HEADER } from './fixtures/t212';

describe('Trading212 CSV parser', () => {
  it('namapuje všechny podporované typy, FX konverzi přeskočí', () => {
    const result = parseTrading212Csv(FIXTURE);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.transactions).toHaveLength(6);

    const types = result.transactions.map((t) => t.type);
    expect(types).toEqual(['DEPOSIT', 'BUY', 'SELL', 'DIVIDEND', 'INTEREST', 'WITHDRAWAL']);
  });

  it('BUY: množství, cena, měna instrumentu, poplatky, T212 ID', () => {
    const result = parseTrading212Csv(FIXTURE);
    const buy = result.transactions.find((t) => t.type === 'BUY')!;
    expect(buy.id).toBe('t212-EOF1001');
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.isin).toBe('US0378331005');
    expect(buy.quantity.toString()).toBe('100');
    expect(buy.pricePerShare.toString()).toBe('185.5');
    expect(buy.currency).toBe('USD');
    expect(buy.fee?.amount.toString()).toBe('2.1');
    expect(buy.fee?.currency).toBe('CZK');
    expect(buy.tradeDate).toBe('2024-01-10');
    expect(buy.settlementDate).toBeUndefined(); // dopočítá engine
  });

  it('DIVIDEND: brutto = kusy × dividenda/kus v měně instrumentu + srážková daň', () => {
    const result = parseTrading212Csv(FIXTURE);
    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND')!;
    if (dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.gross.toString()).toBe('25'); // 100 × 0.25 USD
    expect(dividend.currency).toBe('USD');
    expect(dividend.withholdingTax.toString()).toBe('3.75');
    expect(dividend.date).toBe('2025-04-01');
  });

  it('funguje s přeházenými a chybějícími sloupci (mapování dle názvů)', () => {
    const reordered = [
      'Time,Action,Currency (Price / share),Price / share,No. of shares,ISIN',
      '2024-02-01 10:00:00,Limit buy,EUR,50.25,10,IE00B4L5Y983',
    ].join('\n');
    const result = parseTrading212Csv(reordered);
    expect(result.errors).toEqual([]);
    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.isin).toBe('IE00B4L5Y983');
    expect(buy.pricePerShare.toString()).toBe('50.25');
    expect(buy.fee).toBeUndefined();
  });

  it('neznámá Action → error řádek; soubor bez T212 hlaviček → error', () => {
    const unknown = parseTrading212Csv(`${HEADER}\nLending fee,2024-01-01 00:00:00,,,,,,,,,,1.00,CZK,,,,,,`);
    expect(unknown.errors).toHaveLength(1);
    expect(unknown.errors[0]!.line).toBe(2);

    const foreign = parseTrading212Csv('foo,bar\n1,2');
    expect(foreign.errors[0]!.message).toContain('nevypadá jako Trading212 export');
  });

  it('BUY bez ISIN → error řádek (nutná oprava, ne tiché přeskočení)', () => {
    const broken = parseTrading212Csv(`${HEADER}\nMarket buy,2024-01-10 14:30:02,,AAPL,Apple,10,185.50,USD,,,,,,,,,,,`);
    expect(broken.transactions).toEqual([]);
    expect(broken.errors).toHaveLength(1);
  });

  it('opakovaný import téhož souboru je idempotentní (dedupe)', () => {
    const first = parseTrading212Csv(FIXTURE).transactions;
    const second = parseTrading212Csv(FIXTURE).transactions;

    const initial = dedupeTransactions(TRADING212_BROKER, first);
    expect(initial.fresh).toHaveLength(6);
    expect(initial.duplicates).toBe(0);

    const repeated = dedupeTransactions(TRADING212_BROKER, [...first, ...second]);
    expect(repeated.fresh).toHaveLength(6);
    expect(repeated.duplicates).toBe(6);
  });

  it('identické řádky bez ID: varování + dedupe je sloučí', () => {
    const duplicated = [
      HEADER,
      'Interest on cash,2025-05-01 00:00:00,,,,,,,,,,12.34,CZK,,,,,,',
      'Interest on cash,2025-05-01 00:00:00,,,,,,,,,,12.34,CZK,,,,,,',
    ].join('\n');
    const result = parseTrading212Csv(duplicated);
    expect(result.transactions).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
    expect(dedupeTransactions(TRADING212_BROKER, result.transactions).fresh).toHaveLength(1);
  });
});
