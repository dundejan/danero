import { describe, expect, it } from 'vitest';
import { dedupeTransactions } from '../src';
import { parseSaxoXlsx, SAXO_BROKER, sniffSaxoXlsx } from '../src/saxo/xlsx';
import {
  buildForeignWorkbook,
  buildSaxoWorkbook,
  buildSaxoXlsx,
  SAXO_HEADERS_DA,
  SAXO_HEADERS_EN,
  SAXO_HEADERS_UNKNOWN_LANG,
  SAXO_ROWS_DA,
  SAXO_ROWS_EN,
  SAXO_SHEET_DA,
} from './fixtures/saxo';

describe('Saxo XLSX parser', () => {
  it('happy path EN: obchody, dividenda, poplatek, úrok; vklad přeskočen', async () => {
    const buffer = await buildSaxoXlsx({ rows: SAXO_ROWS_EN });
    const result = await parseSaxoXlsx(buffer);

    expect(result.broker).toBe(SAXO_BROKER);
    expect(result.errors).toEqual([]);
    // 9 řádků: 4 obchody + dividenda + fee + interest; deposit skip, reinvestice warning+skip
    expect(result.transactions).toHaveLength(7);
    const types = result.transactions.map((t) => t.type).sort();
    expect(types).toEqual(['BUY', 'BUY', 'BUY', 'DIVIDEND', 'FEE', 'INTEREST', 'SELL'].sort());
    expect(result.skipped).toHaveLength(1);
  });

  it('BUY: kusy a cena z Eventu, poplatek dopočtený z Amount, Value Date jako vypořádání', async () => {
    const buffer = await buildSaxoXlsx({ rows: SAXO_ROWS_EN });
    const result = await parseSaxoXlsx(buffer);

    const buy = result.transactions.find((t) => t.type === 'BUY' && t.isin === 'US67066G1040');
    if (!buy || buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.quantity.toString()).toBe('3');
    expect(buy.pricePerShare.toString()).toBe('134.85');
    expect(buy.currency).toBe('USD');
    // |−405.55| − 3×134.85 = 1.00 → fee v měně instrumentu
    expect(buy.fee?.amount.toString()).toBe('1');
    expect(buy.fee?.currency).toBe('USD');
    expect(buy.tradeDate).toBe('2024-12-30'); // 30-Dec-2024 → ISO
    expect(buy.settlementDate).toBe('2024-12-31'); // Value Date
    expect(buy.ticker).toBe('NVDA:xnas');
    expect(buy.name).toBe('NVIDIA Corp.');
  });

  it('SELL: kusy×cena = Amount → žádný poplatek', async () => {
    const buffer = await buildSaxoXlsx({ rows: SAXO_ROWS_EN });
    const result = await parseSaxoXlsx(buffer);

    const sell = result.transactions.find((t) => t.type === 'SELL');
    if (!sell || sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.isin).toBe('IE00BK5BQT80');
    expect(sell.quantity.toString()).toBe('3');
    expect(sell.pricePerShare.toString()).toBe('139.74');
    expect(sell.fee).toBeUndefined(); // 3×139.74 − 419.22 = 0
    expect(sell.tradeDate).toBe('2025-01-02');
  });

  it('GBX = pence → GBP: cena/100 i dopočtený poplatek/100', async () => {
    const buffer = await buildSaxoXlsx({ rows: SAXO_ROWS_EN });
    const result = await parseSaxoXlsx(buffer);

    const gbx = result.transactions.find((t) => t.type === 'BUY' && t.isin === 'GB0005405286');
    if (!gbx || gbx.type !== 'BUY') throw new Error('unreachable');
    expect(gbx.currency).toBe('GBP');
    expect(gbx.pricePerShare.toString()).toBe('7.005'); // 700.5 pencí
    expect(gbx.fee?.amount.toString()).toBe('0.05'); // (7010 − 7005) pencí
    expect(gbx.fee?.currency).toBe('GBP');
  });

  it('stringové buňky s desetinnou čárkou: frakční kusy „Buy 1,5 @ 100,00“', async () => {
    const buffer = await buildSaxoXlsx({ rows: SAXO_ROWS_EN });
    const result = await parseSaxoXlsx(buffer);

    const fractional = result.transactions.find(
      (t) => t.type === 'BUY' && t.isin === 'IE00BK5BQT80',
    );
    if (!fractional || fractional.type !== 'BUY') throw new Error('unreachable');
    expect(fractional.quantity.toString()).toBe('1.5');
    expect(fractional.pricePerShare.toString()).toBe('100');
    expect(fractional.fee).toBeUndefined(); // -150,00 = 1,5×100,00
  });

  it('dividenda: gross z Amount, srážka 0 + JEDEN warning na dávku; reinvestice warning + skip', async () => {
    const buffer = await buildSaxoXlsx({ rows: SAXO_ROWS_EN });
    const result = await parseSaxoXlsx(buffer);

    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND');
    if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.isin).toBe('IE00B3RBWM25');
    expect(dividend.gross.toString()).toBe('1.83');
    expect(dividend.withholdingTax.toString()).toBe('0');
    expect(dividend.currency).toBe('EUR');
    expect(dividend.date).toBe('2025-04-02');

    const batchWarnings = result.warnings.filter((w) => w.message.includes('neuvádí sráženou daň'));
    expect(batchWarnings).toHaveLength(1); // jednou na dávku, ne per řádek

    // reinvestice se neimportuje, jen upozorní
    expect(result.transactions.filter((t) => t.type === 'DIVIDEND')).toHaveLength(1);
    expect(result.warnings.some((w) => w.message.includes('Reinvestice dividendy'))).toBe(true);
  });

  it('Custody Fee → FEE (abs), Interest → INTEREST, Deposit → skipped', async () => {
    const buffer = await buildSaxoXlsx({ rows: SAXO_ROWS_EN });
    const result = await parseSaxoXlsx(buffer);

    const fee = result.transactions.find((t) => t.type === 'FEE');
    if (!fee || fee.type !== 'FEE') throw new Error('unreachable');
    expect(fee.amount.toString()).toBe('3.91');
    expect(fee.currency).toBe('USD');
    expect(fee.note).toBe('Custody Fee');

    const interest = result.transactions.find((t) => t.type === 'INTEREST');
    if (!interest || interest.type !== 'INTEREST') throw new Error('unreachable');
    expect(interest.amount.toString()).toBe('1.23');
    expect(interest.currency).toBe('USD');

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.message).toContain('vklad/výběr hotovosti');
  });

  it('DA export: lokalizované hlavičky, měsíce (maj/okt), Købt/Salg, desetinné čárky', async () => {
    const buffer = await buildSaxoXlsx({
      sheetName: SAXO_SHEET_DA,
      headers: SAXO_HEADERS_DA,
      rows: SAXO_ROWS_DA,
    });
    const result = await parseSaxoXlsx(buffer);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(2);

    const buy = result.transactions.find((t) => t.type === 'BUY');
    if (!buy || buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.isin).toBe('DK0062498333');
    expect(buy.quantity.toString()).toBe('2.5');
    expect(buy.pricePerShare.toString()).toBe('615.2');
    expect(buy.currency).toBe('DKK');
    expect(buy.fee?.amount.toString()).toBe('2.5'); // 1540,50 − 2,5×615,20
    expect(buy.tradeDate).toBe('2025-05-14'); // 14-maj-2025

    const sell = result.transactions.find((t) => t.type === 'SELL');
    if (!sell || sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.fee?.amount.toString()).toBe('1'); // 700 − 699
    expect(sell.tradeDate).toBe('2025-10-10'); // 10-okt-2025

    // Kontantoverførsel + Indbetaling = vklad → skipped
    expect(result.skipped).toHaveLength(1);
  });

  it('neznámý jazyk hlaviček → error s výzvou přepnout na angličtinu', async () => {
    const buffer = await buildSaxoXlsx({
      headers: SAXO_HEADERS_UNKNOWN_LANG,
      rows: [['', '02-Jan-2025', '02-Jan-2025', 'Trade', 'X', 'US0000000000', 'USD', '', 'X:x', 'Buy 1 @ 1', -1, '', 1]],
    });
    const result = await parseSaxoXlsx(buffer);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toBe(
      'Export ze Saxo má hlavičky v jazyce, který zatím neumíme — přepni si v SaxoTraderGO jazyk na angličtinu a stáhni export znovu.',
    );
  });

  it('neznámý Event u Cash amount → error s doslovným zněním', async () => {
    const buffer = await buildSaxoXlsx({
      rows: [['', '02-Jan-2025', '02-Jan-2025', 'Cash amount', '', '', 'USD', '', '', 'Bond refund', 12.5, '', 1]],
    });
    const result = await parseSaxoXlsx(buffer);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('Bond refund');
    expect(result.errors[0]!.message).toContain('nahlaš nám');
  });

  it('neznámý Type → error s doslovným zněním; jiná korporátní akce → warning + skip', async () => {
    const buffer = await buildSaxoXlsx({
      rows: [
        ['', '02-Jan-2025', '02-Jan-2025', 'Security Transfer', '', '', 'USD', '', '', 'Transfer in', 0, '', 1],
        ['', '03-Jan-2025', '03-Jan-2025', 'Corporate action', 'ACME', 'US0000000001', 'USD', '', 'ACME:xnas', 'Stock split', 0, '', 1],
      ],
    });
    const result = await parseSaxoXlsx(buffer);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('Security Transfer');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain('Stock split');
  });

  /**
   * B-3-8: poplatek se dopočítával jako |Amount| − kusy×cena bez ohledu na to,
   * že Amount může být v měně ÚČTU. Doložený případ: `Buy 3 @ 134.85 USD`,
   * Amount −2 903,75, Conversion Rate 0,13966 → poplatek 2 499,20 USD na
   * obchodu za 404,55 USD (6× hodnota obchodu) a `errors=0`.
   */
  it('částka v měně účtu: poplatek se přepočte kurzem, ne aby přerostl obchod (B-3-8)', async () => {
    const buffer = await buildSaxoXlsx({
      rows: [
        ['', '30-Dec-2024', '31-Dec-2024', 'Trade', 'NVIDIA Corp.', 'US67066G1040', 'USD', 'NASDAQ', 'NVDA:xnas', 'Buy 3 @ 134.85 USD', -2903.75, '', 0.13966],
      ],
    });
    const result = await parseSaxoXlsx(buffer);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    // 2 903,75 × 0,13966 = 405,5377 USD → poplatek 0,987725 USD, ne 2 499,20
    expect(buy.fee?.currency).toBe('USD');
    expect(buy.fee!.amount.toString()).toBe('0.987725');
  });

  it('nesmyslný poplatek bez použitelného kurzu → varování, ne vymyšlené číslo (B-3-8)', async () => {
    const buffer = await buildSaxoXlsx({
      rows: [
        ['', '30-Dec-2024', '31-Dec-2024', 'Trade', 'NVIDIA Corp.', 'US67066G1040', 'USD', 'NASDAQ', 'NVDA:xnas', 'Buy 3 @ 134.85 USD', -2903.75, '', 1],
      ],
    });
    const result = await parseSaxoXlsx(buffer);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.fee).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain('nesmyslný poplatek');
  });

  it('záporný úrok → skipped s poznámkou, ne error ani tichá ztráta', async () => {
    const buffer = await buildSaxoXlsx({
      rows: [['', '30-Apr-2025', '30-Apr-2025', 'Cash amount', '', '', 'USD', '', '', 'Interest', -0.5, '', 1]],
    });
    const result = await parseSaxoXlsx(buffer);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.message).toContain('Záporný úrok');
  });

  it('nesmyslné kalendářní datum a neznámý měsíc → error s číslem řádku', async () => {
    const buffer = await buildSaxoXlsx({
      rows: [
        ['', '31-Feb-2025', '31-Feb-2025', 'Cash amount', '', '', 'USD', '', '', 'Interest', 1, '', 1],
        ['', '02-Foo-2025', '02-Foo-2025', 'Cash amount', '', '', 'USD', '', '', 'Interest', 1, '', 1],
      ],
    });
    const result = await parseSaxoXlsx(buffer);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]!.line).toBe(2); // 1 = hlavička
    expect(result.errors[0]!.message).toContain('Neplatné datum');
    expect(result.errors[1]!.line).toBe(3);
  });

  it('prázdný list → prázdný výsledek bez chyb', async () => {
    const buffer = await buildSaxoXlsx({ headers: null });
    const result = await parseSaxoXlsx(buffer);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.transactions).toEqual([]);
  });

  it('idempotentní ID: dva parse téhož = stejná ID; identické řádky rozliší suffix', async () => {
    const feeRow = ['', '02-Jan-2025', '02-Jan-2025', 'Cash amount', '', '', 'USD', '', '', 'Custody Fee', -3.91, '', 1];
    const buffer = await buildSaxoXlsx({ rows: [feeRow, feeRow] });
    const first = await parseSaxoXlsx(buffer);
    const second = await parseSaxoXlsx(buffer);

    const firstIds = first.transactions.map((t) => t.id);
    expect(firstIds).toHaveLength(2);
    expect(new Set(firstIds).size).toBe(2); // suffix -2 pro identický řádek
    expect(firstIds.every((id) => id.startsWith('saxo-'))).toBe(true);
    expect(second.transactions.map((t) => t.id)).toEqual(firstIds);
  });

  it('opakovaný import happy-path souboru je idempotentní (dedupe)', async () => {
    const buffer = await buildSaxoXlsx({ rows: SAXO_ROWS_EN });
    const first = await parseSaxoXlsx(buffer);
    const second = await parseSaxoXlsx(buffer);

    const combined = dedupeTransactions(SAXO_BROKER, [
      ...first.transactions,
      ...second.transactions,
    ]);
    expect(combined.fresh).toHaveLength(7);
    expect(combined.duplicates).toBe(7);
  });
});

