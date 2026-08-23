import { describe, expect, it } from 'vitest';
import {
  dedupeKey,
  dedupeTransactions,
  isTruncatedTrading212Export,
  parseCsv,
  parseTrading212Csv,
  sniffTrading212Csv,
  TRADING212_BROKER,
} from '../src';
import {
  T212_FIXTURE as FIXTURE,
  T212_FIXTURE_2026 as FIXTURE_2026,
  T212_HEADER as HEADER,
  T212_HEADER_2026 as HEADER_2026,
} from './fixtures/t212';

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

  // B4-1: prázdné období posílá T212 jako ÚPLNĚ prázdný soubor. Hlavička bez
  // jediného řádku je tedy useknutý přenos — parser na něm chybu nenajde, takže
  // by se rok tvářil jako „bez obchodů“ a stahování starších roků by skončilo.
  it('hlavička bez datových řádků = useknutý přenos, ne prázdné období', () => {
    expect(isTruncatedTrading212Export(HEADER)).toBe(true);
    expect(isTruncatedTrading212Export(`${HEADER}\n`)).toBe(true);
    // řez uprostřed hlavičky vypadá stejně — pořád to není prázdný rok
    expect(isTruncatedTrading212Export('Action,Time,ISIN,Tick')).toBe(true);
    // ani řez tak brzký, že se z názvů sloupců nedá nic poznat: bez tohohle by
    // takový soubor propadl jako „cizí formát“ a rok by platil za stažený
    expect(isTruncatedTrading212Export('Act')).toBe(true);
  });

  it('úplně prázdný soubor a soubor s daty se za useknutý přenos nepovažují', () => {
    expect(isTruncatedTrading212Export('')).toBe(false);
    expect(isTruncatedTrading212Export('\n\n')).toBe(false);
    expect(isTruncatedTrading212Export(FIXTURE)).toBe(false);
    // rok, ve kterém byly jen přeskočené řádky (platba kartou), transakce
    // nevydá — přesto je to kompletní export a useknutý přenos to není
    const onlySkipped = [
      HEADER,
      'Card debit,2025-02-03 10:00:00,,,,,,,,,,-250.00,CZK,,,,,,',
    ].join('\n');
    expect(parseTrading212Csv(onlySkipped).transactions).toEqual([]);
    expect(isTruncatedTrading212Export(onlySkipped)).toBe(false);
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

  it('R-07f: sražená daň u úroku se přenese; v jiné měně se nezapočte a nahlásí', () => {
    const csv = [
      HEADER,
      'Interest on cash,2025-05-01 00:00:00,,,,,,,,,,100.00,USD,10.00,USD,,EOF-IW1,,',
      'Interest on cash,2025-06-01 00:00:00,,,,,,,,,,100.00,USD,250.00,CZK,,EOF-IW2,,',
    ].join('\n');
    const result = parseTrading212Csv(csv);
    expect(result.errors).toEqual([]);

    const withTax = result.transactions[0]!;
    if (withTax.type !== 'INTEREST') throw new Error('unreachable');
    expect(withTax.withholdingTax.toString()).toBe('10');

    // jiná měna srážky než úroku: přepočet špatným kurzem by zápočet nadhodnotil
    const mismatch = result.transactions[1]!;
    if (mismatch.type !== 'INTEREST') throw new Error('unreachable');
    expect(mismatch.withholdingTax.toString()).toBe('0');
    expect(result.warnings.some((w) => w.message.includes('srážková daň v jiné měně'))).toBe(true);
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

  it('identické legitimní řádky bez ID nesplynou — pořadový suffix, dedupe zachová obě', () => {
    const duplicated = [
      HEADER,
      'Interest on cash,2025-05-01 00:00:00,,,,,,,,,,12.34,CZK,,,,,,',
      'Interest on cash,2025-05-01 00:00:00,,,,,,,,,,12.34,CZK,,,,,,',
    ].join('\n');
    const result = parseTrading212Csv(duplicated);
    expect(result.transactions).toHaveLength(2);
    const [first, second] = result.transactions;
    expect(first!.id).not.toBe(second!.id);
    expect(second!.id).toBe(`${first!.id}-2`);
    const prvni = dedupeTransactions(TRADING212_BROKER, result.transactions);
    expect(prvni.fresh).toHaveLength(2);
    // obsah je u obou řádků totožný, takže je odliší až pořadí výskytu
    expect(prvni.fresh.map((row) => row.key)).toEqual([
      dedupeKey(TRADING212_BROKER, result.transactions[0]!, 1),
      dedupeKey(TRADING212_BROKER, result.transactions[1]!, 2),
    ]);
    // opakovaný import téhož souboru zůstává idempotentní (stejné pořadí → stejné klíče)
    const again = parseTrading212Csv(duplicated);
    const existingKeys = prvni.fresh.map((row) => row.key);
    expect(
      dedupeTransactions(TRADING212_BROKER, again.transactions, existingKeys).fresh,
    ).toHaveLength(0);
  });

  it('Dividend (Return of capital): daní se konzervativně jako dividenda + varování', () => {
    const csv = [
      HEADER,
      'Dividend (Return of capital),2025-04-01 09:00:00,US0378331005,AAPL,Apple Inc,100,0.25,USD,,,,500.00,CZK,0.00,USD,,,,',
    ].join('\n');
    const result = parseTrading212Csv(csv);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]!.type).toBe('DIVIDEND');
    expect(result.warnings.some((w) => w.message.includes('vratka kapitálu'))).toBe(true);
    // varování musí říct, co je věcně správně A že to jde přepnout (R-07h)
    expect(result.warnings.some((w) => w.message.includes('nabývací cenu držených kusů'))).toBe(true);
    expect(result.warnings.some((w) => w.message.includes('Nastavení'))).toBe(true);

    // běžná dividenda varování nedostane
    const plain = parseTrading212Csv(
      [
        HEADER,
        'Dividend (Dividends paid by us corporations),2025-04-01 09:00:00,US0378331005,AAPL,Apple Inc,100,0.25,USD,,,,500.00,CZK,3.75,USD,,,,',
      ].join('\n'),
    );
    expect(plain.warnings.some((w) => w.message.includes('vratka kapitálu'))).toBe(false);
  });

  // B-11: nulové brutto s nenulovou srážkou = zápočet daně bez příjmu; dřív
  // vzniklo DIVIDEND s gross "0" úplně beze slova
  it.each([
    ['nulová cena za kus', '100', '0'],
    ['nulový počet kusů', '0', '0.25'],
  ])('dividenda s nulovým brutto (%s) → varování', (_label, shares, price) => {
    const csv = [
      HEADER,
      `Dividend (Dividends paid by us corporations),2025-04-01 09:00:00,US0378331005,AAPL,Apple Inc,${shares},${price},USD,,,,0.00,USD,1.88,USD,,,,`,
    ].join('\n');
    const result = parseTrading212Csv(csv);
    expect(result.errors).toEqual([]);
    const dividend = result.transactions[0]!;
    if (dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.gross.toString()).toBe('0');
    const warning = result.warnings.find((w) => w.message.includes('nulové brutto'));
    expect(warning).toBeDefined();
    expect(warning!.message).toContain('1.88');
  });

  it('dividenda s nulovým brutto a bez srážky → varování o chybějící částce', () => {
    const csv = [
      HEADER,
      'Dividend (Dividends paid by us corporations),2025-04-01 09:00:00,US0378331005,AAPL,Apple Inc,0,0.25,USD,,,,0.00,USD,0,USD,,,,',
    ].join('\n');
    const result = parseTrading212Csv(csv);
    expect(result.warnings.some((w) => w.message.includes('nulovou částkou'))).toBe(true);
  });

  it('duplicitní explicitní ID → varování, dedupe je sloučí (skutečný duplikát)', () => {
    const duplicated = [
      HEADER,
      'Market buy,2024-01-10 09:00:00,US0378331005,AAPL,Apple,10,185.50,USD,,,,1855.00,USD,,,,DUP-1,,',
      'Market buy,2024-01-10 09:00:00,US0378331005,AAPL,Apple,10,185.50,USD,,,,1855.00,USD,,,,DUP-1,,',
    ].join('\n');
    const result = parseTrading212Csv(duplicated);
    expect(result.transactions).toHaveLength(2);
    expect(result.warnings.some((w) => w.message.includes('stejné ID'))).toBe(true);
    expect(dedupeTransactions(TRADING212_BROKER, result.transactions).fresh).toHaveLength(1);
  });
});

