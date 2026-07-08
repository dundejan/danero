import { describe, expect, it } from 'vitest';
import { dedupeTransactions } from '../src';
import { parseXtbXlsx, XTB_BROKER } from '../src/xtb/xlsx';
import {
  buildXtbXlsx,
  XTB_HEADERS_CZ,
  XTB_INSTRUMENT_MAP,
  XTB_PREAMBLE_CZ,
  XTB_PREAMBLE_EN,
  XTB_ROWS_CZ,
  XTB_ROWS_EN,
  XTB_SHEET_CZ,
} from './fixtures/xtb';

describe('XTB XLSX parser', () => {
  it('happy path EN: všechny typy operací, hlavička nalezená pod preambulí', async () => {
    const buffer = await buildXtbXlsx({ preamble: XTB_PREAMBLE_EN, rows: XTB_ROWS_EN });
    const result = await parseXtbXlsx(buffer, XTB_INSTRUMENT_MAP);

    expect(result.broker).toBe(XTB_BROKER);
    expect(result.errors).toEqual([]);
    expect(result.unmappedSymbols).toEqual([]);
    // 9 řádků, srážková daň se slučuje do dividendy → 8 transakcí
    expect(result.transactions).toHaveLength(8);
    const types = result.transactions.map((t) => t.type).sort();
    expect(types).toEqual(
      ['BUY', 'DEPOSIT', 'DIVIDEND', 'FEE', 'FEE', 'INTEREST', 'SELL', 'WITHDRAWAL'].sort(),
    );
  });

  it('BUY: kusy a cena z komentáře, ISIN a měna z mapování, ID z XTB sloupce', async () => {
    const buffer = await buildXtbXlsx({ preamble: XTB_PREAMBLE_EN, rows: XTB_ROWS_EN });
    const result = await parseXtbXlsx(buffer, XTB_INSTRUMENT_MAP);

    const buy = result.transactions.find((t) => t.type === 'BUY');
    if (!buy || buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.id).toBe('xtb-100001');
    expect(buy.isin).toBe('US0378331005');
    expect(buy.ticker).toBe('AAPL.US');
    expect(buy.quantity.toString()).toBe('5');
    expect(buy.pricePerShare.toString()).toBe('458.65'); // hodnota za „@", ne Amount
    expect(buy.currency).toBe('USD'); // z mapování — export měnu instrumentu nemá
    expect(buy.tradeDate).toBe('2025-01-02'); // DD.MM.YYYY → ISO
  });

  it('SELL: „CLOSE BUY 5/10 @ 460.00" → zavřeno 5 kusů z 10 za 460', async () => {
    const buffer = await buildXtbXlsx({ preamble: XTB_PREAMBLE_EN, rows: XTB_ROWS_EN });
    const result = await parseXtbXlsx(buffer, XTB_INSTRUMENT_MAP);

    const sell = result.transactions.find((t) => t.type === 'SELL');
    if (!sell || sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.quantity.toString()).toBe('5');
    expect(sell.pricePerShare.toString()).toBe('460');
    expect(sell.tradeDate).toBe('2025-03-10');
  });

  it('dividenda: gross z Amount, srážka spárovaná přes symbol+den, měna z mapy + warning', async () => {
    const buffer = await buildXtbXlsx({ preamble: XTB_PREAMBLE_EN, rows: XTB_ROWS_EN });
    const result = await parseXtbXlsx(buffer, XTB_INSTRUMENT_MAP);

    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND');
    if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.isin).toBe('US0378331005');
    expect(dividend.gross.toString()).toBe('1.19');
    expect(dividend.withholdingTax.toString()).toBe('0.18');
    expect(dividend.currency).toBe('USD');
    expect(dividend.date).toBe('2025-04-15');
    expect(
      result.warnings.some((w) => w.message.includes('po přepočtu na měnu účtu')),
    ).toBe(true);
  });

  it('úrok, vklad a výběr v měně účtu detekované z preambule reportu', async () => {
    const buffer = await buildXtbXlsx({ preamble: XTB_PREAMBLE_EN, rows: XTB_ROWS_EN });
    const result = await parseXtbXlsx(buffer, XTB_INSTRUMENT_MAP);

    const interest = result.transactions.find((t) => t.type === 'INTEREST');
    if (!interest || interest.type !== 'INTEREST') throw new Error('unreachable');
    expect(interest.amount.toString()).toBe('0.42');
    expect(interest.currency).toBe('EUR');
    expect(interest.date).toBe('2025-04-30'); // Time jako JS Date z Excelu

    const deposit = result.transactions.find((t) => t.type === 'DEPOSIT');
    if (!deposit || deposit.type !== 'DEPOSIT') throw new Error('unreachable');
    expect(deposit.amount.toString()).toBe('10000');
    expect(deposit.currency).toBe('EUR');

    const withdrawal = result.transactions.find((t) => t.type === 'WITHDRAWAL');
    if (!withdrawal || withdrawal.type !== 'WITHDRAWAL') throw new Error('unreachable');
    expect(withdrawal.amount.toString()).toBe('500'); // abs ze záporného Amount
    expect(withdrawal.date).toBe('2025-06-01'); // ISO vstup

    // detekovaná měna účtu → žádný warning o EUR defaultu
    expect(result.warnings.some((w) => w.message.includes('neuvádí měnu účtu'))).toBe(false);
  });

  it('daň z úroků → FEE s poznámkou a warningem; provize → FEE', async () => {
    const buffer = await buildXtbXlsx({ preamble: XTB_PREAMBLE_EN, rows: XTB_ROWS_EN });
    const result = await parseXtbXlsx(buffer, XTB_INSTRUMENT_MAP);

    const interestTax = result.transactions.find(
      (t) => t.type === 'FEE' && t.note === 'daň z úroků stržená brokerem',
    );
    if (!interestTax || interestTax.type !== 'FEE') throw new Error('unreachable');
    expect(interestTax.amount.toString()).toBe('0.08');
    expect(result.warnings.some((w) => w.message.includes('Daň z úroků'))).toBe(true);

    const commission = result.transactions.find((t) => t.type === 'FEE' && t.id === 'xtb-100009');
    if (!commission || commission.type !== 'FEE') throw new Error('unreachable');
    expect(commission.amount.toString()).toBe('1.5');
    expect(commission.currency).toBe('EUR');
  });

  it('CZ hlavičky, CZ typy operací a CZ název listu', async () => {
    const buffer = await buildXtbXlsx({
      sheetName: XTB_SHEET_CZ,
      preamble: XTB_PREAMBLE_CZ,
      headers: XTB_HEADERS_CZ,
      rows: XTB_ROWS_CZ,
    });
    const result = await parseXtbXlsx(buffer, XTB_INSTRUMENT_MAP);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(6); // 7 řádků, srážka sloučená do dividendy

    const buy = result.transactions.find((t) => t.type === 'BUY');
    if (!buy || buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.isin).toBe('IE00B4L5Y983');
    expect(buy.quantity.toString()).toBe('10');
    expect(buy.pricePerShare.toString()).toBe('92.1');
    expect(buy.tradeDate).toBe('2025-02-05');

    const sell = result.transactions.find((t) => t.type === 'SELL');
    if (!sell || sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.quantity.toString()).toBe('4');

    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND');
    if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.gross.toString()).toBe('3.2');
    expect(dividend.withholdingTax.toString()).toBe('0.48');

    // peněžní operace v měně účtu z CZ preambule („Měna účtu CZK")
    const interest = result.transactions.find((t) => t.type === 'INTEREST');
    if (!interest || interest.type !== 'INTEREST') throw new Error('unreachable');
    expect(interest.currency).toBe('CZK');
    const deposit = result.transactions.find((t) => t.type === 'DEPOSIT');
    if (!deposit || deposit.type !== 'DEPOSIT') throw new Error('unreachable');
    expect(deposit.amount.toString()).toBe('25000');
    expect(deposit.currency).toBe('CZK');
  });

  it('symbol bez mapování → jeden error per symbol, unmappedSymbols, žádná transakce', async () => {
    const buffer = await buildXtbXlsx({
      rows: [
        [1, 'Stocks/ETF purchase', '02.01.2025 10:00:00', 'OPEN BUY 2 @ 250.00', 'TSLA.US', -500],
        [2, 'Stocks/ETF sale', '03.01.2025 10:00:00', 'CLOSE BUY 2/2 @ 260.00', 'TSLA.US', 520],
        [3, 'Dividend', '04.01.2025 10:00:00', 'TSLA.US dividend', 'TSLA.US', 1],
        [4, 'Withholding tax', '04.01.2025 10:00:00', 'TSLA.US 15%', 'TSLA.US', -0.15],
      ],
    });
    const result = await parseXtbXlsx(buffer); // bez mapy

    expect(result.transactions).toEqual([]);
    expect(result.unmappedSymbols).toEqual(['TSLA.US']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toBe(
      'Symbol TSLA.US: doplň ISIN a měnu instrumentu (XTB je neexportuje).',
    );
    // srážku spotřebovala nemapovaná dividenda — žádný matoucí warning navíc
    expect(result.warnings.some((w) => w.message.includes('bez párové dividendy'))).toBe(false);
  });

  it('neznámý typ operace → error s výzvou „nahlaš nám ho"', async () => {
    const buffer = await buildXtbXlsx({
      rows: [[1, 'Stock lending payment', '02.01.2025 10:00:00', 'lending', null, 0.5]],
    });
    const result = await parseXtbXlsx(buffer);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('Stock lending payment');
    expect(result.errors[0]!.message).toContain('nahlaš nám ho');
  });

  it('prázdný list → prázdný výsledek bez chyb', async () => {
    const buffer = await buildXtbXlsx({ headers: null });
    const result = await parseXtbXlsx(buffer);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.transactions).toEqual([]);
    expect(result.unmappedSymbols).toEqual([]);
  });

  it('soubor bez listu peněžních operací → srozumitelný error', async () => {
    const buffer = await buildXtbXlsx({ sheetName: 'OPEN POSITION' });
    const result = await parseXtbXlsx(buffer);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('nevypadá jako XTB Full report');
  });

  it('report bez měny účtu → default EUR + jeden warning s vysvětlením', async () => {
    const buffer = await buildXtbXlsx({
      rows: [
        [1, 'Deposit', '02.01.2025 10:00:00', 'Bank transfer', null, 1000],
        [2, 'Free funds interest', '31.01.2025 00:00:00', 'Interest 01/2025', null, 0.2],
      ],
    });
    const result = await parseXtbXlsx(buffer);

    expect(result.errors).toEqual([]);
    const deposit = result.transactions.find((t) => t.type === 'DEPOSIT');
    if (!deposit || deposit.type !== 'DEPOSIT') throw new Error('unreachable');
    expect(deposit.currency).toBe('EUR');
    const eurWarnings = result.warnings.filter((w) => w.message.includes('neuvádí měnu účtu'));
    expect(eurWarnings).toHaveLength(1); // jen jednou, ne per řádek
  });

  it('nespárovaná srážková daň → warning, ne tiché zahození', async () => {
    const buffer = await buildXtbXlsx({
      rows: [[1, 'Withholding tax', '04.01.2025 10:00:00', 'AAPL.US 15%', 'AAPL.US', -0.15]],
    });
    const result = await parseXtbXlsx(buffer, XTB_INSTRUMENT_MAP);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.message.includes('bez párové dividendy'))).toBe(true);
  });

  it('nečitelný komentář obchodu → error, ne tichá nula', async () => {
    const buffer = await buildXtbXlsx({
      rows: [[1, 'Stocks/ETF purchase', '02.01.2025 10:00:00', 'nesmysl bez ceny', 'AAPL.US', -100]],
    });
    const result = await parseXtbXlsx(buffer, XTB_INSTRUMENT_MAP);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('nepodařilo přečíst počet kusů a cenu');
  });

  it('idempotentní ID: stejný buffer 2× → stejná ID; identické řádky bez ID rozlišené suffixem', async () => {
    const buffer = await buildXtbXlsx({
      rows: [
        [null, 'Deposit', '02.01.2025 10:00:00', 'Bank transfer', null, 1000],
        [null, 'Deposit', '02.01.2025 10:00:00', 'Bank transfer', null, 1000],
      ],
    });
    const first = await parseXtbXlsx(buffer);
    const second = await parseXtbXlsx(buffer);

    const firstIds = first.transactions.map((t) => t.id);
    expect(firstIds).toHaveLength(2);
    expect(new Set(firstIds).size).toBe(2); // suffix -2 pro identický řádek
    expect(firstIds.every((id) => id.startsWith('xtb-'))).toBe(true);
    expect(second.transactions.map((t) => t.id)).toEqual(firstIds);

    // opakovaný import = samé duplicity (deduplikace přes obsahový klíč)
    const combined = dedupeTransactions(XTB_BROKER, [
      ...first.transactions,
      ...second.transactions,
    ]);
    expect(combined.fresh).toHaveLength(2);
    expect(combined.duplicates).toBe(2);
  });

  it('opakovaný import happy-path souboru je idempotentní (XTB ID)', async () => {
    const buffer = await buildXtbXlsx({ preamble: XTB_PREAMBLE_EN, rows: XTB_ROWS_EN });
    const first = await parseXtbXlsx(buffer, XTB_INSTRUMENT_MAP);
    const second = await parseXtbXlsx(buffer, XTB_INSTRUMENT_MAP);

    const combined = dedupeTransactions(XTB_BROKER, [
      ...first.transactions,
      ...second.transactions,
    ]);
    expect(combined.fresh).toHaveLength(8);
    expect(combined.duplicates).toBe(8);
  });
});
