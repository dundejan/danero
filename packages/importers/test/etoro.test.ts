import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { d } from '@danero/shared';
import { dedupeTransactions } from '../src';
import {
  ETORO_BROKER,
  parseEtoroNumber,
  parseEtoroXlsx,
  sniffEtoroXlsx,
} from '../src/etoro/xlsx';
import {
  buildEtoroHappyPath,
  buildEtoroEuLocale,
  buildEtoroXlsx,
  ETORO_ACTIVITY_HEADERS,
  ETORO_ACTIVITY_ROWS,
  ETORO_CLOSED_ROWS,
  ETORO_INSTRUMENT_MAP,
} from './fixtures/etoro';
import { buildXtbXlsx } from './fixtures/xtb';

/** Buffer → ExcelJS.Workbook (pro sniff testy). */
async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

describe('parseEtoroNumber', () => {
  const valid: Array<[string, string]> = [
    ['4,581.91', '4581.91'], // US: čárka tisíce, tečka desetinná
    ['11,316.06 ', '11316.06'], // trailing mezera z reálného exportu
    ['1,234,567.89', '1234567.89'],
    [' 212,77 ', '212.77'], // EU: desetinná čárka, mezery okolo
    ['0,337209', '0.337209'], // EU: víc než 3 desetinná místa
    ['1,23', '1.23'],
    ['1 234,56', '1234.56'], // EU: mezera jako tisícový oddělovač
    ['1\u00a0234,56', '1234.56'], // nezlomitelná mezera
    ['1.234.567,89', '1234567.89'], // EU: tečky tisíce, čárka desetinná
    ['(6.97)', '-6.97'], // závorky = minus (US)
    ['(0,10)', '-0.1'], // závorky = minus (EU)
    ['( 5,00 )', '-5'],
    ['-100.11', '-100.11'],
    ['0.337209', '0.337209'],
    ['0.00 ', '0'],
    ['1,234', '1234'], // jen čárka + tisícový tvar skupin → tisíce
    ['12,345,678', '12345678'],
    ['30000', '30000'],
  ];
  it.each(valid)('„%s“ → %s', (input, expected) => {
    expect(parseEtoroNumber(input)?.toString()).toBe(expected);
  });

  const invalid = ['', '-', '--', 'abc', 'Daily', '1,23,45', '1.2.3'];
  it.each(invalid)('„%s“ → null', (input) => {
    expect(parseEtoroNumber(input)).toBeNull();
  });
});

