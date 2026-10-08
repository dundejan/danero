import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/csv';
import { TaxpayerProfileSchema } from '@danero/shared';
import { analyzeTaxYear, type TaxYearConfig } from '@danero/engine';
import {
  parseUniversalCsv,
  UNIVERSAL_TEMPLATE_CSV,
  UNIVERSAL_TEMPLATE_EXCEL_CSV,
  UNIVERSAL_TEMPLATE_TYPES,
} from '../src';

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

  it('R-07f: u úroku se přenese i sražená daň (bez ní zápočet propadne)', () => {
    const csv = [
      'type,date,currency,amount,withholding_tax,source_country',
      'INTEREST,2025-06-01,USD,100.00,10.00,JP',
      'INTEREST,2025-07-01,USD,50.00,,GB',
    ].join('\n');
    const result = parseUniversalCsv(csv);
    expect(result.errors).toEqual([]);

    const withTax = result.transactions[0]!;
    if (withTax.type !== 'INTEREST') throw new Error('unreachable');
    expect(withTax.withholdingTax.toString()).toBe('10');
    expect(withTax.sourceCountry).toBe('JP');

    // prázdný sloupec = nula, ne chyba (většina brokerů z úroků nesráží)
    const without = result.transactions[1]!;
    if (without.type !== 'INTEREST') throw new Error('unreachable');
    expect(without.withholdingTax.toString()).toBe('0');
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
  // B-3: „1,500“ je v českém Excelu 1,5 i 1500 — dřív se čárka VŽDY brala jako
  // oddělovač tisíců, takže „0,001“ BTC skončilo jako 1 kus (tisícinásobek)
  describe('desetinná čárka v šabloně (B-3)', () => {
    const buy = (quantity: string, price = '60000'): ReturnType<typeof parseUniversalCsv> =>
      parseUniversalCsv(
        ['type,date,isin,asset_class,quantity,price,currency',
         `BUY,2025-03-01,BTC,CRYPTO,${quantity},${price},EUR`].join('\n'),
      );

    // L2c-03: vedoucí nula tisíce vylučuje (tisíce se takhle nepíšou), takže
    // čárka je jistě desetinná — původní vada B-3 byl výklad „1 kus“, ne 0,001
    it('„0,001“ se nenaimportuje jako 1 kus — vedoucí nula znamená desetinnou čárku', () => {
      const result = buy('"0,001"');
      expect(result.errors).toEqual([]);
      const tx = result.transactions[0]!;
      if (tx.type !== 'BUY') throw new Error('unreachable');
      expect(tx.quantity.toString()).toBe('0.001');
    });

    it('L2c-03: „0,125“ i „-0,125“ jsou jednoznačné, „185,125“ zůstává chybou s návodem', () => {
      const crypto = buy('"0,125"');
      expect(crypto.errors).toEqual([]);
      const tx = crypto.transactions[0]!;
      if (tx.type !== 'BUY') throw new Error('unreachable');
      expect(tx.quantity.toString()).toBe('0.125');

      // čtyři a víc číslic před čárkou tisíce být nemůžou (skupina má nejvýš tři)
      const wide = buy('1', '"61250,500"').transactions[0]!;
      if (wide.type !== 'BUY') throw new Error('unreachable');
      expect(wide.pricePerShare.toString()).toBe('61250.5');

      const price = buy('1', '"185,125"');
      expect(price.transactions).toEqual([]);
      expect(price.errors).toHaveLength(1);
      expect(price.errors[0]!.message).toContain('185,125');
      expect(price.errors[0]!.message).toContain('price');
      expect(price.errors[0]!.message).toContain('TEČKOU');
    });

    it('L2c-03: „1.500“ v souboru s desetinnými čárkami se čte dál jako 1,5, ale s varováním', () => {
      const head = 'type;date;isin;quantity;price;currency;fee';
      const mixed = parseUniversalCsv(
        [head, 'BUY;2026-02-01;US0000000001;10;61250,50;USD;1,25', 'BUY;2026-02-02;US0000000001;1.500;10;USD;'].join('\n'),
      );
      expect(mixed.errors).toEqual([]);
      const tx = mixed.transactions[1]!;
      if (tx.type !== 'BUY') throw new Error('unreachable');
      // výklad tečky se nemění — tečka je v šabloně vždy desetinná
      expect(tx.quantity.toString()).toBe('1.5');
      expect(mixed.warnings).toHaveLength(1);
      expect(mixed.warnings[0]!.line).toBe(3);
      expect(mixed.warnings[0]!.message).toContain('1.500');
      expect(mixed.warnings[0]!.message).toContain('quantity');
      expect(mixed.warnings[0]!.message).toContain('1500');

      // soubor psaný podle šablony (samé tečky) ani soubor bez rozhodujícího čísla nevaruje
      const dots = parseUniversalCsv(
        [head, 'BUY;2026-02-01;US0000000001;10;185.50;USD;1.25', 'BUY;2026-02-02;US0000000001;1.500;10;USD;'].join('\n'),
      );
      expect(dots.errors).toEqual([]);
      expect(dots.warnings).toEqual([]);
      const undecided = parseUniversalCsv(
        [head, 'BUY;2026-02-02;US0000000001;1.500;10;USD;'].join('\n'),
      );
      expect(undecided.warnings).toEqual([]);
    });

    it('nejednoznačná cena „1,500“ → chyba, ne 1500 ani 1,5', () => {
      const result = buy('1', '"1,500"');
      expect(result.transactions).toEqual([]);
      expect(result.errors[0]!.message).toContain('price');
      expect(result.errors[0]!.message).toContain('1,500');
    });

    it('jednoznačná desetinná čárka projde („1,25“ = 1.25, „0,5“ = 0.5)', () => {
      const result = buy('"0,5"', '"1,25"');
      expect(result.errors).toEqual([]);
      const tx = result.transactions[0]!;
      if (tx.type !== 'BUY') throw new Error('unreachable');
      expect(tx.quantity.toString()).toBe('0.5');
      expect(tx.pricePerShare.toString()).toBe('1.25');
    });

    it('jednoznačné tisíce projdou: „1,234.56“ i „1,234,567“ i „1.234,56“', () => {
      expect(
        (buy('1', '"1,234.56"').transactions[0] as { pricePerShare: { toString(): string } })
          .pricePerShare.toString(),
      ).toBe('1234.56');
      expect(
        (buy('1', '"1,234,567"').transactions[0] as { pricePerShare: { toString(): string } })
          .pricePerShare.toString(),
      ).toBe('1234567');
      expect(
        (buy('1', '"1.234,56"').transactions[0] as { pricePerShare: { toString(): string } })
          .pricePerShare.toString(),
      ).toBe('1234.56');
    });

    it('přísný převod platí i pro amount, withholding_tax a acquisition_price', () => {
      const dividend = parseUniversalCsv(
        ['type,date,isin,currency,amount,withholding_tax',
         'DIVIDEND,2026-05-10,US0378331005,USD,"25,000","3,750"'].join('\n'),
      );
      expect(dividend.transactions).toEqual([]);
      expect(dividend.errors[0]!.message).toContain('amount');

      const transfer = parseUniversalCsv(
        ['type,date,isin,quantity,acquisition_date,acquisition_price,acquisition_currency',
         'TRANSFER_IN,2025-05-05,US5949181045,10,2021-03-01,"240,000",USD'].join('\n'),
      );
      expect(transfer.transactions).toEqual([]);
      expect(transfer.errors[0]!.message).toContain('acquisition_price');
    });

    it('poměr splitu se převádí stejně přísně (ratio_from/ratio_to)', () => {
      const result = parseUniversalCsv(
        ['type,date,isin,subtype,ratio_from,ratio_to',
         'CORPORATE_ACTION,2024-08-31,US0378331005,SPLIT,1,"1,000"'].join('\n'),
      );
      expect(result.transactions).toEqual([]);
      expect(result.errors[0]!.message).toContain('ratio_to');
    });
  });
});