/**
 * B-3-1: řez UPROSTŘED dat. Původní kontrola uměla poznat jen soubor bez
 * jediného datového řádku, takže nedostažený export prošel jako platný a rok
 * se uzavřel jako hotový — naměřeno na reálném exportu (179 446 B, 833 tx)
 * a 4 000 místech řezu: 41,3 % skončilo úplně tiše (řez na 8 207 B dal
 * 47 transakcí místo 833 s nulou chyb). Dvě obsahové kontroly posledního
 * řádku to srazily na jednotky procent a na Janových třech reálných exportech
 * nevyrobily jediný falešný poplach (98,5–99,3 % řezů zachyceno).
 */
describe('useknutý export T212 uprostřed dat (B-3-1)', () => {
  const HLAVICKA =
    'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Total,Currency (Total)';
  const RADEK =
    'Market buy,2025-03-04 10:00:00,US0378331005,AAPL,Apple,10,180.5,USD,1805,USD';

  it('poslední řádek s míň sloupci než hlavička = useknuto', () => {
    const useknuty = `${HLAVICKA}\n${RADEK}\nMarket buy,2025-03-05 10:00:00,US0378331005,AAPL,Ap`;
    expect(isTruncatedTrading212Export(useknuty)).toBe(true);
  });

  it('poslední řádek končící uvnitř uvozovky = useknuto', () => {
    const useknuty = `${HLAVICKA}\n${RADEK}\nMarket buy,2025-03-05 10:00:00,US0378331005,AAPL,"Apple Inc`;
    expect(isTruncatedTrading212Export(useknuty)).toBe(true);
  });

  it('celý soubor s plnými řádky projde bez poplachu', () => {
    expect(isTruncatedTrading212Export(`${HLAVICKA}\n${RADEK}\n${RADEK}`)).toBe(false);
    expect(isTruncatedTrading212Export(`${HLAVICKA}\n${RADEK}\n${RADEK}\n`)).toBe(false);
  });

  it('uvozovka s čárkou uvnitř názvu není useknutí', () => {
    const sCarkou = `${HLAVICKA}\nMarket buy,2025-03-04 10:00:00,US0378331005,AAPL,"Apple, Inc.",10,180.5,USD,1805,USD`;
    expect(isTruncatedTrading212Export(sCarkou)).toBe(false);
  });
});