describe('eToro XLSX parser', () => {
  it('happy path: správné počty transakcí, chyb, přeskočených řádků a varování', async () => {
    const buffer = await buildEtoroHappyPath();
    const result = await parseEtoroXlsx(buffer, ETORO_INSTRUMENT_MAP);

    expect(result.broker).toBe(ETORO_BROKER);
    // 4 uzavřené pozice × 2 + AMD BUY + ETH BUY + INTEREST + 3× FEE + 2 dividendy
    expect(result.transactions).toHaveLength(16);
    expect(result.errors).toHaveLength(1); // jen nenamapovaný symbol ZZZ
    expect(result.unmappedSymbols).toEqual(['ZZZ']);
    // vklad, vratka overnight, výběr, poplatek za výběr, konverze, 2× transfer
    expect(result.skipped).toHaveLength(7);
    // staking, split, uzavření pozice mimo Closed Positions
    expect(result.warnings).toHaveLength(3);
  });

  it('uzavřená pozice → pár BUY/SELL: ID -open/-close, datumy DD/MM, ceny z Open/Close Rate', async () => {
    const buffer = await buildEtoroHappyPath();
    const result = await parseEtoroXlsx(buffer, ETORO_INSTRUMENT_MAP);

    const buy = result.transactions.find((t) => t.id === 'etoro-2355395242-open');
    if (!buy || buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.isin).toBe('US91347P1057');
    expect(buy.ticker).toBe('OLED'); // z „Buy Universal Display (OLED)“
    expect(buy.quantity.toString()).toBe('0.102626');
    expect(buy.pricePerShare.toString()).toBe('170.55');
    expect(buy.currency).toBe('USD');
    expect(buy.tradeDate).toBe('2023-06-12'); // 12/06/2023 = 12. června (den/měsíc!)
    expect(buy.assetClass).toBe('STOCK');
    expect(buy.settlementStyle).toBeUndefined();

    const sell = result.transactions.find((t) => t.id === 'etoro-2355395242-close');
    if (!sell || sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.pricePerShare.toString()).toBe('179.6');
    expect(sell.tradeDate).toBe('2024-01-09');
    expect(sell.quantity.toString()).toBe('0.102626');
  });

  it('CFD short s pákou → otevření SELL, uzavření BUY, DERIVATIVE + MARGIN, klíč = ticker', async () => {
    const buffer = await buildEtoroHappyPath();
    const result = await parseEtoroXlsx(buffer, ETORO_INSTRUMENT_MAP);

    const open = result.transactions.find((t) => t.id === 'etoro-2400000001-open');
    if (!open || open.type !== 'SELL') throw new Error('unreachable');
    expect(open.isin).toBe('TSLA'); // ISIN sloupec u CFD prázdný → symbol
    expect(open.assetClass).toBe('DERIVATIVE');
    expect(open.settlementStyle).toBe('MARGIN'); // R-12g: CFD se vypořádává rozdílem
    expect(open.pricePerShare.toString()).toBe('200');
    expect(open.tradeDate).toBe('2024-02-01');

    const close = result.transactions.find((t) => t.id === 'etoro-2400000001-close');
    if (!close || close.type !== 'BUY') throw new Error('unreachable');
    expect(close.assetClass).toBe('DERIVATIVE');
    expect(close.settlementStyle).toBe('MARGIN');
    expect(close.pricePerShare.toString()).toBe('180');
    expect(close.tradeDate).toBe('2024-02-15');
  });

  it('krypto pozice → CRYPTO s isin = symbol; ETF → assetClass ETF s ISIN z výpisu', async () => {
    const buffer = await buildEtoroHappyPath();
    const result = await parseEtoroXlsx(buffer, ETORO_INSTRUMENT_MAP);

    const btcBuy = result.transactions.find((t) => t.id === 'etoro-2500000002-open');
    if (!btcBuy || btcBuy.type !== 'BUY') throw new Error('unreachable');
    expect(btcBuy.assetClass).toBe('CRYPTO');
    expect(btcBuy.isin).toBe('BTC');
    expect(btcBuy.pricePerShare.toString()).toBe('30000');
    expect(btcBuy.settlementStyle).toBeUndefined();

    const etfBuy = result.transactions.find((t) => t.id === 'etoro-2600000003-open');
    if (!etfBuy || etfBuy.type !== 'BUY') throw new Error('unreachable');
    expect(etfBuy.assetClass).toBe('ETF');
    expect(etfBuy.isin).toBe('IE00B4L5Y983');
    expect(etfBuy.ticker).toBe('IWDA');
  });

  it('otevřená pozice z Account Activity → BUY s cenou Amount/Units (Decimal) a ISIN z mapy', async () => {
    const buffer = await buildEtoroHappyPath();
    const result = await parseEtoroXlsx(buffer, ETORO_INSTRUMENT_MAP);

    const amd = result.transactions.find((t) => t.id === 'etoro-2596572937-open');
    if (!amd || amd.type !== 'BUY') throw new Error('unreachable');
    expect(amd.isin).toBe('US0079031078'); // z mapování — Activity ISIN nemá
    expect(amd.ticker).toBe('AMD'); // z Details „AMD/USD“
    expect(amd.quantity.toString()).toBe('0.337209');
    expect(amd.pricePerShare.toString()).toBe(d('49.88').div('0.337209').toString());
    expect(amd.currency).toBe('USD');
    expect(amd.tradeDate).toBe('2024-01-09');

    // otevřená krypto pozice nepotřebuje mapování — isin = symbol
    const eth = result.transactions.find((t) => t.id === 'etoro-9999999998-open');
    if (!eth || eth.type !== 'BUY') throw new Error('unreachable');
    expect(eth.assetClass).toBe('CRYPTO');
    expect(eth.isin).toBe('ETH');
    expect(eth.pricePerShare.toString()).toBe('2000');
  });

  it('žádné dvojí počítání: Open/Position closed s PID v Closed Positions se přeskočí bez hlášky', async () => {
    const buffer = await buildEtoroHappyPath();
    const result = await parseEtoroXlsx(buffer, ETORO_INSTRUMENT_MAP);

    // OLED má v aktivitě řádky Open Position i Position closed — pokrývá je pár z Closed Positions
    const oled = result.transactions.filter((t) => 'ticker' in t && t.ticker === 'OLED');
    expect(oled).toHaveLength(2);
    expect(oled.map((t) => t.type).sort()).toEqual(['BUY', 'SELL']);
    // a nikde o tom není hláška (vědomé tiché přeskočení, ne skip/warning smetí)
    const allMessages = [...result.skipped, ...result.warnings, ...result.errors].map((i) => i.message);
    expect(allMessages.some((m) => m.includes('OLED'))).toBe(false);
  });

  it('dividendy z listu Dividends: gross = net + srážka; řádky Dividend v aktivitě se ignorují', async () => {
    const buffer = await buildEtoroHappyPath();
    const result = await parseEtoroXlsx(buffer, ETORO_INSTRUMENT_MAP);

    const dividends = result.transactions.filter((t) => t.type === 'DIVIDEND');
    expect(dividends).toHaveLength(2); // řádek Dividend v Account Activity nepřidal třetí

    const nke = dividends.find((t) => t.ticker === 'NKE');
    if (!nke || nke.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(nke.gross.toString()).toBe('0.24'); // 0.17 net + 0.07 srážka
    expect(nke.withholdingTax.toString()).toBe('0.07');
    expect(nke.currency).toBe('USD'); // ze sufixu hlavičky „(USD)“
    expect(nke.isin).toBe('US6541061031');
    expect(nke.date).toBe('2024-01-02');

    const apple = dividends.find((t) => t.type === 'DIVIDEND' && t.note === 'Apple Inc');
    if (!apple || apple.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(apple.gross.toString()).toBe('0.85');
    expect(apple.withholdingTax.toString()).toBe('0');
    expect(apple.ticker).toBeUndefined(); // plný název firmy není ticker
  });

  // B-2: bez listu Dividends dividendy z Activity mizely beze stopy — počty
  // chyb ani varování se nezměnily a příjem § 8 se do daně nedostal
  it.each([
    ['chybějící list Dividends', false as const],
    ['prázdný list Dividends', { rows: [] }],
  ])('%s při dividendách v Account Activity → chyba, ne tiché zmizení', async (_label, spec) => {
    const buffer = await buildEtoroXlsx({
      closed: { rows: ETORO_CLOSED_ROWS },
      activity: { rows: ETORO_ACTIVITY_ROWS },
      dividends: spec,
    });
    const result = await parseEtoroXlsx(buffer, ETORO_INSTRUMENT_MAP);

    expect(result.transactions.filter((t) => t.type === 'DIVIDEND')).toEqual([]);
    const missing = result.errors.find((e) => e.message.includes('Dividends'));
    expect(missing).toBeDefined();
    expect(missing!.message).toContain('Account Activity');
  });

  it('poplatky (SDRT ze závorky, Commission, Overnight fee) → FEE; Interest Payment → INTEREST', async () => {
    const buffer = await buildEtoroHappyPath();
    const result = await parseEtoroXlsx(buffer, ETORO_INSTRUMENT_MAP);

    const fees = result.transactions.filter((t) => t.type === 'FEE');
    expect(fees).toHaveLength(3);

    const sdrt = fees.find((t) => t.note?.startsWith('SDRT'));
    if (!sdrt || sdrt.type !== 'FEE') throw new Error('unreachable');
    expect(sdrt.amount.toString()).toBe('6.97'); // „(6.97)“ → kladný náklad
    expect(sdrt.currency).toBe('USD');
    expect(sdrt.date).toBe('2025-07-10');

    const overnight = fees.find((t) => t.note?.startsWith('Overnight fee'));
    if (!overnight || overnight.type !== 'FEE') throw new Error('unreachable');
    expect(overnight.amount.toString()).toBe('0.35');

    const commission = fees.find((t) => t.note?.startsWith('Commission'));
    if (!commission || commission.type !== 'FEE') throw new Error('unreachable');
    expect(commission.amount.toString()).toBe('1');

    const interest = result.transactions.find((t) => t.type === 'INTEREST');
    if (!interest || interest.type !== 'INTEREST') throw new Error('unreachable');
    expect(interest.amount.toString()).toBe('0.08');
    expect(interest.currency).toBe('USD');
    expect(interest.date).toBe('2024-01-01');
  });

  it('vklady, výběry, konverzní poplatky a převody → skipped s vysvětlením', async () => {
    const buffer = await buildEtoroHappyPath();
    const result = await parseEtoroXlsx(buffer, ETORO_INSTRUMENT_MAP);

    const messages = result.skipped.map((s) => s.message).join('\n');
    expect(messages).toContain('Vklad na účet');
    expect(messages).toContain('Výběr z účtu');
    expect(messages).toContain('Poplatek za výběr');
    expect(messages).toContain('konverzi měny');
    expect(messages).toContain('Interní převod');
    expect(messages).toContain('krypto peněženku');
    expect(messages).toContain('Vratka overnight poplatku');
  });

  it('staking a split → warning se srozumitelným vysvětlením; Position closed mimo Closed Positions → warning', async () => {
    const buffer = await buildEtoroHappyPath();
    const result = await parseEtoroXlsx(buffer, ETORO_INSTRUMENT_MAP);

    const messages = result.warnings.map((w) => w.message).join('\n');
    expect(messages).toContain('staking'); // zdanění zatím nepodporujeme
    expect(messages).toContain('poměr splitu'); // split bez poměru → univerzální šablona
    expect(messages).toContain('univerzální šablon');
    expect(messages).toContain('8888888888'); // uzavření pozice bez záznamu v Closed Positions
  });

  it('nenamapovaný symbol otevřené pozice → error jednou + unmappedSymbols, BUY se neemituje', async () => {
    const buffer = await buildEtoroHappyPath();
    const result = await parseEtoroXlsx(buffer, ETORO_INSTRUMENT_MAP);

    expect(result.unmappedSymbols).toEqual(['ZZZ']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toBe(
      'Symbol ZZZ: doplň ISIN instrumentu (eToro ho u této pozice neuvádí).',
    );
    expect(result.errors[0]!.line).toBe(19); // skutečný řádek v listu Account Activity
    expect(result.transactions.some((t) => 'ticker' in t && t.ticker === 'ZZZ')).toBe(false);
  });

  it('EU locale: desetinné čárky, mezery v tisících, závorky, staré/nové varianty hlaviček', async () => {
    const buffer = await buildEtoroEuLocale();
    const result = await parseEtoroXlsx(buffer, ETORO_INSTRUMENT_MAP);

    expect(result.errors).toEqual([]);
    expect(result.unmappedSymbols).toEqual([]);
    expect(result.transactions).toHaveLength(5);

    // stará hlavička bez „(USD)“ sufixů, Action „Buy NVDA“ bez závorek
    const buy = result.transactions.find((t) => t.id === 'etoro-1074146905-open');
    if (!buy || buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.ticker).toBe('NVDA');
    expect(buy.quantity.toString()).toBe('2.5'); // „2,5“
    expect(buy.pricePerShare.toString()).toBe('85.11'); // „ 85,11 “
    expect(buy.tradeDate).toBe('2020-04-15');

    const sell = result.transactions.find((t) => t.id === 'etoro-1074146905-close');
    if (!sell || sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.pricePerShare.toString()).toBe('95.5');

    // hlavička „Units / Contracts“ + „Amount in EUR“ (Amount se nesmí splést)
    const adbe = result.transactions.find((t) => t.id === 'etoro-2000000001-open');
    if (!adbe || adbe.type !== 'BUY') throw new Error('unreachable');
    expect(adbe.pricePerShare.toString()).toBe('400.2'); // „ 1 000,50 “ / „2,5“
    expect(adbe.isin).toBe('US00724F1012');

    const fee = result.transactions.find((t) => t.type === 'FEE');
    if (!fee || fee.type !== 'FEE') throw new Error('unreachable');
    expect(fee.amount.toString()).toBe('0.1'); // „(0,10)“

    // dividenda z varianty „Net dividends (EUR)“ → měna ze sufixu hlavičky
    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND');
    if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.gross.toString()).toBe('3.65'); // 3,10 + 0,55
    expect(dividend.withholdingTax.toString()).toBe('0.55');
    expect(dividend.currency).toBe('EUR');
  });

  it('dividendy: sloupec Currency má přednost, chybějící sloupec srážky → warning', async () => {
    const headers = [
      'Date of Payment',
      'Instrument Name',
      'Net Dividend Received',
      'Position ID',
      'ISIN',
      'Currency',
    ];
    const buffer = await buildEtoroXlsx({
      dividends: {
        headers,
        rows: [['05/06/2024', 'VOD/GBP', '1.50', '3000000000', 'GB00BH4HKS39', 'GBP']],
      },
    });
    const result = await parseEtoroXlsx(buffer);

    expect(result.errors).toEqual([]);
    const dividend = result.transactions.find((t) => t.type === 'DIVIDEND');
    if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('unreachable');
    expect(dividend.currency).toBe('GBP');
    expect(dividend.gross.toString()).toBe('1.5'); // bez sloupce srážky = čistá částka
    expect(dividend.withholdingTax.toString()).toBe('0');
    expect(result.warnings.some((w) => w.message.includes('sloupec se srážkovou daní'))).toBe(true);
  });

  it('chybné řádky → error se skutečným číslem řádku; neznámý typ → výzva „nahlaš nám ho“', async () => {
    const buffer = await buildEtoroXlsx({
      closed: {
        rows: [
          ['123', 'Buy Apple (AAPL)', 'Long', 10, '-', '01/01/2024 10:00:00', '02/01/2024 10:00:00', 1, '', '', '', '', '', '', 100, 110, '', '', '', '', 'Stocks', 'US0378331005', ''],
        ],
      },
      activity: {
        rows: [
          ['31/13/2024 10:00:00', 'Interest Payment', '', 0.08, '-', 0.08, 0, 0, '-', '', 0],
          ['02/01/2024 10:00:00', 'Airdrop', 'XRP', 1, '-', 1, 0, 0, '-', 'Crypto', 0],
        ],
      },
    });
    const result = await parseEtoroXlsx(buffer);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(3);
    const closedError = result.errors.find((e) => e.message.includes('počet kusů'));
    expect(closedError?.line).toBe(2);
    const dateError = result.errors.find((e) => e.message.includes('neplatné datum'));
    expect(dateError?.line).toBe(2);
    const unknownError = result.errors.find((e) => e.message.includes('Airdrop'));
    expect(unknownError?.line).toBe(3);
    expect(unknownError?.message).toContain('nahlaš nám ho');
  });

  it('prázdné listy (jen hlavičky, nebo úplně prázdné) → prázdný výsledek bez chyb', async () => {
    const withHeaders = await parseEtoroXlsx(await buildEtoroXlsx());
    expect(withHeaders.transactions).toEqual([]);
    expect(withHeaders.errors).toEqual([]);
    expect(withHeaders.warnings).toEqual([]);
    expect(withHeaders.skipped).toEqual([]);
    expect(withHeaders.unmappedSymbols).toEqual([]);

    const blank = await parseEtoroXlsx(
      await buildEtoroXlsx({
        closed: { headers: null },
        activity: { headers: null },
        dividends: { headers: null },
      }),
    );
    expect(blank.transactions).toEqual([]);
    expect(blank.errors).toEqual([]);
  });

  it('cizí soubor (XTB) a chybějící list → srozumitelný error', async () => {
    const xtb = await parseEtoroXlsx(await buildXtbXlsx());
    expect(xtb.transactions).toEqual([]);
    expect(xtb.errors).toHaveLength(1);
    expect(xtb.errors[0]!.message).toContain('nevypadá jako výpis z eToro');

    const withoutClosed = await parseEtoroXlsx(await buildEtoroXlsx({ closed: false }));
    expect(withoutClosed.errors).toHaveLength(1);
    expect(withoutClosed.errors[0]!.message).toContain('Closed Positions');
  });

  it('sniff: true pro eToro workbook, false pro XTB i prázdný workbook', async () => {
    expect(sniffEtoroXlsx(await loadWorkbook(await buildEtoroHappyPath()))).toBe(true);
    // sniff nekouká na data, jen na listy — stačí prázdné listy
    expect(sniffEtoroXlsx(await loadWorkbook(await buildEtoroXlsx()))).toBe(true);
    expect(sniffEtoroXlsx(await loadWorkbook(await buildXtbXlsx()))).toBe(false);
    expect(sniffEtoroXlsx(new ExcelJS.Workbook())).toBe(false);
    // jen jeden z klíčových listů nestačí
    expect(sniffEtoroXlsx(await loadWorkbook(await buildEtoroXlsx({ activity: false })))).toBe(false);
  });

  it('dedupe-stabilita: dva parse téhož souboru → stejná ID, dedupe vše označí za duplicity', async () => {
    const buffer = await buildEtoroHappyPath();
    const first = await parseEtoroXlsx(buffer, ETORO_INSTRUMENT_MAP);
    const second = await parseEtoroXlsx(buffer, ETORO_INSTRUMENT_MAP);

    const firstIds = first.transactions.map((t) => t.id);
    expect(new Set(firstIds).size).toBe(firstIds.length); // žádné kolize ID
    expect(second.transactions.map((t) => t.id)).toEqual(firstIds);

    const combined = dedupeTransactions(ETORO_BROKER, [
      ...first.transactions,
      ...second.transactions,
    ]);
    expect(combined.fresh).toHaveLength(16);
    expect(combined.duplicates).toBe(16);
  });

  it('identické řádky bez vlastního ID (2× stejný úrok) → stabilní ID rozlišená suffixem', async () => {
    const interestRow = ['01/01/2024 05:50:54', 'Interest Payment', '', 0.08, '-', 0.08, 0, 0, '-', '', 0];
    const buffer = await buildEtoroXlsx({ activity: { rows: [interestRow, interestRow] } });
    const first = await parseEtoroXlsx(buffer);
    const second = await parseEtoroXlsx(buffer);

    const ids = first.transactions.map((t) => t.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2); // suffix -2 pro identický řádek
    expect(ids.every((id) => id.startsWith('etoro-'))).toBe(true);
    expect(second.transactions.map((t) => t.id)).toEqual(ids);
  });

  it('hlavičky se mapují podle názvů, ne pořadí (přeházené sloupce)', async () => {
    const shuffledActivity = [...ETORO_ACTIVITY_HEADERS].reverse();
    const row = shuffledActivity.map((h) => {
      const values: Record<string, string | number> = {
        Date: '01/01/2024 05:50:54',
        Type: 'Interest Payment',
        Amount: 0.08,
        'Position ID': '-',
      };
      return values[h] ?? '';
    });
    const buffer = await buildEtoroXlsx({ activity: { headers: shuffledActivity, rows: [row] } });
    const result = await parseEtoroXlsx(buffer);

    expect(result.errors).toEqual([]);
    const interest = result.transactions.find((t) => t.type === 'INTEREST');
    if (!interest || interest.type !== 'INTEREST') throw new Error('unreachable');
    expect(interest.amount.toString()).toBe('0.08');
    expect(interest.date).toBe('2024-01-01');
  });
});