describe('R-13: prodej nakrátko v univerzální šabloně', () => {
  const radek = (type: string, effect: string, price: string): string =>
    `${type},2026-02-10,2026-02-11,US0378331005,AAPL,Apple Inc,,,${effect},100,${price},USD,1.00,USD,,,,,,,,,,`;
  const hlavicka = UNIVERSAL_TEMPLATE_CSV.split('\n')[0]!;

  it('SELL+open a BUY+close nesou značku shortu', () => {
    const result = parseUniversalCsv(
      [hlavicka, radek('SELL', 'open', '300.00'), radek('BUY', 'close', '250.00')].join('\n'),
    );
    expect(result.errors).toEqual([]);
    const efekt = (type: 'BUY' | 'SELL'): string | undefined => {
      const tx = result.transactions.find((t) => t.type === type);
      if (!tx || (tx.type !== 'BUY' && tx.type !== 'SELL')) throw new Error(`chybí ${type}`);
      return tx.positionEffect;
    };
    expect(efekt('SELL')).toBe('OPEN');
    expect(efekt('BUY')).toBe('CLOSE');
  });

  it('nesmyslná kombinace se ignoruje, ale nahlas (BUY+open je běžný nákup)', () => {
    const result = parseUniversalCsv([hlavicka, radek('BUY', 'open', '300.00')].join('\n'));
    expect(result.errors).toEqual([]);
    const tx = result.transactions[0]!;
    if (tx.type !== 'BUY') throw new Error('čekáme nákup');
    expect(tx.positionEffect).toBeUndefined();
    expect(result.warnings[0]!.message).toContain('běžný obchod');
  });

  it('překlep v position_effect skončí chybou řádku', () => {
    const result = parseUniversalCsv([hlavicka, radek('SELL', 'shrot', '300.00')].join('\n'));
    expect(result.transactions).toEqual([]);
    expect(result.errors[0]!.message).toContain('position_effect');
  });

  it('vzorová šablona se sama naparsuje bez chyb', () => {
    const result = parseUniversalCsv(UNIVERSAL_TEMPLATE_CSV);
    expect(result.errors).toEqual([]);
  });
});

