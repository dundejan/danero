import { describe, expect, it } from 'vitest';
import { dedupeTransactions, UNIVERSAL_TEMPLATE_CSV } from '../src';
import {
  parseTastytradeCsv,
  sniffTastytradeCsv,
  TASTYTRADE_BROKER,
} from '../src/tastytrade/csv';
import { SCHWAB_MODERN } from './fixtures/schwab';
import {
  TASTY_INSTRUMENT_MAP,
  TASTY_LEGACY,
  TASTY_V2,
  TASTY_V2_FUTURE,
  TASTY_V2_HEADER,
  TASTY_V2_ORPHAN_EXPIRATION,
  TASTY_V2_TOTAL,
  TASTY_V2_TOTAL_HEADER,
  TASTY_V2_UNKNOWN_MOVEMENT,
  TASTY_V2_UNMAPPED,
  TASTY_V2_UNMATCHED_TAX,
  TASTY_YTD,
} from './fixtures/tastytrade';

describe('sniffTastytradeCsv (autodetekce)', () => {
  it('pozná novou 20sloupcovou, 21sloupcovou i legacy hlavičku', () => {
    expect(sniffTastytradeCsv(TASTY_V2)).toBe(true);
    expect(sniffTastytradeCsv(TASTY_V2_TOTAL)).toBe(true);
    expect(sniffTastytradeCsv(TASTY_LEGACY)).toBe(true);
  });

  it('YTD daňový export vezme, aby uživatel dostal radu, a ne „nepoznáváme“', () => {
    // Parser pro tenhle soubor má připravenou přesnou hlášku („nahraj export
    // z History → Transactions“). Dokud ho autodetekce odmítala, propadl až na
    // univerzální šablonu a rada byla dosažitelná jen z unit testu.
    expect(sniffTastytradeCsv(TASTY_YTD)).toBe(true);
    const result = parseTastytradeCsv(TASTY_YTD);
    expect(result.transactions).toEqual([]);
    expect(result.errors[0]!.message).toContain('History → Transactions');
  });

  it('odmítne prázdný text a cizí formáty', () => {
    expect(sniffTastytradeCsv('')).toBe(false);
    expect(sniffTastytradeCsv(SCHWAB_MODERN)).toBe(false);
    expect(sniffTastytradeCsv(UNIVERSAL_TEMPLATE_CSV)).toBe(false);
  });
});

