import { describe, expect, it } from 'vitest';
import { dedupeTransactions } from '../src';
import { decodeFioCsv, FIO_BROKER, parseFioCsv } from '../src/fio/csv';
import { encodeCp1250, FIO_FIXTURE, FIO_HEADER, FIO_SYMBOL_MAP } from './fixtures/fio';

describe('Fio e-Broker CSV parser', () => {
  it('namapuje všechny podporované typy z fixture bez chyb', () => {
    const result = parseFioCsv(FIO_FIXTURE, { symbolMap: FIO_SYMBOL_MAP });
    expect(result.broker).toBe(FIO_BROKER);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.unmappedSymbols).toEqual([]);

    // dividendy se emitují po spárování s daní — až na konci
    const types = result.transactions.map((t) => t.type);
    expect(types).toEqual([
      'DEPOSIT',
      'BUY',
      'SELL',
      'FEE',
      'INTEREST',
      'WITHDRAWAL',
      'FEE',
      'DIVIDEND',
    ]);
  });

  it('dekóduje windows-1250 (CP1250 bajty české diakritiky)', () => {
    // „Nákup" v CP1250: á = 0xE1
    expect(decodeFioCsv(Uint8Array.from([0x4e, 0xe1, 0x6b, 0x75, 0x70]))).toBe('Nákup');

    // celá fixture zakódovaná do CP1250 bajtů se dekóduje beze ztrát
    const bytes = encodeCp1250(FIO_FIXTURE);
    expect(decodeFioCsv(bytes)).toBe(FIO_FIXTURE);

    // end-to-end: binární vstup (Uint8Array i ArrayBuffer) projde parserem
    const fromBytes = parseFioCsv(bytes, { symbolMap: FIO_SYMBOL_MAP });
    expect(fromBytes.errors).toEqual([]);
    expect(fromBytes.transactions).toHaveLength(8);
    const fromBuffer = parseFioCsv(bytes.buffer as ArrayBuffer, { symbolMap: FIO_SYMBOL_MAP });
    expect(fromBuffer.transactions).toHaveLength(8);
  });

  it('BUY: ISIN z mapy, čísla s čárkou, datum s časem → ISO, poplatek v měně obchodu', () => {
    const result = parseFioCsv(FIO_FIXTURE, { symbolMap: FIO_SYMBOL_MAP });
    const buy = result.transactions.find((t) => t.type === 'BUY');
    if (!buy || buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.isin).toBe('US0378331005');
    expect(buy.ticker).toBe('AAPL');
    expect(buy.quantity.toString()).toBe('100');
    expect(buy.pricePerShare.toString()).toBe('185.5');
    expect(buy.currency).toBe('USD');
    expect(buy.fee?.amount.toString()).toBe('2.5');
    expect(buy.fee?.currency).toBe('USD');
    expect(buy.tradeDate).toBe('2024-01-10'); // „10.01.2024 14:30" → ISO
    expect(buy.settlementDate).toBeUndefined(); // dopočítá engine
  });

  it('SELL: množství kladné (směr nese type), cena za kus', () => {
    const result = parseFioCsv(FIO_FIXTURE, { symbolMap: FIO_SYMBOL_MAP });
    const sell = result.transactions.find((t) => t.type === 'SELL');
    if (!sell || sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.quantity.toString()).toBe('40');
    expect(sell.pricePerShare.toString()).toBe('210');
    expect(sell.tradeDate).toBe('2025-03-05');
  });

  it('nenamapovaný symbol: BUY/SELL se neemituje, jeden error per symbol', () => {
    const result = parseFioCsv(FIO_FIXTURE); // bez symbolMap
    expect(result.unmappedSymbols).toEqual(['AAPL']);
    // dva obchodní řádky AAPL → přesto jen jeden error pro symbol
    const isinErrors = result.errors.filter((e) => e.message.includes('doplň ISIN'));
    expect(isinErrors).toHaveLength(1);
    expect(isinErrors[0]!.message).toBe('Symbol AAPL: doplň ISIN — Fio ho neexportuje.');
    expect(result.transactions.some((t) => t.type === 'BUY' || t.type === 'SELL')).toBe(false);
    // dividenda ISIN nepotřebuje — emituje se i bez mapy
    expect(result.transactions.some((t) => t.type === 'DIVIDEND')).toBe(true);
  });

  it('dividenda + daň jako samostatné řádky téhož symbolu a data → pár 1:1', () => {
    const result = parseFioCsv(FIO_FIXTURE, { symbolMap: FIO_SYMBOL_MAP });
    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND');
    if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.isin).toBe('US0378331005');
    expect(dividend.gross.toString()).toBe('25');
    expect(dividend.withholdingTax.toString()).toBe('3.75');
    expect(dividend.currency).toBe('USD');
    expect(dividend.sourceCountry).toBe('US'); // z „…USA…" v Text FIO
    expect(dividend.date).toBe('2026-05-10');
  });

  it('nespárovaná srážková daň → warning, žádná transakce', () => {
    const csv = [FIO_HEADER, '10.05.2026;;AAPL;;;USD;;;-3,75;;;;Daň z dividendy AAPL, USA'].join(
      '\n',
    );
    const result = parseFioCsv(csv, { symbolMap: FIO_SYMBOL_MAP });
    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain('nemá párovou dividendu');
  });

  it('čísla s desetinnou čárkou a mezerami jako oddělovači tisíců', () => {
    const result = parseFioCsv(FIO_FIXTURE, { symbolMap: FIO_SYMBOL_MAP });
    const deposit = result.transactions.find((t) => t.type === 'DEPOSIT');
    if (!deposit || deposit.type !== 'DEPOSIT') throw new Error('unreachable');
    expect(deposit.amount.toString()).toBe('100000'); // „100 000,00"
    expect(deposit.currency).toBe('CZK');

    const withdrawal = result.transactions.find((t) => t.type === 'WITHDRAWAL');
    if (!withdrawal || withdrawal.type !== 'WITHDRAWAL') throw new Error('unreachable');
    expect(withdrawal.amount.toString()).toBe('20000'); // „-20 000,00"
  });

  it('Převod → DEPOSIT/WITHDRAWAL podle znaménka částky', () => {
    const csv = [
      FIO_HEADER,
      '02.01.2024;Převod;;;;CZK;5 000,00;;;;;;Převod na účet',
      '03.01.2024;Převod;;;;CZK;-1 000,00;;;;;;Převod z účtu',
    ].join('\n');
    const result = parseFioCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.transactions.map((t) => t.type)).toEqual(['DEPOSIT', 'WITHDRAWAL']);
  });

  it('prázdný Směr s Text FIO: záporná částka → FEE, kladná → error „nahlaš nám ho"', () => {
    const result = parseFioCsv(FIO_FIXTURE, { symbolMap: FIO_SYMBOL_MAP });
    const adrFee = result.transactions.filter((t) => t.type === 'FEE').at(-1);
    if (!adrFee || adrFee.type !== 'FEE') throw new Error('unreachable');
    expect(adrFee.amount.toString()).toBe('5');
    expect(adrFee.currency).toBe('USD');
    expect(adrFee.note).toBe('ADR Fee');

    const positive = parseFioCsv(
      [FIO_HEADER, '10.01.2024;;;;;CZK;50,00;;;;;;Kompenzace'].join('\n'),
    );
    expect(positive.transactions).toEqual([]);
    expect(positive.errors).toHaveLength(1);
    expect(positive.errors[0]!.message).toContain('nahlaš nám ho');
  });

  it('neznámý směr → error s výzvou k nahlášení; neplatné datum → error', () => {
    const unknown = parseFioCsv(
      [FIO_HEADER, '10.01.2024;Konverze;;;;CZK;-100,00;;;;;;Konverze měny'].join('\n'),
    );
    expect(unknown.transactions).toEqual([]);
    expect(unknown.errors).toHaveLength(1);
    expect(unknown.errors[0]!.line).toBe(2);
    expect(unknown.errors[0]!.message).toContain('Neznámý směr „Konverze"');
    expect(unknown.errors[0]!.message).toContain('nahlaš nám ho');

    const badDate = parseFioCsv(
      [FIO_HEADER, '2024-01-10;Vloženo;;;;CZK;100,00;;;;;;Vklad'].join('\n'),
    );
    expect(badDate.errors).toHaveLength(1);
    expect(badDate.errors[0]!.message).toContain('Neplatné datum');
  });

  it('varianta exportu bez měnových sloupců: mapování dle hlaviček, chybějící poplatek → warning', () => {
    const reduced = [
      'Datum obchodu;Směr;Symbol;Cena;Počet;Měna;Objem v CZK;Poplatky v CZK;Text FIO',
      '10.01.2024;Nákup;CEZ;950,00;10;CZK;-9 500,00;-40,00;Nákup: CEZ',
      '11.01.2024;Nákup;AAPL;185,50;10;USD;-42 000,00;-55,00;Nákup: AAPL',
      '12.01.2024;Nákup;AAPL;185,50;10;USD;;;Nákup: AAPL bez poplatku',
    ].join('\n');
    const result = parseFioCsv(reduced, {
      symbolMap: { ...FIO_SYMBOL_MAP, CEZ: { isin: 'CZ0005112300' } },
    });
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(3);

    const [cez, aaplCzkFee, aaplNoFee] = result.transactions;
    if (cez?.type !== 'BUY' || aaplCzkFee?.type !== 'BUY' || aaplNoFee?.type !== 'BUY')
      throw new Error('unreachable');
    expect(cez.fee?.amount.toString()).toBe('40');
    expect(cez.fee?.currency).toBe('CZK');
    // USD obchod, poplatek jen ve sloupci CZK → poplatek v CZK (žádná ztráta dat)
    expect(aaplCzkFee.fee?.amount.toString()).toBe('55');
    expect(aaplCzkFee.fee?.currency).toBe('CZK');
    // USD obchod bez poplatku a bez sloupce „Poplatky v USD" → poplatek 0 + warning
    expect(aaplNoFee.fee).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.line).toBe(4);
    expect(result.warnings[0]!.message).toContain('Poplatky v USD');
  });

  it('id jsou idempotentní mezi opakovanými importy (dedupe)', () => {
    const first = parseFioCsv(FIO_FIXTURE, { symbolMap: FIO_SYMBOL_MAP }).transactions;
    const second = parseFioCsv(FIO_FIXTURE, { symbolMap: FIO_SYMBOL_MAP }).transactions;
    expect(second.map((t) => t.id)).toEqual(first.map((t) => t.id));

    const initial = dedupeTransactions(FIO_BROKER, first);
    expect(initial.fresh).toHaveLength(8);
    expect(initial.duplicates).toBe(0);

    const repeated = dedupeTransactions(FIO_BROKER, [...first, ...second]);
    expect(repeated.fresh).toHaveLength(8);
    expect(repeated.duplicates).toBe(8);
  });

  it('identické legitimní řádky dostanou pořadový suffix — zůstávají dvě transakce', () => {
    const csv = [
      FIO_HEADER,
      '30.06.2025;Úrok;;;;CZK;12,34;;;;;;Úrok z hotovosti',
      '30.06.2025;Úrok;;;;CZK;12,34;;;;;;Úrok z hotovosti',
    ].join('\n');
    const result = parseFioCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(2);
    const [a, b] = result.transactions;
    expect(a!.id).not.toBe(b!.id);
    expect(b!.id).toBe(`${a!.id}-2`);
    // stejný soubor podruhé → stejné id včetně suffixů → dedupe je sloučí
    const again = parseFioCsv(csv).transactions;
    expect(dedupeTransactions(FIO_BROKER, [...result.transactions, ...again]).fresh).toHaveLength(
      2,
    );
  });

  it('prázdný soubor a soubor bez Fio hlaviček → error', () => {
    const empty = parseFioCsv('');
    expect(empty.errors).toHaveLength(1);
    expect(empty.errors[0]!.message).toContain('prázdný');

    const foreign = parseFioCsv('foo;bar\n1;2');
    expect(foreign.errors).toHaveLength(1);
    expect(foreign.errors[0]!.message).toContain('nevypadá jako export z Fio e-Brokeru');
  });

  it('obchod bez počtu/ceny/měny → error řádek (žádné tiché přeskočení)', () => {
    const broken = parseFioCsv(
      [FIO_HEADER, '10.01.2024;Nákup;AAPL;;;USD;;;;;;;Nákup bez počtu'].join('\n'),
      { symbolMap: FIO_SYMBOL_MAP },
    );
    expect(broken.transactions).toEqual([]);
    expect(broken.errors).toHaveLength(1);
    expect(broken.errors[0]!.message).toContain('chybí symbol, počet kusů, cena nebo měna');
  });
});