describe('vzorová šablona je konzistentní tabulka', () => {
  it('každý řádek má přesně tolik polí jako hlavička', () => {
    // Čárka v české poznámce (poslední sloupec) udělá pole navíc a text se
    // rozpadne — v šabloně, kterou si uživatel stahuje, to nikdo nepozná.
    const { headers, rows } = parseCsv(UNIVERSAL_TEMPLATE_CSV);
    rows.forEach((row, index) => {
      expect(row.length, `řádek ${index + 2} (${row[0]})`).toBe(headers.length);
    });
  });
});

/**
 * L2c-01: šablonu si uživatel vyplní v českém Excelu a ten datum zapíše
 * podle místního nastavení (10.06.2024). Středník a desetinnou čárku parser
 * kvůli téže cestě bere už dřív — datum bylo jediný krok, který chyběl,
 * a hláška radila ISO tvar, který Excel při uložení zase přepíše.
 */
describe('L2c-01: šablona uložená v českém Excelu', () => {
  const toCzechExcel = (csv: string): string => {
    const { headers, rows } = parseCsv(csv);
    const date = (v: string): string => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      return m ? `${m[3]}.${m[2]}.${m[1]}` : v;
    };
    const number = (v: string): string => (/^-?\d+\.\d+$/.test(v) ? v.replace('.', ',') : v);
    const quote = (v: string): string => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    return [headers, ...rows]
      .map((row) => row.map((cell) => quote(number(date(cell)))).join(';'))
      .join('\r\n');
  };

  it('středník, tečková data a desetinná čárka: 17 transakcí a 0 chyb, stejné jako originál', () => {
    const excel = toCzechExcel(UNIVERSAL_TEMPLATE_CSV);
    expect(excel.split('\r\n')[1]).toContain('BUY;10.06.2024;12.06.2024;');
    const result = parseUniversalCsv(excel);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(17);

    const original = parseUniversalCsv(UNIVERSAL_TEMPLATE_CSV);
    // id je otisk syrového řádku (liší se oddělovačem), obsah musí být totožný
    const strip = (txs: typeof result.transactions): unknown[] =>
      JSON.parse(JSON.stringify(txs.map((tx) => ({ ...tx, id: '' })))) as unknown[];
    expect(strip(result.transactions)).toEqual(strip(original.transactions));
  });

  it('ručně psané české datum se uloží jako ISO ve všech třech datumových sloupcích', () => {
    const head = 'type,date,settlement_date,isin,quantity,price,currency,acquisition_date,acquisition_price,acquisition_currency';
    const result = parseUniversalCsv(
      [
        head,
        'BUY,1.2.2026,3. 2. 2026,US0000000001,10,100,USD,,,',
        'TRANSFER_IN,05.05.2025,,US0000000002,4,,,1.3.2021,240,USD',
      ].join('\n'),
    );
    expect(result.errors).toEqual([]);
    const [buy, transfer] = result.transactions;
    if (buy?.type !== 'BUY' || transfer?.type !== 'TRANSFER_IN') throw new Error('unreachable');
    expect(buy.tradeDate).toBe('2026-02-01');
    expect(buy.settlementDate).toBe('2026-02-03');
    expect(transfer.date).toBe('2025-05-05');
    expect(transfer.acquisition?.date).toBe('2021-03-01');
  });

  it('neexistující den, lomítka a neúplný ISO tvar dál končí chybou, která jmenuje oba tvary', () => {
    for (const value of ['30.02.2026', '1/2/2026', '2026-2-1', '1.2.26', '1.2.2026 10:00']) {
      const result = parseUniversalCsv(
        ['type,date,isin,quantity,price,currency', `BUY,${value},US0000000001,10,100,USD`].join('\n'),
      );
      expect(result.transactions, value).toEqual([]);
      expect(result.errors, value).toHaveLength(1);
      expect(result.errors[0]!.message).toContain(value);
      expect(result.errors[0]!.message).toContain('RRRR-MM-DD');
      expect(result.errors[0]!.message).toContain('D.M.RRRR');
    }
  });
});