/**
 * Regrese formátu ze srpna 2026 (nález hlášený Janem z produkce): T212
 * přejmenoval „Time“ na „Time (UTC)“ a celý import se rozbil — soubor se
 * přestal poznávat jako T212, propadl na univerzální šablonu a uživatel dostal
 * „Chybí povinný sloupec type“. Celá sada přitom svítila zeleně, protože
 * fixtury měly starý název.
 */
describe('Trading212 export 2026 (Time (UTC), merchant sloupce)', () => {
  it('fixture má stejný počet polí jako hlavička (jinak netestuje, co si myslí)', () => {
    const lines = FIXTURE_2026.split('\n');
    const columns = lines[0]!.split(',').length;
    for (const line of lines.slice(1)) {
      expect(parseCsv(`${lines[0]}\n${line}`).rows[0]).toHaveLength(columns);
    }
  });

  it('pozná se jako T212 export, ne jako univerzální šablona', () => {
    expect(sniffTrading212Csv(FIXTURE_2026)).toBe(true);
    expect(sniffTrading212Csv(HEADER_2026)).toBe(true);
  });

  it('starý název sloupce „Time“ pořád funguje', () => {
    expect(sniffTrading212Csv(FIXTURE)).toBe(true);
  });

  it('naparsuje obchody a úrok, platby kartou a cashback přeskočí', () => {
    const result = parseTrading212Csv(FIXTURE_2026);
    expect(result.errors).toEqual([]);
    expect(result.transactions.map((t) => t.type)).toEqual([
      'INTEREST',
      'BUY',
      'SELL',
      'DIVIDEND',
    ]);
    // Card debit + Spending cashback = pohyby mimo daňový výpočet CP
    expect(result.skipped).toHaveLength(2);
  });

  it('datum se vezme i z času s offsetem (+00:00)', () => {
    const result = parseTrading212Csv(FIXTURE_2026);
    const buy = result.transactions.find((t) => t.type === 'BUY')!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.tradeDate).toBe('2026-02-10');
    expect(buy.quantity.toString()).toBe('10');
    expect(buy.pricePerShare.toString()).toBe('185.5');
  });

  it('není označen za useknutý (nové sloupce jsou často prázdné)', () => {
    expect(isTruncatedTrading212Export(FIXTURE_2026)).toBe(false);
  });
});

