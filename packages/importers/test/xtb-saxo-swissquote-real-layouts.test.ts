/**
 * XTB, Saxo Bank a Swissquote: tvary výpisů, jak je platformy opravdu
 * posílají (audit 13. 10. 2026).
 *
 * Komentáře u testů popisují vadu, kterou test hlídá — tedy chování PŘED
 * opravou z toho dne. Rozložení souborů (názvy
 * listů, hlavičky, názvy typů) je opsané z veřejných zdrojů uvedených u testu;
 * tituly, částky, časy i čísla účtů jsou smyšlené.
 */
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseSaxoXlsx, sniffSaxoXlsx, sniffSaxoXlsxShape } from '../src/saxo/xlsx';
import { parseSwissquoteCsv, sniffSwissquoteCsv } from '../src/swissquote/csv';
import { parseXtbXlsx } from '../src/xtb/xlsx';
import { SAXO_HEADERS_EN, SAXO_HEADERS_UNKNOWN_LANG } from './fixtures/saxo';
import { SWISSQUOTE_HEADER_DE, SWISSQUOTE_HEADER_EN } from './fixtures/swissquote';
import { XTB_INSTRUMENT_MAP } from './fixtures/xtb';

type Cell = string | number | Date | null;

const utc = (year: number, month: number, day: number, hour = 10, minute = 0): Date =>
  new Date(Date.UTC(year, month - 1, day, hour, minute));

async function toBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const raw = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
}

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

/* ── XTB ─────────────────────────────────────────────────────────────────── */

/**
 * Starý „Full report“ (tlačítko „Export“) tak, jak ho popisují tři nezávislé
 * cizí parsery — ne tak, jak ho staví `fixtures/xtb.ts`:
 *
 * - sloupec A je prázdný, tabulka začíná ve sloupci B;
 * - údaje o účtu jsou DVA řádky: popisky („Name and surname“, „Account“,
 *   „Currency“) a pod nimi hodnoty — žádná buňka „Account currency“;
 * - nad hlavičkou je název tabulky a období, pod tabulkou řádek „Total“.
 *
 * Zdroje: Piotr20/xtb-xlsx-cleaner `xtb_cleaner/parser.py` (28. 12. 2025:
 * „Row 6 (index 5) typically has: Name and surname, Account, Currency / Row 7
 * (index 6) has the actual values“), CipherVault-PT/SelfFinancialManager
 * PR #7 `tests/import.test.js` („extrato XTB fictício (mesma estrutura do
 * real)“).
 */
async function buildXtbFullReport(cashRows: Cell[][], accountCurrency = 'CZK'): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('CASH OPERATION HISTORY');
  for (let i = 0; i < 4; i += 1) sheet.addRow([]);
  sheet.addRow([null, null, null, 'Name and surname', 'Account', 'Currency']);
  sheet.addRow([null, null, null, 'Jana Vzorová', 7654321, accountCurrency]);
  sheet.addRow([null, null, null, 'Balance', 'Equity']);
  sheet.addRow([null, null, null, 1200, 1200]);
  sheet.addRow([null, 'CASH OPERATION HISTORY ']);
  sheet.addRow([null, '01/01/2025 - 01/01/2026']);
  sheet.addRow([null, 'ID', 'Type', 'Time', 'Comment', 'Symbol', 'Amount']);
  for (const row of cashRows) sheet.addRow([null, ...row]);
  sheet.addRow([null, 'Total', null, null, null, null, 0, accountCurrency]);
  return toBuffer(workbook);
}

