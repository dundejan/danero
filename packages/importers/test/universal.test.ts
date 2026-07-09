import { describe, expect, it } from 'vitest';
import { parseUniversalCsv, UNIVERSAL_TEMPLATE_CSV } from '../src';

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

  it('v2: CORPORATE_ACTION (SPLIT, ISIN_CHANGE) a TRANSFER_IN s nabytím', () => {
    const csv = [
      'type,date,isin,quantity,subtype,ratio_from,ratio_to,new_isin,acquisition_date,acquisition_price,acquisition_currency',
      'CORPORATE_ACTION,2024-08-31,US0378331005,,SPLIT,1,4,,,,',
      'CORPORATE_ACTION,2025-04-01,GB0002222222,,ISIN_CHANGE,,,GB0003333333,,,',
      'TRANSFER_IN,2025-05-05,US5949181045,10,,,,,2021-03-01,240.00,USD',
      'TRANSFER_IN,2025-06-01,US5949181045,5,,,,,,,',
    ].join('\n');
    const result = parseUniversalCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.transactions.map((t) => t.type)).toEqual([
      'CORPORATE_ACTION',
      'CORPORATE_ACTION',
      'TRANSFER_IN',
      'TRANSFER_IN',
    ]);

    const split = result.transactions[0]!;
    if (split.type !== 'CORPORATE_ACTION') throw new Error('unreachable');
    expect(split.subtype).toBe('SPLIT');
    expect(split.ratio?.from.toString()).toBe('1');
    expect(split.ratio?.to.toString()).toBe('4');

    const change = result.transactions[1]!;
    if (change.type !== 'CORPORATE_ACTION') throw new Error('unreachable');
    expect(change.newIsin).toBe('GB0003333333');

    const transfer = result.transactions[2]!;
    if (transfer.type !== 'TRANSFER_IN') throw new Error('unreachable');
    expect(transfer.acquisition?.date).toBe('2021-03-01');
    expect(transfer.acquisition?.costPerShare?.toString()).toBe('240');

    // R-04i: převod bez nabytí projde, ale s varováním
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain('časový test od data převodu');
  });

  it('v2: validace — SPLIT bez ratio a ISIN_CHANGE bez new_isin jsou chyby', () => {
    const csv = [
      'type,date,isin,subtype,ratio_from,ratio_to,new_isin',
      'CORPORATE_ACTION,2024-08-31,US0378331005,SPLIT,,,',
      'CORPORATE_ACTION,2025-04-01,GB0002222222,ISIN_CHANGE,,,',
      'CORPORATE_ACTION,2025-04-01,GB0002222222,NESMYSL,,,',
    ].join('\n');
    const result = parseUniversalCsv(csv);
    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(3);
    expect(result.errors[0]!.message).toContain('ratio_from');
    expect(result.errors[1]!.message).toContain('new_isin');
    expect(result.errors[2]!.message).toContain('subtype');
  });

  it('v2: stažitelná šablona se sama naparsuje bez chyb', () => {
    const result = parseUniversalCsv(UNIVERSAL_TEMPLATE_CSV);
    expect(result.errors).toEqual([]);
    expect(result.transactions.length).toBeGreaterThanOrEqual(8);
  });
});
