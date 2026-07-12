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

  it('úplně prázdný soubor = prázdné období (roky před založením účtu), ne chyba', () => {
    const empty = parseTrading212Csv('');
    expect(empty.errors).toEqual([]);
    expect(empty.transactions).toEqual([]);

    const whitespace = parseTrading212Csv('\n\n');
    expect(whitespace.errors).toEqual([]);
    expect(whitespace.transactions).toEqual([]);
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

  it('Stock split close/open pár → CORPORATE_ACTION SPLIT se zachováním data nabytí', () => {
    const csv = [
      HEADER,
      'Stock split close,2025-07-30 06:42:25,US05606L1008,BYDDY,BYD,0.9760924,93.66,USD,,,,83.09,EUR,,,,EOF-C1,,',
      'Stock split open,2025-07-30 06:42:25,US05606L1008,BYDDY,BYD,5.8565544,15.61,USD,,,,83.09,EUR,,,,EOF-O1,,',
    ].join('\n');
    const result = parseTrading212Csv(csv);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    const action = result.transactions[0]!;
    if (action.type !== 'CORPORATE_ACTION') throw new Error('unreachable');
    expect(action.subtype).toBe('SPLIT');
    expect(action.isin).toBe('US05606L1008');
    expect(action.ratio?.from.toString()).toBe('0.9760924');
    expect(action.ratio?.to.toString()).toBe('5.8565544');

    // nespárovaný open → error
    const orphan = parseTrading212Csv(
      `${HEADER}\nStock split open,2025-07-30 06:42:25,US05606L1008,BYDDY,BYD,5.85,15.61,USD,,,,,,,,,EOF-O2,,`,
    );
    expect(orphan.errors).toHaveLength(1);
    expect(orphan.errors[0]!.message).toContain('bez párového close');
  });

  it('Spin off → BUY s cenou 0 (R-04f) + varování; karta a cashback se přeskočí', () => {
    const csv = [
      HEADER,
      'Spin off,2026-07-02 12:41:57,US60744M1062,MBGL,Mobility Global,1.49221104,0E-10,USD,,,,0.00,EUR,,,,EOF-S1,,',
      'Card debit,2026-01-05 10:00:00,,,,,,,,,,-250.00,CZK,,,,,,',
      'Card credit,2026-01-06 10:00:00,,,,,,,,,,100.00,CZK,,,,,,',
      'Spending cashback,2026-01-05 10:00:01,,,,,,,,,,1.25,CZK,,,,,,',
    ].join('\n');
    const result = parseTrading212Csv(csv);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toHaveLength(3);
    expect(result.transactions).toHaveLength(1);
    const spinoff = result.transactions[0]!;
    if (spinoff.type !== 'BUY') throw new Error('unreachable');
    expect(spinoff.isin).toBe('US60744M1062');
    expect(spinoff.quantity.toString()).toBe('1.49221104');
    expect(spinoff.pricePerShare.toString()).toBe('0');
    expect(result.warnings.some((w) => w.message.includes('Spin-off'))).toBe(true);
  });

  it('záporný úrok = naúčtovaný náklad → FEE s varováním, ne příjem § 8', () => {
    const csv = [
      HEADER,
      'Interest on cash,2025-05-01 00:00:00,,,,,,,,,,-3.21,CZK,,,,EOF-NI1,,',
      'Interest on cash,2025-06-01 00:00:00,,,,,,,,,,12.34,CZK,,,,EOF-PI1,,',
    ].join('\n');
    const result = parseTrading212Csv(csv);
    expect(result.errors).toEqual([]);
    expect(result.transactions.map((t) => t.type)).toEqual(['FEE', 'INTEREST']);
    const fee = result.transactions[0]!;
    if (fee.type !== 'FEE') throw new Error('unreachable');
    expect(fee.amount.toString()).toBe('3.21');
    expect(result.warnings.some((w) => w.message.includes('naúčtovaný úrok'))).toBe(true);
  });

  it('podezřelý poplatek obchodu (záporný / bez měny) se nezapočte a nahlásí', () => {
    // vratka: záporná hodnota poplatku nesmí navýšit výdaje
    const rebate = parseTrading212Csv(
      `${HEADER}\nMarket buy,2024-01-10 09:00:00,US0378331005,AAPL,Apple,10,185.50,USD,,,,1855.00,USD,,,,EOF-R1,-2.10,CZK`,
    );
    const rebateBuy = rebate.transactions[0]!;
    if (rebateBuy.type !== 'BUY') throw new Error('unreachable');
    expect(rebateBuy.fee).toBeUndefined();
    expect(rebate.warnings.some((w) => w.message.includes('vypadá jako vratka'))).toBe(true);

    // poplatek s hodnotou, ale bez sloupce s měnou → nezapočíst, nahlásit
    const noCurrencyHeader =
      'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Total,Currency (Total),ID,Currency conversion fee';
    const missing = parseTrading212Csv(
      `${noCurrencyHeader}\nMarket buy,2024-01-10 09:00:00,US0378331005,AAPL,Apple,10,185.50,USD,1855.00,USD,EOF-M1,2.10`,
    );
    const missingBuy = missing.transactions[0]!;
    if (missingBuy.type !== 'BUY') throw new Error('unreachable');
    expect(missingBuy.fee).toBeUndefined();
    expect(missing.warnings.some((w) => w.message.includes('sloupec s měnou'))).toBe(true);
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