describe('XTB: starý Full report z xStation', () => {
  /**
   * Doloženo: dickwolff/Export-To-Ghostfolio issue #190, komentář z 9. 4. 2025
   * s řádky opsanými z listu CASH OPERATION HISTORY:
   * `xxx;DIVIDENT;26/03/2025 11:47:01;FB.US USD 0.5250/ SHR;FB.US;0,48` a
   * `xxx;Withholding Tax;…;FB.US USD WHT 15%;FB.US;-0,07`; správce k tomu
   * 10. 4. 2025: „at least "DIVIDENT" with a T is new“. Totéž Piotr20
   * (`entry_type.upper() == "DIVIDENT"`, „XTB's spelling“).
   */
  it('typ „DIVIDENT“ (takhle ho XTB v sešitu píše) je dividenda a spáruje se se srážkou', async () => {
    const buffer = await buildXtbFullReport([
      [810002, 'Withholding Tax', utc(2025, 3, 26, 11, 47), 'AAPL.US USD WHT 15%', 'AAPL.US', -1.86],
      [810001, 'DIVIDENT', utc(2025, 3, 26, 11, 47), 'AAPL.US USD 0.2500/ SHR', 'AAPL.US', 12.4],
    ]);
    const result = await parseXtbXlsx(buffer, XTB_INSTRUMENT_MAP);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      type: 'DIVIDEND',
      ticker: 'AAPL.US',
      date: '2025-03-26',
    });
    const dividend = result.transactions[0] as { gross: { toString(): string }; withholdingTax: { toString(): string } };
    expect(dividend.gross.toString()).toBe('12.4');
    expect(dividend.withholdingTax.toString()).toBe('1.86');
    // srážka nesmí skončit jako „bez párové dividendy“
    expect(result.warnings.map((w) => w.message).join('\n')).not.toContain('bez párové dividendy');
  });

  /**
   * Slabší doklad než u „DIVIDENT“: jediný zdroj je CipherVault-PT PR #7
   * (`type.startsWith('free-funds interest')`, fixtura „mesma estrutura do
   * real“ s typy „Free-funds Interest“ a „Free-funds Interest Tax“).
   */
  it('typy „Free-funds Interest“ a „Free-funds Interest Tax“ (se spojovníkem) jsou úrok a daň z něj', async () => {
    const buffer = await buildXtbFullReport([
      [810011, 'Free-funds Interest', utc(2025, 5, 2, 6, 10), 'Free-funds Interest 2025-04', null, 8.4],
      [810012, 'Free-funds Interest Tax', utc(2025, 5, 2, 6, 10), 'Free-funds Interest Tax 2025-04', null, -1.26],
    ]);
    const result = await parseXtbXlsx(buffer);

    expect(result.errors).toEqual([]);
    expect(result.transactions.map((t) => t.type).sort()).toEqual(['FEE', 'INTEREST']);
  });

  /**
   * Doloženo dvěma parsery (viz `buildXtbFullReport`): měna účtu je v reportu
   * uvedená, jen pod popiskem „Currency“ o řádek níž. Parser ji tam nehledá,
   * účet v korunách tak zapíše v eurech a uživateli tvrdí, že ji report neuvádí.
   */
  it('měna účtu se přečte z řádku pod popiskem „Currency“ — žádné mlčky dosazené EUR', async () => {
    const buffer = await buildXtbFullReport([
      [810021, 'Deposit', utc(2025, 1, 6, 9, 0), 'Deposit', null, 25000],
    ]);
    const result = await parseXtbXlsx(buffer);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({ type: 'DEPOSIT', currency: 'CZK' });
    expect(result.warnings.map((w) => w.message).join('\n')).not.toContain('předpokládáme');
  });
});

