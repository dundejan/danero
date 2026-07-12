import { describe, expect, it } from 'vitest';
import { TaxpayerProfileSchema } from '@danero/shared';
import { analyzeTaxYear, type TaxYearConfig } from '@danero/engine';
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

  it('dva identické legitimní řádky nesplynou — id dostane pořadový suffix', () => {
    const csv = [
      'type,date,isin,quantity,price,currency',
      'BUY,2024-06-10,US0378331005,10,185.50,USD',
      'BUY,2024-06-10,US0378331005,10,185.50,USD',
    ].join('\n');
    const result = parseUniversalCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(2);
    const [first, second] = result.transactions;
    expect(first!.id).not.toBe(second!.id);
    expect(second!.id).toBe(`${first!.id}-2`);
  });

  describe('R-12f/R-12r: sloupec settlement_style (MARGIN vypořádání derivátů)', () => {
    /** Testovací kurzy (kulaté, NE skutečné) — stejný vzor jako e2e.engine.test.ts. */
    const CFG: TaxYearConfig = {
      year: 2025,
      unifiedRatesByYear: { 2025: { USD: '20' } },
      limits: {
        securitiesProceedsExemption: '100000',
        cryptoProceedsExemption: '100000',
        flatTaxOtherIncome: '50000',
        employeeSideIncome: '20000',
        generalFiling: '50000',
        exemptIncomeReporting: '5000000',
        timeTestCap: { amountCzk: '40000000', appliesTo: ['SECURITIES', 'CRYPTO'] },
      },
      cryptoRules: { exemptionsAvailable: true, effectiveFrom: '2025-02-15' },
      progressiveThreshold: '1676052',
    };

    it('CFD se settlement_style=margin: engine daní rozdíl cen, ne nominál', () => {
      const csv = [
        'type,date,isin,asset_class,settlement_style,quantity,price,currency',
        'BUY,2025-03-01,CFD:US500,DERIVATIVE,margin,2,5000,USD',
        'SELL,2025-04-01,CFD:US500,DERIVATIVE,Margin,2,5150,USD',
      ].join('\n');
      const imported = parseUniversalCsv(csv);
      expect(imported.errors).toEqual([]);
      expect(imported.warnings).toEqual([]);
      // case-insensitive hodnoty se normalizují na kanonický tvar modelu
      for (const tx of imported.transactions) {
        if (tx.type !== 'BUY' && tx.type !== 'SELL') throw new Error('unreachable');
        expect(tx.settlementStyle).toBe('MARGIN');
      }

      const result = analyzeTaxYear({
        transactions: imported.transactions,
        profile: TaxpayerProfileSchema.parse({ regime: 'PAUSAL' }),
        config: CFG,
      });
      // R-12f: příjem = rozdíl 2 × (5150 − 5000) USD × kurz 20 = 6 000 Kč,
      // NE nominál uzavření 2 × 5150 × 20 = 206 000 Kč
      expect(result.derivatives.taxableIncomeCzk.toString()).toBe('6000');
      expect(result.derivatives.base10Czk.toString()).toBe('6000');
    });

    it('derivát bez settlement_style: dnešní (premium) chování + varování jednou per instrument', () => {
      const csv = [
        'type,date,isin,asset_class,quantity,price,currency',
        'BUY,2025-03-01,CFD:US500,DERIVATIVE,2,5000,USD',
        'SELL,2025-04-01,CFD:US500,DERIVATIVE,2,5150,USD',
      ].join('\n');
      const imported = parseUniversalCsv(csv);
      expect(imported.errors).toEqual([]);
      expect(imported.warnings).toHaveLength(1); // jednou per ISIN, ne per řádek
      expect(imported.warnings[0]!.message).toContain('settlement_style');

      const tx = imported.transactions[0]!;
      if (tx.type !== 'BUY') throw new Error('unreachable');
      expect(tx.settlementStyle).toBeUndefined();

      // bez sloupce zůstává dnešní chování: premium styl (nominál = cash tok)
      const result = analyzeTaxYear({
        transactions: imported.transactions,
        profile: TaxpayerProfileSchema.parse({ regime: 'PAUSAL' }),
        config: CFG,
      });
      expect(result.derivatives.taxableIncomeCzk.toString()).toBe('206000');
    });

    it('nederivátové řádky bez settlement_style nevarují; neznámá hodnota → error', () => {
      const plain = parseUniversalCsv(
        'type,date,isin,quantity,price,currency\nBUY,2025-03-01,US0378331005,10,185.50,USD',
      );
      expect(plain.warnings).toEqual([]);

      const invalid = parseUniversalCsv(
        'type,date,isin,asset_class,settlement_style,quantity,price,currency\nBUY,2025-03-01,CFD:US500,DERIVATIVE,nominal,2,5000,USD',
      );
      expect(invalid.transactions).toEqual([]);
      expect(invalid.errors[0]!.message).toContain('settlement_style');
      expect(invalid.errors[0]!.message).toContain('nominal');
    });
  });

  it('neexistující kalendářní datum se odmítne s chybou, ne tichým posunem', () => {
    const csv = [
      'type,date,settlement_date,isin,quantity,price,currency',
      'BUY,2026-02-30,,US0378331005,10,185.50,USD',
      'SELL,2026-03-05,2026-13-01,US0378331005,5,210.00,USD',
      'BUY,2026-03-05,,US0378331005,1,200.00,USD',
    ].join('\n');
    const result = parseUniversalCsv(csv);
    expect(result.transactions).toHaveLength(1);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]!.message).toContain('2026-02-30');
    expect(result.errors[1]!.message).toContain('settlement_date');
  });
});
