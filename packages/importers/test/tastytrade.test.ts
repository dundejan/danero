import type { Transaction } from '@danero/shared';
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
  TASTY_V2_DIVIDEND_ONLY,
  TASTY_V2_DIVIDEND_THEN_BUY,
  TASTY_V2_FUTURE,
  TASTY_V2_HEADER,
  TASTY_V2_ORPHAN_EXPIRATION,
  TASTY_V2_TOTAL,
  TASTY_V2_TOTAL_HEADER,
  TASTY_V2_UNKNOWN_MOVEMENT,
  TASTY_V2_UNMAPPED,
  TASTY_V2_UNMATCHED_TAX,
  TASTY_V2_ZONE_EXPORTS,
  TASTY_YTD,
  tastyInterestAt,
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

  it('happy path: 9 transakcí bez chyb, vklad vědomě přeskočený, ICSH nabídnutý k doplnění ISIN', () => {
    expect(result.broker).toBe(TASTYTRADE_BROKER);
    expect(result.errors).toEqual([]);
    // L23-03: ICSH má ve výpisu jen dividendu a v číselníku záměrně chybí —
    // jediné varování je nabídka k doplnění ISIN (u řádku s kladnou dividendou)
    expect(result.unmappedSymbols).toEqual(['ICSH']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.line).toBe(10);
    expect(result.warnings[0]!.message).toContain('Symbol ICSH: doplň ISIN');
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
    expect(dividend.isin).toBeUndefined(); // ICSH není v mapě — dividenda se uloží i tak
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

  it('nepodporovaný instrument (Future, holé BUY/SELL) → warning + skip, žádná chyba', () => {
    const result = parseTastytradeCsv(TASTY_V2_FUTURE);
    expect(result.transactions).toEqual([]);
    // dřív „Neznámý směr obchodu „BUY““ — k varování o instrumentu řádek nedošel
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(2);
    for (const warning of result.warnings) {
      expect(warning.message).toContain('Instrument „Future“ (/ESM4) zatím nepodporujeme');
      expect(warning.message).toContain('univerzální šablon');
    }
  });

  it('holé BUY/SELL u akcie → obyčejný nákup a prodej bez značky shortu (R-13)', () => {
    const csv = [
      TASTY_V2_HEADER,
      '2024-05-09T15:00:00+0200,Trade,Sell,SELL,SCHG,Equity,Sold 2 SCHG @ 101.00,202.00,2,101.00,--,-0.03,,,,,,,123459,USD',
      '2024-05-02T15:00:00+0200,Trade,Buy,BUY,SCHG,Equity,Bought 2 SCHG @ 99.00,-198.00,2,-99.00,--,-0.02,,,,,,,123458,USD',
    ].join('\n');
    const result = parseTastytradeCsv(csv, TASTY_INSTRUMENT_MAP);

    expect(result.errors).toEqual([]);
    expect(result.transactions.map((t) => t.type)).toEqual(['BUY', 'SELL']);
    for (const tx of result.transactions) {
      if (tx.type !== 'BUY' && tx.type !== 'SELL') throw new Error('čekáme obchod');
      expect(tx.positionEffect).toBeUndefined();
    }
  });

  it('Action, která směr nenese, zůstává chybou s doslovným zněním', () => {
    const csv = [
      TASTY_V2_HEADER,
      '2024-05-02T15:00:00+0200,Trade,Swap,SWAP,SCHG,Equity,Swap 2 SCHG,0.00,2,0.00,--,0.00,,,,,,,123460,USD',
    ].join('\n');
    const result = parseTastytradeCsv(csv, TASTY_INSTRUMENT_MAP);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('Neznámý směr obchodu „SWAP“');
  });

  it('směr se čte jen z celého slova BUY/SELL — BUYX ani SELLOUT obchod nezaloží', () => {
    // Prefix má hranici (konec hodnoty nebo podtržítko). Bez ní by se neznámá
    // hodnota Action tiše uložila jako nákup nebo prodej.
    const csv = [
      TASTY_V2_HEADER,
      '2024-05-09T15:00:00+0200,Trade,Sell,SELLOUT,SCHG,Equity,Sold 2 SCHG @ 101.00,202.00,2,101.00,--,-0.03,,,,,,,123462,USD',
      '2024-05-02T15:00:00+0200,Trade,Buy,BUYX,SCHG,Equity,Bought 2 SCHG @ 99.00,-198.00,2,-99.00,--,-0.02,,,,,,,123461,USD',
    ].join('\n');
    const result = parseTastytradeCsv(csv, TASTY_INSTRUMENT_MAP);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.find((e) => e.line === 2)?.message).toContain(
      'Neznámý směr obchodu „SELLOUT“',
    );
    expect(result.errors.find((e) => e.line === 3)?.message).toContain(
      'Neznámý směr obchodu „BUYX“',
    );
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

  // L23-03: `unmappedSymbols` se plnily jen ve větvi BUY/SELL, takže titul,
  // který má výpis jen s dividendou, se k doplnění ISIN nikdy nenabídl —
  // dividenda zůstala bez státu zdroje a uživatel neměl jak ho doplnit.
  it('L23-03: symbol jen s dividendou se nabídne k doplnění ISIN (varování, ne chyba)', () => {
    const result = parseTastytradeCsv(TASTY_V2_DIVIDEND_ONLY);

    expect(result.errors).toEqual([]);
    expect(result.unmappedSymbols).toEqual(['PEP']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.line).toBe(3);
    expect(result.warnings[0]!.message).toContain(
      'Symbol PEP: doplň ISIN — Tastytrade ho neexportuje.',
    );
    expect(result.warnings[0]!.message).toContain('nahraj výpis znovu');

    // dividenda se dál ukládá i se srážkou (ISIN u ní není povinný)
    expect(result.transactions).toHaveLength(1);
    const dividend = result.transactions[0]!;
    if (dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.isin).toBeUndefined();
    expect(dividend.ticker).toBe('PEP');
    expect(dividend.gross.toString()).toBe('12.2');
    expect(dividend.withholdingTax.toString()).toBe('1.83');
  });

  it('L23-03: symbol s ISIN v číselníku se nenabízí a dividenda ISIN dostane', () => {
    const result = parseTastytradeCsv(TASTY_V2_DIVIDEND_ONLY, { PEP: { isin: 'US7134481081' } });

    expect(result.unmappedSymbols).toEqual([]);
    expect(result.warnings).toEqual([]);
    const dividend = result.transactions[0]!;
    if (dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.isin).toBe('US7134481081');
  });

  it('L23-03: dividenda před nákupem téhož symbolu — v seznamu jednou, nákup pořád hlásí chybu', () => {
    const result = parseTastytradeCsv(TASTY_V2_DIVIDEND_THEN_BUY);

    expect(result.unmappedSymbols).toEqual(['PEP']);
    // nákup bez ISIN se zahazuje — bez chyby by zmizel tiše
    expect(result.errors.map((e) => e.message)).toEqual([
      'Symbol PEP: doplň ISIN instrumentu (Tastytrade ho neexportuje).',
    ]);
    expect(result.transactions.map((t) => t.type)).toEqual(['DIVIDEND']);
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

/**
 * L23-05: sloupec Description nese u obchodů větu o obchodu („Bought 10 AAPL
 * @ 120.50“), ne název titulu. Jako `name` se pak ukazovala v přehledu pozic
 * vedle tickeru — s počtem kusů a cenou prvního nákupu, které už neplatí.
 */
describe('L23-05: popis obchodu není název titulu', () => {
  const nameOf = (tx: Transaction): string | undefined =>
    'name' in tx ? (tx.name as string | undefined) : undefined;

  it('akcie, opce ani zánik opce nenesou jako název větu ze sloupce Description', () => {
    for (const csv of [TASTY_V2, TASTY_LEGACY]) {
      const trades = parseTastytradeCsv(csv, TASTY_INSTRUMENT_MAP).transactions.filter(
        (t) => t.type === 'BUY' || t.type === 'SELL',
      );
      expect(trades.length).toBeGreaterThan(0);
      expect(trades.map((t) => `${t.type} ${t.isin}: ${nameOf(t) ?? '—'}`)).toEqual(
        trades.map((t) => `${t.type} ${t.isin}: —`),
      );
    }
  });

  it('nákup akcie má ticker a ISIN, název prázdný — a dedupe klíč se nezměnil', () => {
    const { transactions } = parseTastytradeCsv(TASTY_LEGACY, TASTY_INSTRUMENT_MAP);
    const buy = transactions.find((t) => t.type === 'BUY' && t.isin === 'US0378331005');
    if (!buy || buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.ticker).toBe('AAPL');
    expect(buy.name).toBeUndefined();
    // klíč změřený PŘED opravou — název do otisku nevstupuje, takže už nahrané
    // řádky zůstávají při dalším importu téhož výpisu duplicitou
    const { fresh } = dedupeTransactions(TASTYTRADE_BROKER, [buy]);
    expect(fresh.map((row) => row.key)).toEqual(['tastytrade|49cbc5ee5a07a022|1']);
  });
});

/**
 * L26-03: sloupec Date nese místní čas zařízení, na kterém se export stahoval,
 * i s offsetem. Dokud se den četl z číslic, dostala tatáž událost z exportu
 * staženého jinde jiný den, a tím i jiný dedupe klíč — uložila se podruhé,
 * na přelomu roku dokonce do jiného zdaňovacího období. Den se proto bere
 * z OKAMŽIKU převedeného do jedné pevné zóny (Europe/Prague).
 */
describe('L26-03: den transakce z okamžiku, ne z číslic místního času', () => {
  const dayOf = (tx: Transaction): string =>
    tx.type === 'BUY' || tx.type === 'SELL' ? tx.tradeDate : (tx as { date: string }).date;
  const describeRows = (csv: string): string[] =>
    dedupeTransactions(TASTYTRADE_BROKER, parseTastytradeCsv(csv, TASTY_INSTRUMENT_MAP).transactions)
      .fresh.map(({ tx, key }) => `${tx.type} ${dayOf(tx)} ${key}`)
      .sort();
  // varování o časové zóně bez nabídky ICSH k doplnění ISIN (L23-03) — ta
  // s časem nesouvisí a v těchhle výpisech je vždycky
  const zoneWarnings = (csv: string) =>
    parseTastytradeCsv(csv, TASTY_INSTRUMENT_MAP).warnings.filter(
      (w) => !w.message.startsWith('Symbol ICSH: doplň ISIN'),
    );

  it('tentýž okamžik s offsetem +0100, -0500, +0400 i +0900 dá stejný den a stejný dedupe klíč', () => {
    const prague = describeRows(TASTY_V2_ZONE_EXPORTS.prague);
    // den podle českého času: úrok z 30. 6. 22:30 UTC patří v létě už na 1. 7.
    expect(prague.map((row) => row.split(' ').slice(0, 2).join(' '))).toEqual([
      'DIVIDEND 2025-12-31',
      'INTEREST 2025-07-01',
      'SELL 2025-01-15',
    ]);
    expect(describeRows(TASTY_V2_ZONE_EXPORTS.newYork)).toEqual(prague);
    expect(describeRows(TASTY_V2_ZONE_EXPORTS.dubai)).toEqual(prague);
    expect(describeRows(TASTY_V2_ZONE_EXPORTS.tokyo)).toEqual(prague);
  });

  it('export téhož období stažený v jiné zóně je při dalším importu duplicita (B-3-2)', () => {
    const stored = new Set<string>();
    const first = dedupeTransactions(
      TASTYTRADE_BROKER,
      parseTastytradeCsv(TASTY_V2_ZONE_EXPORTS.prague, TASTY_INSTRUMENT_MAP).transactions,
      stored,
    );
    expect(first.fresh).toHaveLength(3);
    for (const row of first.fresh) stored.add(row.key);

    for (const zone of ['newYork', 'dubai', 'tokyo'] as const) {
      const next = dedupeTransactions(
        TASTYTRADE_BROKER,
        parseTastytradeCsv(TASTY_V2_ZONE_EXPORTS[zone], TASTY_INSTRUMENT_MAP).transactions,
        stored,
      );
      expect({ zone, added: next.fresh.length, duplicates: next.duplicates }).toEqual({
        zone,
        added: 0,
        duplicates: 3,
      });
    }
  });

  it('exportům staženým v Česku se den ani dedupe klíč nemění (uložená data zůstávají platná)', () => {
    // hodnoty změřené PŘED opravou — kdyby se pohnuly, už nahrané řádky by se
    // při dalším importu téhož výpisu uložily podruhé
    expect(describeRows(TASTY_V2)).toEqual(
      [
        'SELL 2021-05-20 tastytrade|6d21106d2de8942c|1',
        'BUY 2021-06-18 tastytrade|306250cc92914fc4|1',
        'INTEREST 2023-11-01 tastytrade|fd510dc32b44d43d|1',
        'FEE 2023-12-01 tastytrade|9aa9ae77982370d3|1',
        'SELL 2024-07-19 tastytrade|8b149aedf0f5e6a6|1',
        'BUY 2024-08-05 tastytrade|708c40cccfd736cf|1',
        'BUY 2024-08-05 tastytrade|7d0a29063cda928f|1',
        'SELL 2024-08-16 tastytrade|8845775d2f1ef622|1',
        'DIVIDEND 2023-10-04 tastytrade|7bfb0aade1ab523b|1',
      ].sort(),
    );
    expect(describeRows(TASTY_V2_TOTAL)).toEqual(['SELL 2024-08-16 tastytrade|1c58ddf2f65fe04f|1']);
    expect(zoneWarnings(TASTY_V2_ZONE_EXPORTS.prague)).toEqual([]);
  });

  it('když se den v českém čase liší od data ve výpisu, řekne to jedním varováním s radou', () => {
    const tokyo = parseTastytradeCsv(TASTY_V2_ZONE_EXPORTS.tokyo, TASTY_INSTRUMENT_MAP);
    expect(tokyo.errors).toEqual([]);
    const tokyoWarnings = zoneWarnings(TASTY_V2_ZONE_EXPORTS.tokyo);
    expect(tokyoWarnings).toHaveLength(1);
    const warning = tokyoWarnings[0]!;
    // dividenda (řádek 2) a obchod (řádek 4); úrok vychází na stejný den
    expect(warning.line).toBe(2);
    expect(warning.message).toContain('Počet takových řádků: 2');
    expect(warning.message).toContain('„2026-01-01T07:00:00+0900“');
    expect(warning.message).toContain('2025-12-31');
    expect(warning.message).toContain('vrať zpět');
    expect(warning.message).toContain('nahraj znovu');

    // z New Yorku se liší jen úrok krátce před půlnocí UTC
    const newYork = zoneWarnings(TASTY_V2_ZONE_EXPORTS.newYork);
    expect(newYork).toHaveLength(1);
    expect(newYork[0]!.line).toBe(3);
    expect(newYork[0]!.message).toContain('Počet takových řádků: 1');
  });

  it('letní čas řeší zóna, ne pevný posun: 22:30 UTC je v létě už další den, v zimě ne', () => {
    const dayAt = (stamp: string): string[] =>
      parseTastytradeCsv(tastyInterestAt(stamp)).transactions.map(dayOf);
    expect(dayAt('2025-07-15T22:30:00+0000')).toEqual(['2025-07-16']);
    expect(dayAt('2025-01-15T22:30:00+0000')).toEqual(['2025-01-15']);
    // noc přechodu na letní čas (30. 3. 2025 v 01:00 UTC)
    expect(dayAt('2025-03-29T22:59:59+0000')).toEqual(['2025-03-29']);
    expect(dayAt('2025-03-29T23:00:00+0000')).toEqual(['2025-03-30']);
  });

  it('offset čte i s dvojtečkou, jako Z a za zlomky sekund', () => {
    for (const stamp of [
      '2025-12-31T23:30:00+0000',
      '2025-12-31T23:30:00+00:00',
      '2025-12-31T23:30:00Z',
      '2025-12-31T23:30:00.250+0000',
      '2025-12-31T18:30:00-05:00',
    ]) {
      const result = parseTastytradeCsv(tastyInterestAt(stamp));
      expect(result.errors).toEqual([]);
      expect({ stamp, days: result.transactions.map(dayOf) }).toEqual({ stamp, days: ['2026-01-01'] });
    }
  });

  it('hodnota bez offsetu se čte jako dosud — den z číslic, bez varování', () => {
    for (const stamp of ['2025-12-31T23:30:00', '2025-12-31']) {
      const result = parseTastytradeCsv(tastyInterestAt(stamp));
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.transactions.map(dayOf)).toEqual(['2025-12-31']);
    }
  });

  it('neexistující den nebo měsíc zůstávají chybou, ne tichým posunem', () => {
    for (const stamp of ['2025-02-30T10:00:00+0100', '2025-13-01T10:00:00+0100']) {
      const result = parseTastytradeCsv(tastyInterestAt(stamp));
      expect(result.transactions).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.message).toContain(`Neplatné datum „${stamp}“`);
    }
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