describe('parseTastytradeCsv — nový formát (20 sloupců)', () => {
  const result = parseTastytradeCsv(TASTY_V2, TASTY_INSTRUMENT_MAP);

  it('happy path: 9 transakcí bez chyb a varování, vklad vědomě přeskočený', () => {
    expect(result.broker).toBe(TASTYTRADE_BROKER);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.unmappedSymbols).toEqual([]);
    expect(result.transactions).toHaveLength(9);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.message).toContain('Deposit');
  });

  it('SELL_TO_OPEN opce → SELL, prémie za kontrakt = |Value| / počet, fee = |Commissions| + |Fees|', () => {
    const sell = result.transactions.find(
      (t) => t.type === 'SELL' && t.isin === 'OPT:SCHG-240920C00099000',
    );
    if (!sell || sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.assetClass).toBe('DERIVATIVE');
    expect(sell.settlementStyle).toBe('PREMIUM');
    expect(sell.quantity.toString()).toBe('1');
    expect(sell.pricePerShare.toString()).toBe('370');
    expect(sell.fee?.amount.toString()).toBe('1.15');
    expect(sell.currency).toBe('USD');
    expect(sell.ticker).toBe('SCHG');
    // datum lokálního času z ISO tvaru s offsetem bez dvojtečky (+0200)
    expect(sell.tradeDate).toBe('2024-08-16');
    expect(sell.id).toMatch(/^tasty-[0-9a-f]{16}$/);
  });

  it('assignment short putu → zánik opce jako BUY @ 0 (směr z trackeru čisté pozice)', () => {
    const removal = result.transactions.find(
      (t) => t.type === 'BUY' && t.isin === 'OPT:SCHG-240816P00103000',
    );
    if (!removal || removal.type !== 'BUY') throw new Error('unreachable');
    expect(removal.pricePerShare.toString()).toBe('0');
    expect(removal.quantity.toString()).toBe('1');
    expect(removal.note).toContain('Assignment');
    expect(removal.tradeDate).toBe('2024-08-05');
  });

  it('akciová noha assignmentu (Receive Deliver + BUY_TO_OPEN) → normální BUY akcie', () => {
    const buy = result.transactions.find((t) => t.type === 'BUY' && t.isin === 'US8085247976');
    if (!buy || buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.ticker).toBe('SCHG');
    expect(buy.quantity.toString()).toBe('100');
    expect(buy.pricePerShare.toString()).toBe('103'); // |Average Price|, kvótované tisíce ve Value
    expect(buy.fee?.amount.toString()).toBe('5'); // Commissions „--“ = 0
  });

  it('chronologický tracker: otevření short call → expirace → správně BUY @ 0', () => {
    const expired = result.transactions.find(
      (t) => t.type === 'BUY' && t.isin === 'OPT:CLNE-210618C00014000',
    );
    if (!expired || expired.type !== 'BUY') throw new Error('unreachable');
    expect(expired.pricePerShare.toString()).toBe('0');
    expect(expired.note).toContain('Expirace');
    expect(expired.tradeDate).toBe('2021-06-18');

    const opened = result.transactions.find(
      (t) => t.type === 'SELL' && t.isin === 'OPT:CLNE-210618C00014000',
    );
    if (!opened || opened.type !== 'SELL') throw new Error('unreachable');
    expect(opened.pricePerShare.toString()).toBe('95');
  });

  it('kladná dividenda + záporný řádek Dividend → gross a withholdingTax (±5 dní)', () => {
    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND');
    if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.ticker).toBe('ICSH');
    expect(dividend.isin).toBeUndefined(); // ICSH není v mapě — u dividend nevadí
    expect(dividend.gross.toString()).toBe('20.15');
    expect(dividend.withholdingTax.toString()).toBe('3.02');
    expect(dividend.date).toBe('2023-10-04');
  });

  it('Credit Interest → INTEREST, Fee → FEE (abs)', () => {
    const interest = result.transactions.find((t) => t.type === 'INTEREST');
    if (!interest || interest.type !== 'INTEREST') throw new Error('unreachable');
    expect(interest.amount.toString()).toBe('0.91');
    expect(interest.date).toBe('2023-11-01');

    const fee = result.transactions.find((t) => t.type === 'FEE');
    if (!fee || fee.type !== 'FEE') throw new Error('unreachable');
    expect(fee.amount.toString()).toBe('1');
    expect(fee.date).toBe('2023-12-01');
  });
});

describe('parseTastytradeCsv — 21sloupcová varianta (navíc Total)', () => {
  it('mapuje podle názvů sloupců, prémie = |Value| / počet kontraktů', () => {
    const result = parseTastytradeCsv(TASTY_V2_TOTAL, TASTY_INSTRUMENT_MAP);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    const sell = result.transactions[0]!;
    if (sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.quantity.toString()).toBe('2');
    expect(sell.pricePerShare.toString()).toBe('370'); // 740 / 2
    expect(sell.fee?.amount.toString()).toBe('2.3');
    expect(sell.currency).toBe('USD');
  });
});