/**
 * Přechod na nový formát nesmí nic zdvojit. T212 s přejmenováním sloupce změnil
 * i tvar ID (číslo → UUID), takže kdyby dedupe stál na ID brokera, Jan by si
 * po prvním úspěšném importu naimportoval celou historii podruhé. Stojí na
 * OTISKU OBSAHU, a tohle to hlídá.
 */
describe('starý a nový formát téhož výpisu se nezdvojí', () => {
  it('tytéž události ze starých i nových sloupců dají tytéž dedupe klíče', () => {
    // stejná data, jen hlavička a ID ve starém tvaru
    const stary = FIXTURE_2026.split('\n')
      .map((line, index) =>
        index === 0
          ? line.replace('Time (UTC)', 'Time')
          : line.replace(/019fbae1-[0-9a-f-]+|019fc06a-[0-9a-f-]+|019fbffe-[0-9a-f-]+/, (m) =>
              `EOF${m.length}`,
            ),
      )
      .join('\n');

    const novy = parseTrading212Csv(FIXTURE_2026);
    const stare = parseTrading212Csv(stary);
    expect(novy.errors).toEqual([]);
    expect(stare.errors).toEqual([]);
    expect(stare.transactions).toHaveLength(novy.transactions.length);

    // první import proběhne, druhý (v opačném tvaru) je celý duplicitní
    const prvni = dedupeTransactions(TRADING212_BROKER, stare.transactions);
    const druhy = dedupeTransactions(
      TRADING212_BROKER,
      novy.transactions,
      prvni.fresh.map((f) => f.key),
    );
    expect(prvni.fresh).toHaveLength(novy.transactions.length);
    expect(druhy.fresh).toHaveLength(0);
    expect(druhy.duplicates).toBe(novy.transactions.length);
  });
});

/**
 * B-3-10: náhrada za dividendu u zapůjčených akcií není dividenda od firmy.
 * B-3-12: „7,848“ v počtu kusů je nerozhodnutelné mezi 7848 a 7,848.
 */