describe('XTB: typy peněžních operací, které parser nezná', () => {
  const NEW_CASH_HEADERS = ['Type', 'Ticker', 'Instrument', 'Time', 'Amount', 'ID', 'Comment', 'Product'];

  /** Nový report („Export (new)“) jen s listem peněžních operací — rozložení podle PR #327. */
  async function buildNewCashReport(rows: Cell[][]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const cash = workbook.addWorksheet('Cash Operations');
    cash.addRow(['Account number', 7654321]);
    cash.addRow(['Cash Operations']);
    cash.addRow(['Date from (UTC)', utc(2024, 12, 31, 23, 0)]);
    cash.addRow(['Date to (UTC)', utc(2025, 12, 31, 22, 59)]);
    cash.addRow(NEW_CASH_HEADERS);
    for (const row of rows) cash.addRow(row);
    cash.addRow(['Total', null, null, null, 0]);
    return toBuffer(workbook);
  }
  const NEW_FILENAME = 'CZK_7654321_2025-01-01_2025-12-31.xlsx';

  /**
   * Doloženo: `samples/xtb-export.csv` v Export-To-Ghostfolio
   * (`…;Transfer;14.05.2024 17:21:05;;Transfer from 50526908 to 50655635;200`)
   * a seznam přeskakovaných typů nového reportu v PR #327 (`type === "transfer"`).
   * Přesun mezi vlastními podúčty není příjem — chyba „nahlaš nám ho“ u něj
   * jen zahlcuje výpis chyb.
   */
  it('„Transfer“ mezi vlastními účty neskončí jako neznámý typ', async () => {
    const buffer = await buildNewCashReport([
      ['Transfer', null, null, utc(2025, 5, 14, 15, 21), 2000, 820001, 'Transfer from 7654321 to 7654399', 'My Trades'],
    ]);
    const result = await parseXtbXlsx(buffer, {}, { filename: NEW_FILENAME });

    expect(result.errors).toEqual([]);
    expect(result.transactions.filter((t) => !['DEPOSIT', 'WITHDRAWAL'].includes(t.type))).toEqual([]);
  });

  /**
   * Doloženo: PR #327 (21. 4. 2026) — `if (type === "Tax IFTT")`, „French
   * financial transaction tax, has a security“. Daň z finančních transakcí je
   * náklad pořízení (R-05b) stejně jako „SEC fee“, který parser umí.
   */
  it('„Tax IFTT“ (francouzská daň z finančních transakcí) je poplatek, ne neznámý typ', async () => {
    const buffer = await buildNewCashReport([
      ['Tax IFTT', 'NDWD.FR', 'Nordwind', utc(2025, 4, 9, 9, 5), -12.3, 820011, 'Tax IFTT NDWD.FR', 'My Trades'],
    ]);
    const result = await parseXtbXlsx(buffer, {}, { filename: NEW_FILENAME });

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({ type: 'FEE', currency: 'CZK', date: '2025-04-09' });
    expect((result.transactions[0] as { amount: { toString(): string } }).amount.toString()).toBe('12.3');
  });

  /**
   * Slabší doklad: `samples/xtb-export.csv` v Export-To-Ghostfolio nese řádek
   * „Corr Free-funds Interest 2024-08“ se zápornou částkou a konvertor ho
   * výslovně ošetřuje („negative correction“). Dnes skončí chybou „chybí
   * kladná částka úroku“ (částka tam je) a úrok za rok vyjde o opravu vyšší.
   */
  it('záporná oprava úroku („Corr Free-funds Interest“) neskončí chybou — eviduje se zvlášť a řekne se to', async () => {
    const buffer = await buildNewCashReport([
      ['Free funds interest', null, null, utc(2025, 9, 10, 18, 49), -0.5, 820022, 'Corr Free-funds Interest 2025-08', 'My Trades'],
      ['Free funds interest', null, null, utc(2025, 9, 2, 6, 10), 8.4, 820021, 'Free-funds Interest 2025-08', 'My Trades'],
    ]);
    const result = await parseXtbXlsx(buffer, {}, { filename: NEW_FILENAME });

    // Úrok se o opravu nesnižuje — jinak by jeho obsah závisel na tom, jestli
    // export opravu obsahuje, a delší export by tentýž úrok uložil podruhé.
    expect(result.errors).toEqual([]);
    const amountsOf = (kind: string): string[] =>
      result.transactions.flatMap((t) =>
        t.type === kind ? [(t as { amount: { toString(): string } }).amount.toString()] : [],
      );
    expect(amountsOf('INTEREST')).toEqual(['8.4']);
    expect(amountsOf('FEE')).toEqual(['0.5']);
    expect(result.warnings.some((w) => w.message.includes('Corr Free-funds Interest'))).toBe(true);
  });

  it('výsledek a swap CFD pozice parser pozná — uloží jako derivát, nebo řekne, že CFD z XTB neumí', async () => {
    const buffer = await buildXtbFullReport([
      [830002, 'Swap', utc(2025, 3, 21, 13, 30), 'Swap of position #900000001', 'NDWD.US', -4.2],
      [830001, 'Profit/Loss (FX/CFD)', utc(2025, 3, 21, 13, 30), 'Profit of position #900000001', 'NDWD.US', 310.5],
    ]);
    const result = await parseXtbXlsx(buffer);

    const messages = [...result.errors, ...result.warnings, ...result.skipped].map((entry) => entry.message);
    const derivatives = result.transactions.filter(
      (t) => (t as { assetClass?: string }).assetClass === 'DERIVATIVE',
    );
    expect(messages.join('\n')).not.toContain('Neznámý typ operace');
    expect(derivatives.length > 0 || messages.some((message) => /CFD/.test(message))).toBe(true);
  });
});