/**
 * L2c-05: co člověk do šablony opíše z výpisu („1 250 Kč“, „$185.50“, „czk“).
 * Hláška má být česká věta se jménem sloupce a hodnotou — ne výpis knihovny.
 */
describe('L2c-05: lidské hlášky u čísel a měn', () => {
  const head = 'type,date,isin,quantity,price,currency,fee,fee_currency,amount';
  const parseRow = (line: string): ReturnType<typeof parseUniversalCsv> =>
    parseUniversalCsv(`${head}\n${line}`);

  it('měna malými písmeny je táž měna (currency, fee_currency, acquisition_currency)', () => {
    const buy = parseRow('BUY,2026-02-01,CZ0000000001,10,100,czk,2,eur,');
    expect(buy.errors).toEqual([]);
    const tx = buy.transactions[0]!;
    if (tx.type !== 'BUY') throw new Error('unreachable');
    expect(tx.currency).toBe('CZK');
    expect(tx.fee?.currency).toBe('EUR');

    const transfer = parseUniversalCsv(
      ['type,date,isin,quantity,acquisition_date,acquisition_price,acquisition_currency',
       'TRANSFER_IN,2025-05-05,US0000000002,4,2021-03-01,240,usd'].join('\n'),
    );
    expect(transfer.errors).toEqual([]);
    const moved = transfer.transactions[0]!;
    if (moved.type !== 'TRANSFER_IN') throw new Error('unreachable');
    expect(moved.acquisition?.currency).toBe('USD');
  });

  const cases: Array<[label: string, line: string, column: string, value: string]> = [
    ['cena se značkou měny', 'BUY,2026-02-01,CZ0000000001,10,1 250 Kč,CZK,,,', 'price', '1 250 Kč'],
    ['cena s dolarem', 'BUY,2026-02-01,US0000000001,10,$185.50,USD,,,', 'price', '$185.50'],
    ['poplatek s textem', 'BUY,2026-02-01,US0000000001,10,100,USD,2 USD,,', 'fee', '2 USD'],
    ['měna značkou', 'BUY,2026-02-01,CZ0000000001,10,100,Kč,,,', 'currency', 'Kč'],
    ['měna poplatku značkou', 'BUY,2026-02-01,US0000000001,10,100,USD,1,$,', 'fee_currency', '$'],
    ['částka úroku s měnou', 'INTEREST,2026-02-01,,,,CZK,,,12 Kč', 'amount', '12 Kč'],
  ];
  it.each(cases)('%s → česká věta se sloupcem a hodnotou', (_label, line, column, value) => {
    const result = parseRow(line);
    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    const message = result.errors[0]!.message;
    expect(message).toContain(column);
    expect(message).toContain(`„${value}“`);
    expect(message).not.toContain('DecimalError');
    expect(message).not.toContain('"code"');
  });

  it('selhání validace vypíše sloupec šablony a českou zprávu, ne JSON knihovny', () => {
    const negative = parseRow('SELL,2026-02-01,US0000000001,-10,100,USD,,,');
    expect(negative.transactions).toEqual([]);
    expect(negative.errors[0]!.message).toContain('quantity');
    expect(negative.errors[0]!.message).toContain('musí být kladná');

    // prázdné povinné pole: chybějící množství, cena, měna i ISIN
    const empty = parseRow('BUY,2026-02-01,,,,,,,');
    expect(empty.transactions).toEqual([]);
    for (const column of ['isin', 'quantity', 'price', 'currency']) {
      expect(empty.errors[0]!.message).toContain(column);
    }
    const dividend = parseRow('DIVIDEND,2026-02-01,US0000000001,,,USD,,,');
    expect(dividend.errors[0]!.message).toContain('amount');

    // výčet má v knihovně jen anglickou zprávu — nahrazuje ji věta s povolenými hodnotami
    const assetClass = parseUniversalCsv(
      ['type,date,isin,asset_class,quantity,price,currency', 'BUY,2026-02-01,US0000000001,akcie,1,10,USD'].join('\n'),
    );
    expect(assetClass.transactions).toEqual([]);
    expect(assetClass.errors[0]!.message).toContain('asset_class');
    expect(assetClass.errors[0]!.message).toContain('povolené: STOCK, ETF');

    for (const result of [negative, empty, dividend, assetClass]) {
      const message = result.errors[0]!.message;
      expect(message).not.toContain('DecimalError');
      expect(message).not.toContain('"code"');
      expect(message).not.toMatch(/Invalid|expected|received/);
    }
  });
});