describe('Trading 212: sporné řádky se nezpracují potichu', () => {
  it('Dividend manufactured payment se daní jako dividenda, ale s upozorněním', () => {
    const csv = [
      HEADER,
      'Dividend (manufactured payment),2025-09-30 12:00:00,US7134481081,PEP,PepsiCo,10,1.42,USD,,,,14.20,USD,2.13,USD,,,,',
    ].join('\n');
    const result = parseTrading212Csv(csv);
    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND');
    if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    // číslo se nemění (bezpečný směr), jen se o něm ví
    expect(dividend.gross.toString()).toBe('14.2');
    expect(result.warnings.some((w) => w.message.includes('půjčil'))).toBe(true);
  });

  it('Return of capital se označí v modelu, ať o něm ví engine (R-07h)', () => {
    const csv = [
      HEADER,
      'Dividend (Return of capital),2025-09-30 12:00:00,US7134481081,PEP,PepsiCo,10,1.42,USD,,,,14.20,USD,0,USD,,,,',
    ].join('\n');
    const result = parseTrading212Csv(csv);
    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND');
    if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    // parser jen označuje — co je daňově správně, rozhoduje engine podle přepínače
    expect(dividend.returnOfCapital).toBe(true);
    expect(dividend.gross.toString()).toBe('14.2');
    expect(result.warnings.some((w) => w.message.includes('vratka kapitálu'))).toBe(true);
  });

  it('běžná dividenda příznak vratky nemá', () => {
    const csv = [
      HEADER,
      'Dividend (Ordinary),2025-09-30 12:00:00,US7134481081,PEP,PepsiCo,10,1.42,USD,,,,14.20,USD,2.13,USD,,,,',
    ].join('\n');
    const result = parseTrading212Csv(csv);
    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND');
    if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.returnOfCapital).toBe(false);
  });

  it('běžná dividenda upozornění nedostane', () => {
    const csv = [
      HEADER,
      'Dividend (Ordinary),2025-09-30 12:00:00,US7134481081,PEP,PepsiCo,10,1.42,USD,,,,14.20,USD,2.13,USD,,,,',
    ].join('\n');
    const result = parseTrading212Csv(csv);
    expect(result.warnings.some((w) => w.message.includes('půjčil'))).toBe(false);
  });

  it('nerozhodnutelná čárka v počtu kusů se ohlásí', () => {
    const csv = [
      HEADER,
      'Market buy,2025-03-03 10:00:00,US0378331005,AAPL,Apple,"7,848",100.00,USD,,,,784800.00,USD,,,,,,',
    ].join('\n');
    const result = parseTrading212Csv(csv);
    const buy = result.transactions.find((t) => t.type === 'BUY');
    if (!buy || buy.type !== 'BUY') throw new Error('unreachable');
    // chování beze změny — jen se o nejednoznačnosti ví
    expect(buy.quantity.toString()).toBe('7848');
    expect(result.warnings.some((w) => w.message.includes('tisíckrát menší'))).toBe(true);
  });

  it('jednoznačný zápis („1,234.56“ i „12.5“) upozornění nevyvolá', () => {
    const csv = [
      HEADER,
      'Market buy,2025-03-03 10:00:00,US0378331005,AAPL,Apple,12.5,100.00,USD,,,,1250.00,USD,,,,,,',
    ].join('\n');
    const result = parseTrading212Csv(csv);
    expect(result.warnings.some((w) => w.message.includes('tisíckrát menší'))).toBe(false);
  });
});

describe('detekce nedostaženého exportu nesmí odmítat celé soubory', () => {
  const HEADER =
    'Action,Time,ISIN,Ticker,Name,Notes,ID,No. of shares,Price / share,Currency (Price / share),Total,Currency (Total)';

  it('poznámka přes dva řádky (uvozovky s novým řádkem) je v pořádku', () => {
    const csv = [
      HEADER,
      'Market buy,2025-01-02 10:00:00,US0378331005,AAPL,Apple,pozn,ord-1,1,100.00,USD,100.00,USD',
      'Market buy,2025-01-03 10:00:00,US0378331005,AAPL,Apple,"pozn. 1\npozn. 2",ord-2,1,100.00,USD,100.00,USD',
    ].join('\n');
    expect(isTruncatedTrading212Export(csv)).toBe(false);
    const parsed = parseTrading212Csv(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.transactions).toHaveLength(2);
  });

  it('uříznutá uvozovka na konci souboru se pozná dál', () => {
    const csv = [
      HEADER,
      'Market buy,2025-01-02 10:00:00,US0378331005,AAPL,Apple,pozn,ord-1,1,100.00,USD,100.00,USD',
      'Market buy,2025-01-03 10:00:00,US0378331005,AAPL,Apple,"pozn. 1',
    ].join('\n');
    expect(isTruncatedTrading212Export(csv)).toBe(true);
  });
});