/* ── Saxo Bank ───────────────────────────────────────────────────────────── */

/**
 * Hlavička exportu Transactions od března 2026: „Amount“ se jmenuje „Booked
 * Amount“ a přibyly dva sloupce. Doslova z dickwolff/Export-To-Ghostfolio
 * issue #319 (26. 3. 2026, „SaxoConverter: Export format changed“):
 * `Client ID,Trade Date,Value Date,Type,Instrument,Instrument ISIN,Instrument
 * currency,Exchange Description,Instrument Symbol,Event,Booked Amount,Order
 * ID,Conversion Rate,From Derivative,Underlying asset type`.
 */
const SAXO_HEADERS_EN_2026 = [
  'Client ID',
  'Trade Date',
  'Value Date',
  'Type',
  'Instrument',
  'Instrument ISIN',
  'Instrument currency',
  'Exchange Description',
  'Instrument Symbol',
  'Event',
  'Booked Amount',
  'Order ID',
  'Conversion Rate',
  'From Derivative',
  'Underlying asset type',
];

async function buildSaxo(headers: string[], rows: Cell[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transactions');
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  return toBuffer(workbook);
}

describe('Saxo: export Transactions v dnešním tvaru', () => {
  const ROW_2026: Cell[] = [
    '7654321', '20-Feb-2026', '24-Feb-2026', 'Trade', 'Vanguard FTSE All-World UCITS ETF', 'IE00BK5BQT80',
    'USD', 'London Stock Exchange (ETFs)', 'VWRA:xlon', 'Buy 40 @ 51.25 USD', -2053.5, 5300000001, 1, 'No', null,
  ];

  it('sniffer pozná hlavičku se sloupcem „Booked Amount“ a dvěma sloupci navíc', async () => {
    const workbook = await loadWorkbook(await buildSaxo(SAXO_HEADERS_EN_2026, [ROW_2026]));
    expect(sniffSaxoXlsx(workbook)).toBe(true);
  });

  it('parser z ní přečte obchod i s poplatkem dopočteným z „Booked Amount“', async () => {
    const result = await parseSaxoXlsx(await buildSaxo(SAXO_HEADERS_EN_2026, [ROW_2026]));

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    const buy = result.transactions[0] as {
      type: string;
      quantity: { toString(): string };
      pricePerShare: { toString(): string };
      fee?: { amount: { toString(): string }; currency: string };
    };
    expect(buy).toMatchObject({ type: 'BUY', isin: 'IE00BK5BQT80', currency: 'USD', tradeDate: '2026-02-20' });
    expect(buy.quantity.toString()).toBe('40');
    expect(buy.pricePerShare.toString()).toBe('51.25');
    // |−2 053,50| − 40 × 51,25 = 3,50
    expect(buy.fee?.amount.toString()).toBe('3.5');
    expect(buy.fee?.currency).toBe('USD');
  });

  /**
   * Doloženo tamtéž: „Import failing when exported date format is in locale nl
   * instead of en“, s řádkem `…,24-feb-2026,Trade,…,Buy 100 @ 99.68 EUR` pod
   * ANGLICKOU hlavičkou. Jazyk měsíce se tedy řídí místním nastavením, ne
   * jazykem hlavičky; zkratky se mezi jazyky slovníku nepřekrývají významem
   * (mei/maj/mai = květen, okt = říjen), takže je bezpečné zkusit všechny.
   */
  it('měsíc v datu smí být v jiném jazyce než hlavička (anglická hlavička, „mei“, „mrt“, „okt“)', async () => {
    const row = (tradeDate: string, valueDate: string, amount: number): Cell[] => [
      '', tradeDate, valueDate, 'Trade', 'Vanguard FTSE All-World UCITS ETF', 'IE00BK5BQT80', 'USD',
      'London Stock Exchange (ETFs)', 'VWRA:xlon', 'Buy 2 @ 100 USD', amount, '', 1,
    ];
    const result = await parseSaxoXlsx(
      await buildSaxo(SAXO_HEADERS_EN, [
        row('14-mei-2026', '18-mei-2026', -200),
        row('03-mrt-2026', '05-mrt-2026', -201),
        row('09-okt-2025', '13-okt-2025', -202),
      ]),
    );

    expect(result.errors).toEqual([]);
    expect(result.transactions.map((t) => (t as { tradeDate: string }).tradeDate)).toEqual([
      '2026-05-14',
      '2026-03-03',
      '2025-10-09',
    ]);
  });

  /**
   * Záložní sniffer podle tvaru chce PŘESNĚ třináct sloupců. Dnešní export jich
   * má patnáct (issue #319), takže klient s platformou ve francouzštině nebo
   * češtině už radu „přepni jazyk na angličtinu“ nedostane a čte obecné „XLSX
   * nepoznáváme“ — přesně to, co L2b-03 opravovalo. Názvy dvou sloupců navíc
   * jsou tu smyšlené (cizojazyčnou hlavičku nového tvaru nikdo nedoložil),
   * doložený je jen jejich počet.
   */
  it('export v jazyce mimo slovník se pozná podle tvaru i s patnácti sloupci', async () => {
    const headers = [...SAXO_HEADERS_UNKNOWN_LANG, 'Depuis dérivé', "Type d'actif sous-jacent"];
    const rows: Cell[][] = [
      ['', '11-mars-2026', '13-mars-2026', 'Transaction', 'Nordwind SA', 'FR0000000001', 'EUR', 'Euronext Paris',
        'NDWD:xpar', 'Achat 7 @ 61,40 EUR', -431.8, 5300000002, 1, 'Non', null],
    ];
    const workbook = await loadWorkbook(await buildSaxo(headers, rows));

    expect(sniffSaxoXlsxShape(workbook)).toBe(true);
  });
});

/* ── Swissquote ──────────────────────────────────────────────────────────── */

/**
 * Anglická hlavička s patnácti sloupci. Doslova z příloh dickwolff/
 * Export-To-Ghostfolio issue #7 (4. a 9. 12. 2023): měna částky je ve sloupci
 * „Net Amount currency“; poslední „Currency“ je měna ÚČTU. Reálný řádek
 * tamtéž: `…;Sell;IAAA;…;74.0;76.00;8.46;0.00;5615.56;USD;5176.65;121744.28;CHF`
 * (74 × 76,00 − 8,46 = 5 615,54 → cena i náklady jsou v USD, ne v CHF).
 */
const SWISSQUOTE_HEADER_EN_15 =
  'Date;Order #;Transaction;Symbol;Name;ISIN;Quantity;Unit price;Costs;Accrued Interest;Net Amount;Net Amount currency;Net Amount in account currency;Balance;Currency';

/**
 * Německá hlavička se třinácti sloupci — nativní soubor z března 2026 (fórum
 * Portfolio Performance, vlákno 38963, 8. 3. 2026) a `test_transactions.csv`
 * v simonsilie/swissquote-tax-calculator (2026). Sloupec „Währung Nettobetrag“
 * v ní není, měnu nese „Währung“; název titulu je nově v uvozovkách.
 */
const SWISSQUOTE_HEADER_DE_13 =
  'Datum;Auftrag #;Transaktionen;Symbol;Name;ISIN;Anzahl;Stückpreis;Kosten;Aufgelaufene Zinsen;Nettobetrag;Saldo;Währung';

describe('Swissquote: varianty hlavičky', () => {
  it('EN 15 sloupců: obchod v USD na účtu v CHF se uloží v USD („Net Amount currency“), ne v měně účtu', () => {
    const csv = [
      SWISSQUOTE_HEADER_EN_15,
      // 20 × 41,50 − 6,20 = 823,80 USD; 741,42 je přepočet do CHF
      '14-04-2025 10:12:40;990000001;Sell;NDWD;NORDWIND HOLDING;CH0000000001;20.0;41.50;6.20;0.00;823.80;USD;741.42;5310.20;CHF',
      // dividenda připsaná v USD na účet v CHF: 60 − 9 = 51 USD
      '15-05-2025 08:21:38;00000000;Dividend;NDWD;NORDWIND HOLDING;CH0000000001;1.0;60.00;9.00;0.00;51.00;USD;45.90;5356.10;CHF',
    ].join('\n');
    const result = parseSwissquoteCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(2);
    const [sell, dividend] = result.transactions as Array<{
      type: string;
      currency: string;
      fee?: { currency: string };
    }>;
    expect(sell).toMatchObject({ type: 'SELL', currency: 'USD' });
    expect(sell!.fee?.currency).toBe('USD');
    expect(dividend).toMatchObject({ type: 'DIVIDEND', currency: 'USD' });
  });

  it('DE 13 sloupců: výpis se pozná a přečte, měna je ve sloupci „Währung“', () => {
    const csv = [
      SWISSQUOTE_HEADER_DE_13,
      '14-04-2025 10:12:40;990000001;Kauf;NDWD;"NORDWIND HOLDING";CH0000000001;8.0;52.30;6.40;0.00;-424.80;1310.20;CHF',
    ].join('\r\n');

    expect(sniffSwissquoteCsv(csv)).toBe(true);
    const result = parseSwissquoteCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      type: 'BUY',
      isin: 'CH0000000001',
      name: 'NORDWIND HOLDING',
      currency: 'CHF',
      tradeDate: '2025-04-14',
    });
  });
});