/**
 * L2c-08: docs/06 se označuje za popis formátu a sadu nadepisuje „Úplná sada
 * sloupců“ — hlavička v dokumentu proto musí být táž jako ve stažitelné šabloně.
 */
describe('L2c-08: docs/06 popisuje tutéž sadu sloupců jako šablona', () => {
  const doc = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', '06-import.md'),
    'utf8',
  );

  it('hlavička v docs/06 je shodná s hlavičkou šablony', () => {
    const header = UNIVERSAL_TEMPLATE_CSV.split('\n')[0]!;
    expect(doc).toContain(`\`\`\`csv\n${header}\n\`\`\``);
  });

  it('každý sloupec šablony má v docs/06 výklad', () => {
    const section = doc.slice(doc.indexOf('## Univerzální šablona'), doc.indexOf('## Ověření na reálných datech'));
    const explained = section.slice(section.indexOf('```', section.indexOf('```csv') + 6));
    for (const column of UNIVERSAL_TEMPLATE_CSV.split('\n')[0]!.split(',')) {
      expect(explained, column).toContain(column);
    }
  });
});

/**
 * K6a-14: šablona neměla sloupec pro vratku kapitálu, takže uživatel Schwabu
 * nebo Degira neměl jak přepínač `returnOfCapitalReducesBasis` využít, i když
 * mu ho R-07h nabízí. Příznak zavádějí jen parsery T212 a IBKR a dopočítat ho
 * zpětně nejde — kanonický model si původní popis řádku nedrží.
 */
