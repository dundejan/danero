import { describe, expect, it } from 'vitest';
import { parseUniversalCsv } from '../src';

const SAMPLE = [
  'type,date,settlement_date,isin,ticker,name,quantity,price,currency,fee,fee_currency,amount,withholding_tax,source_country,note',
  'BUY,2024-01-10,2024-01-12,US0378331005,AAPL,Apple Inc,10,185.50,USD,2.10,CZK,,,,',
  'SELL,2025-03-05,,US0378331005,AAPL,Apple Inc,10,210.00,USD,3.00,CZK,,,,',
  'DIVIDEND,2025-04-01,,US0378331005,AAPL,,,,USD,,,2.50,0.38,US,',
  'INTEREST,2025-05-01,,,,,,,CZK,,,12.34,,GB,úrok na hotovosti',
  'DEPOSIT,2024-01-05,,,,,,,CZK,,,10000,,,',
].join('\n');

describe('univerzální CSV šablona', () => {
  it('parsuje ukázku z dokumentace bez chyb', () => {
    const result = parseUniversalCsv(SAMPLE);
    expect(result.errors).toEqual([]);
    expect(result.transactions.map((t) => t.type)).toEqual([
      'BUY',
      'SELL',
      'DIVIDEND',
      'INTEREST',
      'DEPOSIT',
    ]);

    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.settlementDate).toBe('2024-01-12'); // šablona umí přesné vypořádání
    expect(buy.fee?.currency).toBe('CZK');

    const dividend = result.transactions[2]!;
    if (dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.gross.toString()).toBe('2.5');
    expect(dividend.sourceCountry).toBe('US');
  });

  it('neznámý typ a chybějící hlavička → srozumitelné chyby', () => {
    const badType = parseUniversalCsv('type,date,amount,currency\nSWAP,2025-01-01,5,CZK');
    expect(badType.errors[0]!.message).toContain('Neznámý typ "SWAP"');

    const badHeader = parseUniversalCsv('foo,bar\n1,2');
    expect(badHeader.errors[0]!.message).toContain('Chybí povinný sloupec');
  });
});