describe('parseTastytradeCsv — legacy formát (15 sloupců)', () => {
  const result = parseTastytradeCsv(TASTY_LEGACY, TASTY_INSTRUMENT_MAP);

  it('happy path: 4 transakce bez chyb, vklad přeskočený', () => {
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.transactions).toHaveLength(4);
    expect(result.skipped).toHaveLength(1);
  });

  it('akcie: směr z Buy/Sell, datum „MM/DD/YYYY H:MM AM/PM“, cena Price, poplatek Fees', () => {
    const buy = result.transactions.find((t) => t.type === 'BUY' && t.isin === 'US0378331005');
    if (!buy || buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.ticker).toBe('AAPL');
    expect(buy.quantity.toString()).toBe('10');
    expect(buy.pricePerShare.toString()).toBe('120.5');
    expect(buy.fee?.amount.toString()).toBe('0.08');
    expect(buy.tradeDate).toBe('2021-03-02');
    expect(buy.id).toMatch(/^tasty-[0-9a-f]{16}$/);
  });

  it('opce: identifikátor z podkladu+expirace+strike+C/P, prémie za kontrakt = Price × 100', () => {
    const sell = result.transactions.find((t) => t.type === 'SELL');
    if (!sell || sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.isin).toBe('OPT:CLNE-2021-06-18-14-C');
    expect(sell.assetClass).toBe('DERIVATIVE');
    expect(sell.settlementStyle).toBe('PREMIUM');
    expect(sell.pricePerShare.toString()).toBe('95');
    expect(sell.fee?.amount.toString()).toBe('1.14');
  });

  it('expirace bez Buy/Sell → směr z trackeru (short → BUY @ 0)', () => {
    const expired = result.transactions.find(
      (t) => t.type === 'BUY' && t.isin === 'OPT:CLNE-2021-06-18-14-C',
    );
    if (!expired || expired.type !== 'BUY') throw new Error('unreachable');
    expect(expired.pricePerShare.toString()).toBe('0');
    expect(expired.tradeDate).toBe('2021-06-18');
  });

  it('Credit Interest → INTEREST v USD (legacy měnu neuvádí)', () => {
    const interest = result.transactions.find((t) => t.type === 'INTEREST');
    if (!interest || interest.type !== 'INTEREST') throw new Error('unreachable');
    expect(interest.amount.toString()).toBe('0.42');
    expect(interest.currency).toBe('USD');
  });
});