describe('R-07h: vratka kapitálu v univerzální šabloně', () => {
  const radek = (hodnota: string) =>
    [
      'type,date,isin,ticker,amount,currency,withholding_tax,return_of_capital',
      `DIVIDEND,2026-07-15,IE00B4L5Y983,IWDA,40.00,USD,0,${hodnota}`,
    ].join('\n');

  it('„ano“ označí výplatu jako vratku kapitálu', () => {
    const result = parseUniversalCsv(radek('ano'));
    expect(result.errors).toEqual([]);
    const tx = result.transactions[0]!;
    expect(tx.type).toBe('DIVIDEND');
    expect((tx as { returnOfCapital?: boolean }).returnOfCapital).toBe(true);
  });

  it('prázdné pole i „ne“ nechají běžnou dividendu', () => {
    for (const hodnota of ['', 'ne', 'no', 'false']) {
      const tx = parseUniversalCsv(radek(hodnota)).transactions[0]!;
      // model má `.default(false)`, takže „nevratka“ je false, ne undefined
      expect((tx as { returnOfCapital?: boolean }).returnOfCapital).toBe(false);
    }
  });

  it('anglické varianty se berou taky', () => {
    for (const hodnota of ['yes', 'true', '1', 'ANO']) {
      const tx = parseUniversalCsv(radek(hodnota)).transactions[0]!;
      expect((tx as { returnOfCapital?: boolean }).returnOfCapital).toBe(true);
    }
  });

  it('nesrozumitelná hodnota skončí chybou řádku, ne tichým „ne“', () => {
    const result = parseUniversalCsv(radek('mozna'));
    expect(result.transactions).toHaveLength(0);
    expect(result.errors[0]!.message).toContain('return_of_capital');
  });

  it('stažitelná šablona sloupec nabízí i s ukázkovým řádkem', () => {
    expect(UNIVERSAL_TEMPLATE_CSV.split('\n')[0]).toContain('return_of_capital');
    const result = parseUniversalCsv(UNIVERSAL_TEMPLATE_CSV);
    expect(result.errors).toEqual([]);
    const vratky = result.transactions.filter(
      (tx) => (tx as { returnOfCapital?: boolean }).returnOfCapital === true,
    );
    expect(vratky).toHaveLength(1);
  });
});

/**
 * L2c-02: šablonu si uživatel otevře dvojklikem v českém Excelu. Čárkové CSV
 * bez BOM se tam celé nasype do sloupce A a čeština v poznámkách se rozbije
 * (změřeno ve skutečném Excelu; samotný BOM spraví jen diakritiku). Ke stažení
 * proto jde tvar se středníkem, BOM a desetinnou čárkou — a musí to být pořád
 * TATÁŽ šablona, jen jinak zapsaná.
 */