describe('Swissquote: typy transakcí, které parser nezná', () => {
  /**
   * Doloženo: příloha fóra Portfolio Performance, vlákno 31207 (5. 1. 2025),
   * řádek `…,Zinsen auf Einlagen,,,,1,571.77,200.12,0,371.65,CHF,…` (srážka
   * 35 %), a `test_transactions.csv` simonsilie. Parser zná „Zins“, „Zinsen“
   * a „Zinsen auf Belastungen“; kreditní úrok v dnešním německém exportu ne.
   */
  it('DE „Zinsen auf Einlagen“ je úrok se švýcarskou srážkou v „Kosten“ (R-07f)', () => {
    const csv = [
      SWISSQUOTE_HEADER_DE,
      '01-01-2025 08:51:10;00000000;Zinsen auf Einlagen;;;;1.0;80.00;28.00;0.00;52.00;CHF;52.00;9052.00;CHF',
    ].join('\n');
    const result = parseSwissquoteCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    const interest = result.transactions[0] as {
      type: string;
      amount: { toString(): string };
      withholdingTax: { toString(): string };
    };
    expect(interest.type).toBe('INTEREST');
    expect(interest.amount.toString()).toBe('80');
    expect(interest.withholdingTax.toString()).toBe('28');
  });

  /**
   * Doloženo: tytéž přílohy — `30.04.2024 14:12,0,Capital Gain,BANB,BACHEM N,
   * CH1176493729,1,342,0,0,342,CHF,…` týž den jako `Dividende … 1,342,119.7,0,
   * 222.3` téhož titulu. Je to výplata připsaná vedle dividendy bez švýcarské
   * srážky (extraktor PDF v Portfolio Performance řadí „Kapitalgewinn“ mezi
   * dividendy); že jde o výplatu z kapitálových rezerv, je odvozené. Dnes se
   * řádek s varováním PŘESKOČÍ, takže příjem chybí. Bezpečný směr podle R-07h
   * je zdanit ji jako dividendu (nejlíp s `returnOfCapital`).
   */
  it('„Capital Gain“ je výplata z titulu vedle dividendy — nesmí se přeskočit', () => {
    const csv = [
      SWISSQUOTE_HEADER_DE,
      '30-04-2025 14:12:00;00000000;Capital Gain;NDWD;NORDWIND HOLDING;CH0000000001;1.0;120.00;0.00;0.00;120.00;CHF;120.00;9172.00;CHF',
    ].join('\n');
    const result = parseSwissquoteCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    const payout = result.transactions[0] as { type: string; gross: { toString(): string }; currency: string };
    expect(payout).toMatchObject({ type: 'DIVIDEND', isin: 'CH0000000001', currency: 'CHF', date: '2025-04-30' });
    expect(payout.gross.toString()).toBe('120');
  });

  /**
   * Doloženo: přílohy issue #7 Export-To-Ghostfolio —
   * `02-03-2022 19:06:04;00000000;Fees Tax Statement;;;;1.0;-100.00;0.00;0.00;-100.00;CHF;-100.00;35307.60;CHF`.
   * Parser zná „Tax statement“ (přeskakuje ho vědomě), skutečný název typu ne.
   */
  it('EN „Fees Tax Statement“ se přeskočí jako poplatek za daňový výpis, ne jako neznámý typ', () => {
    const csv = [
      SWISSQUOTE_HEADER_EN,
      '02-03-2025 19:06:04;00000000;Fees Tax Statement;;;;1.0;-90.00;0.00;0.00;-90.00;4210.00;CHF',
    ].join('\n');
    const result = parseSwissquoteCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toEqual([]);
  });

  /**
   * Doloženo: tamtéž — zrušený fond jsou tři řádky „Redemption“: odpis kusů
   * (`…;Redemption;ORFN;…;-500.0;19.313678;0.00;0.00;-;;USD`, částka je
   * pomlčka a zůstatek prázdný) a dvě výplaty. Německý protějšek „Rückzahlung“
   * parser zná a upozorní na něj; anglický končí chybou „neznámý typ“.
   */
  it('EN „Redemption“ dostane stejné upozornění jako německé „Rückzahlung“', () => {
    const csv = [
      SWISSQUOTE_HEADER_EN,
      '14-07-2025 16:34:27;00000000;Redemption;NDWD;NORDWIND HOLDING;CH0000000001;1.0;35.20;0.00;0.00;35.20;8035.20;USD',
      '12-07-2025 16:21:03;00000000;Redemption;NDWD;NORDWIND HOLDING;CH0000000001;-200.0;40.000000;0.00;0.00;-;;USD',
      '12-07-2025 16:21:03;00000000;Redemption;NDWD;NORDWIND HOLDING;CH0000000001;1.0;8000.00;0.00;0.00;8000.00;8000.00;USD',
    ].join('\n');
    const result = parseSwissquoteCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.warnings.filter((w) => w.message.includes('Redemption'))).toHaveLength(3);
  });

  /**
   * Doloženo: příloha fóra PP, vlákno 31207 — `…,Split,BANB,BACHEM N,
   * CH1176493729,855,0,0,0,-,CHF,…` + `…,Split,BANB,BACHEM N -B-,CH0012530207,
   * -171,…` (pár: nový ISIN plus, starý minus) a `…,Titeleingang,PPGN,…,3148,
   * 95.1,0,0,-,CHF,…` (příjem kusů bez peněz). Parser zná jen „Interne
   * Titelumbuchung“. Kdo je neumí zaúčtovat, má aspoň říct, co doplnit —
   * „neznámý typ, nahlaš nám ho“ u běžné korporátní akce neříká nic.
   */
  it('DE „Split“ a „Titeleingang“ nejsou neznámý typ — dostanou upozornění, co doplnit', () => {
    const csv = [
      SWISSQUOTE_HEADER_DE,
      '05-05-2025 09:14:00;00000000;Split;NDWD;NORDWIND HOLDING;CH0000000002;500.0;0.00;0.00;0.00;-;CHF;-;;CHF',
      '05-05-2025 09:14:00;00000000;Split;NDWD;NORDWIND HOLDING -B-;CH0000000001;-100.0;0.00;0.00;0.00;-;CHF;-;;CHF',
      '19-07-2025 09:30:00;00000000;Titeleingang;NDWD;NORDWIND HOLDING;CH0000000002;40.0;12.50;0.00;0.00;-;CHF;-;;CHF',
    ].join('\n');
    const result = parseSwissquoteCsv(csv);

    expect(result.errors.map((e) => e.message).join('\n')).not.toContain('Neznámý typ transakce');
    const handled = result.transactions.length + result.warnings.length;
    expect(handled).toBeGreaterThanOrEqual(3);
  });
});