describe('parseTastytradeCsv — edge cases', () => {
  it('YTD daňový export → error s návodem na správný export', () => {
    const result = parseTastytradeCsv(TASTY_YTD);
    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toBe(
      'Nahraj export z History → Transactions (CSV), ne Year-to-Date Data Export z Tax Center.',
    );
  });

  it('zánik opce bez viditelného otevření pozice → warning, ne tichý odhad směru', () => {
    const result = parseTastytradeCsv(TASTY_V2_ORPHAN_EXPIRATION);
    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain('směr uzavření neumíme určit');
  });

  it('nepodporovaný instrument (Future) → warning + skip', () => {
    const result = parseTastytradeCsv(TASTY_V2_FUTURE);
    expect(result.transactions).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain('Future');
    expect(result.warnings[0]!.message).toContain('nepodporujeme');
  });

  it('neznámý podtyp Money Movement → error s doslovným zněním a číslem řádku', () => {
    const result = parseTastytradeCsv(TASTY_V2_UNKNOWN_MOVEMENT);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(2);
    expect(result.errors[0]!.message).toContain('Crypto Reward');
    expect(result.errors[0]!.message).toContain('nahlaš nám ho');
  });

  it('záporná dividenda bez párové kladné → warning, ne tiché zahození', () => {
    const result = parseTastytradeCsv(TASTY_V2_UNMATCHED_TAX);
    expect(result.transactions).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain('nemá dohledatelnou dividendu');
    expect(result.warnings[0]!.message).toContain('XOM');
  });

  it('nezmapovaný akciový symbol → JEDEN error + unmappedSymbols', () => {
    const result = parseTastytradeCsv(TASTY_V2_UNMAPPED);
    expect(result.transactions).toEqual([]);
    expect(result.unmappedSymbols).toEqual(['TSLA']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toBe(
      'Symbol TSLA: doplň ISIN instrumentu (Tastytrade ho neexportuje).',
    );
  });

  it('prázdný soubor → prázdný výsledek bez chyb', () => {
    const result = parseTastytradeCsv('');
    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('cizí CSV → srozumitelný error, že nejde o Tastytrade export', () => {
    const result = parseTastytradeCsv('Datum,Typ,Částka\n01.01.2024,Vklad,100');
    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('nevypadá jako Tastytrade export');
  });

  it('opakovaný parse téhož souboru → stejná id (dedupe je idempotentní)', () => {
    const first = parseTastytradeCsv(TASTY_V2, TASTY_INSTRUMENT_MAP);
    const second = parseTastytradeCsv(TASTY_V2, TASTY_INSTRUMENT_MAP);
    expect(second.transactions.map((t) => t.id)).toEqual(first.transactions.map((t) => t.id));

    const combined = dedupeTransactions(TASTYTRADE_BROKER, [
      ...first.transactions,
      ...second.transactions,
    ]);
    expect(combined.fresh).toHaveLength(9);
    expect(combined.duplicates).toBe(9);
  });

  /**
   * B-3-2: dokud se klíč počítal z otisku syrového řádku, stačilo, aby
   * Tastytrade přidal sloupec „Total" (21sloupcová generace hlavičky), a tentýž
   * obchod se při dalším importu uložil podruhé — s hlášením „0 duplicit".
   */
  it('týž obchod ve 20- i 21sloupcovém exportu je jedna transakce (B-3-2)', () => {
    const obchod =
      '2024-08-16T15:57:13+0200,Trade,Sell to Open,SELL_TO_OPEN,SCHG  240920C00099000,Equity Option,Sold 1 SCHG 09/20/24 Call 99.00 @ 3.70,370.00,1,370.00,-1.00,-0.15,100,SCHG,SCHG,9/20/24,99,CALL,337454037';
    const tvary = [
      [TASTY_V2_HEADER, `${obchod},USD`].join('\n'),
      // o generaci novější hlavička má navíc sloupec „Total“ před měnou
      [TASTY_V2_TOTAL_HEADER, `${obchod},368.85,USD`].join('\n'),
    ];

    const klice = new Set<string>();
    let ulozeno = 0;
    let duplicit = 0;
    for (const csv of tvary) {
      const parsed = parseTastytradeCsv(csv, TASTY_INSTRUMENT_MAP);
      expect(parsed.transactions).toHaveLength(1);
      const outcome = dedupeTransactions(TASTYTRADE_BROKER, parsed.transactions, klice);
      for (const row of outcome.fresh) klice.add(row.key);
      ulozeno += outcome.fresh.length;
      duplicit += outcome.duplicates;
    }

    expect(ulozeno).toBe(1);
    expect(duplicit).toBe(1);
  });
});

describe('R-13: akciový short (Tastytrade značí záměr i u akcií)', () => {
  const header =
    'Date,Type,Sub Type,Action,Symbol,Instrument Type,Description,Value,Quantity,Average Price,Commissions,Fees,Multiplier,Root Symbol,Underlying Symbol,Expiration Date,Strike Price,Call or Put,Order #,Total,Currency';
  const csv = [
    header,
    '2026-06-23T19:46:02+0200,Trade,Sell to Open,SELL_TO_OPEN,IWM,Equity,Sold 3 IWM @ 208.32,624.97,3,208.33,0.00,0.00,,,,,,,391052108,624.97,USD',
    '2026-06-24T16:30:00+0200,Trade,Buy to Close,BUY_TO_CLOSE,IWM,Equity,Bought 3 IWM @ 200.00,-600.00,3,-200.00,0.00,0.00,,,,,,,391195659,-600.00,USD',
  ].join('\n');

  it('SELL_TO_OPEN a BUY_TO_CLOSE u akcie nesou značku prodeje nakrátko', () => {
    const result = parseTastytradeCsv(csv, { IWM: { isin: 'US4642876555' } });
    expect(result.errors).toEqual([]);
    // na pořadí řádků nezáleží — rozhoduje směr obchodu
    const efekt = (type: 'BUY' | 'SELL'): string | undefined => {
      const tx = result.transactions.find((t) => t.type === type);
      if (!tx || (tx.type !== 'BUY' && tx.type !== 'SELL')) throw new Error(`chybí ${type}`);
      return tx.positionEffect;
    };
    expect(efekt('SELL')).toBe('OPEN');
    expect(efekt('BUY')).toBe('CLOSE');
  });

  it('u opcí se značka nepoužívá — ty řeší R-12 vlastní logikou', () => {
    const opce = [
      header,
      '2026-06-23T19:46:02+0200,Trade,Sell to Open,SELL_TO_OPEN,SPY   260731P00400000,Equity Option,Sold 1 SPY,310.00,1,3.10,1.00,0.14,100,SPY,SPY,2026-07-31,400.0,PUT,391052108,308.86,USD',
    ].join('\n');
    const result = parseTastytradeCsv(opce);
    expect(result.errors).toEqual([]);
    const tx = result.transactions[0]!;
    if (tx.type !== 'SELL') throw new Error('čekáme prodej');
    expect(tx.positionEffect).toBeUndefined();
    expect(tx.assetClass).toBe('DERIVATIVE');
  });
});