describe('L2c-02: šablona ke stažení se otevře v českém Excelu', () => {
  const BOM = '\uFEFF';
  const strip = (txs: unknown[]): unknown[] =>
    JSON.parse(JSON.stringify(txs.map((tx) => ({ ...(tx as object), id: '' })))) as unknown[];
  const original = parseUniversalCsv(UNIVERSAL_TEMPLATE_CSV);

  it('začíná BOM a sloupce dělí středník (jinak Excel všechno nasype do sloupce A)', () => {
    expect(UNIVERSAL_TEMPLATE_EXCEL_CSV.startsWith(BOM)).toBe(true);
    const header = UNIVERSAL_TEMPLATE_EXCEL_CSV.slice(1).split('\n')[0]!;
    expect(header.split(';')).toEqual(UNIVERSAL_TEMPLATE_CSV.split('\n')[0]!.split(','));
    // řádek „sep=“ by Excel sice poslechl, ale naše autodetekce by ho četla jako hlavičku
    expect(UNIVERSAL_TEMPLATE_EXCEL_CSV).not.toMatch(/sep=/i);
  });

  it('každý řádek má tolik polí jako hlavička (středník v poznámce je v uvozovkách)', () => {
    const { headers, rows } = parseCsv(UNIVERSAL_TEMPLATE_EXCEL_CSV, ';');
    expect(rows).toHaveLength(17);
    rows.forEach((row, index) => {
      expect(row.length, `řádek ${index + 2} (${row[0]})`).toBe(headers.length);
    });
  });

  it('čísla píše s desetinnou čárkou — tu český Excel načte jako číslo, tečku ne', () => {
    const { headers, rows } = parseCsv(UNIVERSAL_TEMPLATE_EXCEL_CSV, ';');
    const numeric = ['quantity', 'price', 'fee', 'amount', 'withholding_tax', 'ratio_from', 'ratio_to', 'acquisition_price'];
    let withComma = 0;
    for (const row of rows) {
      for (const column of numeric) {
        const cell = row[headers.indexOf(column)]!;
        expect(cell, `${row[0]} · ${column}`).toMatch(/^(\d+(,\d+)?)?$/);
        // „1,500“ parser odmítá jako nejednoznačné — v šabloně takové číslo být nesmí
        expect(cell, `${row[0]} · ${column}`).not.toMatch(/,\d{3}$/);
        if (cell.includes(',')) withComma += 1;
      }
    }
    expect(withComma).toBeGreaterThan(5);
  });

  it('parser ji přečte beze změny: 17 transakcí, 0 chyb, 0 varování a stejný obsah jako čárková šablona', () => {
    const result = parseUniversalCsv(UNIVERSAL_TEMPLATE_EXCEL_CSV);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.transactions).toHaveLength(17);
    expect(strip(result.transactions)).toEqual(strip(original.transactions));
  });

  it('a přečte ji i po uložení z českého Excelu (tečková data, čísla bez koncových nul, bez BOM)', () => {
    const { headers, rows } = parseCsv(UNIVERSAL_TEMPLATE_EXCEL_CSV, ';');
    const date = (v: string): string => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      return m ? `${m[3]}.${m[2]}.${m[1]}` : v;
    };
    const number = (v: string): string => (/^\d+,\d+$/.test(v) ? v.replace(/,?0+$/, '') : v);
    const quote = (v: string): string => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const saved = [headers, ...rows]
      .map((row) => row.map((cell) => quote(number(date(cell)))).join(';'))
      .join('\r\n');
    expect(saved).toContain('BUY;10.06.2024;12.06.2024;US0378331005;AAPL;Apple Inc;;;;10;185,5;USD;1;USD;');

    const result = parseUniversalCsv(saved);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(17);
    expect(strip(result.transactions)).toEqual(strip(original.transactions));
  });

  it('seznam povolených typů je ten, který parser opravdu bere', () => {
    expect(UNIVERSAL_TEMPLATE_TYPES.length).toBeGreaterThanOrEqual(10);
    for (const type of UNIVERSAL_TEMPLATE_TYPES) {
      const result = parseUniversalCsv(`type,date\n${type},2026-01-05`);
      const messages = result.errors.map((error) => error.message).join(' ');
      expect(messages, type).not.toContain('Neznámý typ');
    }
    expect(parseUniversalCsv('type,date\nGIFT,2026-01-05').errors[0]!.message).toContain('Neznámý typ');
  });
});