describe('sniffSaxoXlsx (autodetekce)', () => {
  it('pozná EN i DA export podle hlavičkového řádku prvního listu', async () => {
    expect(sniffSaxoXlsx(await buildSaxoWorkbook({ rows: SAXO_ROWS_EN }))).toBe(true);
    expect(
      sniffSaxoXlsx(
        await buildSaxoWorkbook({ sheetName: SAXO_SHEET_DA, headers: SAXO_HEADERS_DA, rows: SAXO_ROWS_DA }),
      ),
    ).toBe(true);
  });

  it('odmítne cizí XLSX, neznámý jazyk i prázdný list', async () => {
    expect(sniffSaxoXlsx(await buildForeignWorkbook())).toBe(false);
    expect(sniffSaxoXlsx(await buildSaxoWorkbook({ headers: SAXO_HEADERS_UNKNOWN_LANG }))).toBe(false);
    expect(sniffSaxoXlsx(await buildSaxoWorkbook({ headers: null }))).toBe(false);
  });
});

describe('odolnost proti odchylkám reálných exportů', () => {
  it('sloupec navíc v hlavičce import nezabije (a nesvádí to na cizí jazyk)', async () => {
    // Reálné exporty mívají za poslední hlavičkou prázdnou nastylovanou buňku
    // nebo sloupec navíc. Porovnání na přesnou DÉLKU hlavičky kvůli tomu vracelo
    // „hlavičky v jazyce, který neumíme“ nad anglickým exportem.
    const headers = [...SAXO_HEADERS_EN, 'Booking Date'];
    const rows = SAXO_ROWS_EN.map((row) => [...row, '']);
    const workbook = await buildSaxoWorkbook({ headers, rows });
    expect(sniffSaxoXlsx(workbook)).toBe(true);

    const result = await parseSaxoXlsx(await buildSaxoXlsx({ headers, rows }));
    expect(result.errors).toEqual([]);
    expect(result.transactions.length).toBeGreaterThan(0);
  });

  it('anglický export: „Buy 1,500 @ 12.34 USD“ je 1500 kusů, ne 1,5', async () => {
    const rows = [
      ['', '02-Jan-2025', '02-Jan-2025', 'Trade', 'Apple Inc.', 'US0378331005', 'USD', 'NASDAQ', 'AAPL:xnas', 'Buy 1,500 @ 12.34 USD', -18510, '', 1],
      ...SAXO_ROWS_EN.slice(0, 2),
    ];
    const result = await parseSaxoXlsx(await buildSaxoXlsx({ rows }));
    expect(result.errors).toEqual([]);
    const trade = result.transactions[0]!;
    if (trade.type !== 'BUY') throw new Error('čekáme nákup');
    expect(trade.quantity.toString()).toBe('1500');
    expect(trade.pricePerShare.toString()).toBe('12.34');
  });

  it('dánský export: „Købt 1.000 @ 615,20 DKK“ je tisíc kusů', async () => {
    const rows = [
      ['', '14-maj-2025', '15-maj-2025', 'Handel', 'Novo Nordisk B A/S', 'DK0062498333', 'DKK', 'København', 'NOVOB:xcse', 'Købt 1.000 @ 615,20 DKK', '-615.200,00', '', 1],
      ...SAXO_ROWS_DA.slice(1),
    ];
    const result = await parseSaxoXlsx(
      await buildSaxoXlsx({ sheetName: SAXO_SHEET_DA, headers: SAXO_HEADERS_DA, rows }),
    );
    expect(result.errors).toEqual([]);
    const trade = result.transactions[0]!;
    if (trade.type !== 'BUY') throw new Error('čekáme nákup');
    expect(trade.quantity.toString()).toBe('1000');
  });
});
