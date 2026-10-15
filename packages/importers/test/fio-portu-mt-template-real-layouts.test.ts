/**
 * Fio e-Broker, Portu, MetaTrader 4/5, univerzální šablona a rady, které na
 * ni odkazují z ostatních parserů (audit 13. 10. 2026).
 *
 * Komentáře u testů popisují vadu, kterou test hlídá — tedy chování PŘED
 * opravou z toho dne. Kde je správných řešení víc (zaúčtovat × srozumitelně
 * odmítnout), bere test obě.
 *
 * Vzorky nesou jen ROZLOŽENÍ skutečných exportů; čísla, tituly, účty a časy
 * jsou smyšlené. Zdroje rozložení:
 *  - Fio: ukázkový export „Přehled operací pro portfolio“ na
 *    kacka.baldsoft.com/demo/TradeFio2011.csv (soubor vytvořený 15. 9. 2016)
 *    a manuál e-Brokeru (fio.cz/docs/cz/manual_ebroker.pdf, kap. Obchody).
 *  - MT5: parsery psané nad skutečnými reporty — kgodinezc/Trading
 *    (app/js/core/parser.js, sešit z Exness), khnguyendinh/TradeMonitor
 *    (MT5LogParserServiceTest.java) a niken-003/check-your-trading-strategy.
 *  - Portu: magazin.portu.cz/rekvalifikace-dividend-zmatek-v-transakcich
 *    (27. 5. 2020) — záporné dividendy v přehledu transakcí; skutečný export
 *    „Transakční historie“ nahraný uživatelem 15. 10. 2026 — tvar sloupce Typ
 *    a druhy pohybů (`PORTU_REAL_LAYOUT_FIXTURE`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { analyzeTaxYear, type TaxYearConfig } from '@danero/engine';
import { d, TaxpayerProfileSchema, type Transaction } from '@danero/shared';
import {
  parseFioCsv,
  parseIbkrFlexXml,
  parseMt4Html,
  parseMt5Html,
  parseMt5Xlsx,
  parsePortuCsv,
  parseUniversalCsv,
  sniffMt4Html,
  UNIVERSAL_TEMPLATE_TYPES,
  type ImportResult,
} from '../src';
import { FIO_SYMBOL_MAP } from './fixtures/fio';
import { buildMt4Html, buildMt5Html, MT5_DEALS, mt5DealHtmlRow } from './fixtures/metatrader';
import { PORTU_HEADER, PORTU_REAL_LAYOUT_FIXTURE } from './fixtures/portu';

/** Kulaté testovací kurzy (NE skutečné) — stejný tvar jako v e2e.engine.test.ts. */
const CONFIG: TaxYearConfig = {
  year: 2025,
  unifiedRatesByYear: {
    2021: { USD: '22' },
    2024: { USD: '23' },
    2025: { USD: '20' },
  },
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

const analyze = (transactions: Transaction[]) =>
  analyzeTaxYear({
    transactions,
    profile: TaxpayerProfileSchema.parse({ regime: 'PAUSAL' }),
    config: CONFIG,
  });

/* ── Fio e-Broker ────────────────────────────────────────────────────────── */

describe('Fio e-Broker: skutečný tvar exportu „Přehled operací“', () => {
  /**
   * Skutečný export začíná třemi řádky preambule a prázdným řádkem, hlavička
   * i datové řádky končí středníkem a pod daty je řádek „Součet“. Sloupec
   * „Datum vypořádání“ si uživatel přidává v !Nastavení.
   */
  const HEADER =
    'Datum obchodu;Směr;Symbol;Cena;Počet;Měna;Objem v CZK;Poplatky v CZK;Objem v USD;Poplatky v USD;Objem v EUR;Poplatky v EUR;Text FIO;Datum vypořádání;';
  const PREAMBLE = [
    'Přehled operací pro portfolio"Moje portfolio"',
    'Vytvořeno: 05.01.2026 10:00:00',
    'Období: 1.1.2025 - 31.12.2025',
    '',
  ];
  // 15 × 41,20 = 618,00; objem ve Fiu zahrnuje poplatek (618,00 + 1,95)
  const BUY_ROW = '12.02.2025 10:15;Nákup;AAPL;41,20;15,00;USD;;;-619,95;1,95;;;Nákup;14.02.2025;';
  const INCOMING_TRANSFER_ROW =
    '03.02.2025 00:00;;;;0,00;USD;;;700,00;0,00;;;Převod z účtu - Fio banka 2000000001 VS:2000000001, KS:, SS:1000000001, US:Dorovnání OÚ;03.02.2025;';
  const TOTAL_ROW = ';;Součet;;;;;;80,05;1,95;;;;;';

  it('výpis s preambulí (název portfolia, Vytvořeno, Období) se přečte — nákup je v něm', () => {
    const text = [...PREAMBLE, HEADER, BUY_ROW].join('\r\n');
    const result = parseFioCsv(text, { symbolMap: FIO_SYMBOL_MAP });

    const buys = result.transactions.filter((tx) => tx.type === 'BUY');
    expect(buys).toHaveLength(1);
    const buy = buys[0]!;
    if (buy.type !== 'BUY') throw new Error('nečekaný typ');
    expect(buy.isin).toBe('US0378331005');
    expect(buy.quantity.toString()).toBe('15');
    expect(buy.pricePerShare.toString()).toBe('41.2');
    expect(buy.fee?.amount.toString()).toBe('1.95');
    expect(buy.tradeDate).toBe('2025-02-12');
  });

  it('součtový řádek „Součet“ pod daty není chyba', () => {
    const result = parseFioCsv([HEADER, BUY_ROW, TOTAL_ROW].join('\r\n'), {
      symbolMap: FIO_SYMBOL_MAP,
    });
    expect(result.transactions).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('příchozí převod peněz (prázdný Směr, text „Převod z účtu …“) není „neznámý řádek — nahlaš nám ho“', () => {
    const result = parseFioCsv([HEADER, BUY_ROW, INCOMING_TRANSFER_ROW].join('\r\n'), {
      symbolMap: FIO_SYMBOL_MAP,
    });
    // vklad smí skončit jako DEPOSIT i jako přeskočený řádek — jen ne jako chyba
    expect(result.errors).toEqual([]);
    expect(result.transactions.filter((tx) => tx.type === 'BUY')).toHaveLength(1);
  });

  it('řádek se zápornou částkou, který se zařadí jako dividenda, se neotočí na kladný příjem', () => {
    // Daň je ve výpisu samostatný řádek se zápornou částkou. Popis, který
    // nezačíná slovem „Daň“, dnes spadne do větve dividendy a `abs()` z něj
    // udělá druhou dividendu (domněnka o znění textu, mechanismus je v kódu).
    const header =
      'Datum obchodu;Směr;Symbol;Cena;Počet;Měna;Objem v CZK;Poplatky v CZK;Objem v USD;Poplatky v USD;Objem v EUR;Poplatky v EUR;Text FIO';
    const result = parseFioCsv(
      [
        header,
        '10.05.2026;;AAPL;;;USD;;;25,00;;;;AAPL - Dividenda',
        '10.05.2026;;AAPL;;;USD;;;-3,75;;;;AAPL - Daň z dividendy',
      ].join('\n'),
      { symbolMap: FIO_SYMBOL_MAP },
    );
    const dividends = result.transactions.filter((tx) => tx.type === 'DIVIDEND');
    const grossTotal = dividends.reduce(
      (sum, tx) => (tx.type === 'DIVIDEND' ? sum.plus(tx.gross) : sum),
      d(0),
    );
    // správně: jedna dividenda 25 (se srážkou 3,75, nebo bez ní a s varováním)
    expect(grossTotal.toString()).toBe('25');
  });
});

/* ── Portu ───────────────────────────────────────────────────────────────── */

describe('Portu: storno dividendy', () => {
  it('záporná dividenda se nezaúčtuje jako kladný příjem', () => {
    // Portu při rekvalifikaci dividend připisuje „záporné dividendy“
    // (magazín Portu, 27. 5. 2020). Parser bere `abs()` hrubé výše i Hodnoty.
    const result = parsePortuCsv(
      [
        PORTU_HEADER,
        '10.03.2026;Moje portfolio;Dividenda;LQDE;IE0032895942;;iShares $ Corp Bond UCITS ETF;;12,35;USD;2,18;14,53',
        '25.05.2026;Moje portfolio;Dividenda;LQDE;IE0032895942;;iShares $ Corp Bond UCITS ETF;;-12,35;USD;-2,18;-14,53',
      ].join('\n'),
    );
    const grossTotal = result.transactions.reduce(
      (sum, tx) => (tx.type === 'DIVIDEND' ? sum.plus(tx.gross) : sum),
      d(0),
    );
    // Správně je buď storno započtené (součet 0), nebo řádek odmítnutý či
    // ohlášený varováním (součet 14,53). Dvojnásobek 29,06 je chyba.
    const flagged = [...result.errors, ...result.warnings].some((issue) => issue.line === 3);
    expect(
      { grossTotal: grossTotal.toString(), flagged },
      'storno se přičetlo jako druhá dividenda a nikde se to neřeklo',
    ).not.toEqual({ grossTotal: '29.06', flagged: false });
  });
});

describe('Portu: skutečný tvar sloupce Typ', () => {
  /**
   * Do 15. 10. 2026 parser čekal v Typu holé „Nákup“ (slovník byl odvozený
   * z filtrů v aplikaci Portu). Skutečný export za druh píše podrobnosti
   * („Nákup – VWCE GY – 0,4823 kusů (…)“), takže první nahraný výpis skončil
   * „Neznámý typ pohybu“ na každém řádku a nenačetlo se z něj nic.
   */
  const result = parsePortuCsv(PORTU_REAL_LAYOUT_FIXTURE);

  it('žádný řádek skutečného exportu nekončí chybou', () => {
    expect(result.errors).toEqual([]);
  });

  it('úrok z Investiční rezervy → INTEREST v CZK, česká země zdroje, srážka 0 (R-07g)', () => {
    const interest = result.transactions.filter((tx) => tx.type === 'INTEREST');
    expect(interest).toHaveLength(1);
    const [tx] = interest;
    if (tx?.type !== 'INTEREST') throw new Error('unreachable');
    expect(tx.amount.toString()).toBe('212.4');
    expect(tx.currency).toBe('CZK');
    expect(tx.withholdingTax.toString()).toBe('0');
    expect(tx.sourceCountry).toBe('CZ');
    expect(tx.date).toBe('2025-07-31');
  });

  it('záporný úrok se nepřičte, ale ohlásí', () => {
    const negative = parsePortuCsv(
      [PORTU_HEADER, '31.05.2025;Rezerva;Úrok;;CZK000000001;;;;-3,10;CZK;0,00;'].join('\n'),
    );
    expect(negative.transactions).toEqual([]);
    expect(negative.warnings[0]?.message).toContain('Záporný úrok');
  });

  it('tisíce kusů s pevnou mezerou se přečtou celé', () => {
    const buy = result.transactions.find((tx) => tx.type === 'BUY');
    if (buy?.type !== 'BUY') throw new Error('unreachable');
    expect(buy.quantity.toString()).toBe('1250');
    expect(buy.pricePerShare.toString()).toBe('1.2');
    expect(buy.isin).toBe('CZ0000000017');
  });

  it('výběr, sleva na poplatku, půjčka od Portu a přesuny mezi portfolii se přeskočí bez varování', () => {
    // přesun kusů mezi vlastními portfolii nesmí být prodej ani nákup — jinak
    // by se nabytí posunulo na den přesunu a časový test začal znovu
    expect(result.transactions.map((tx) => tx.type)).toEqual(['INTEREST', 'BUY']);
    expect(result.skipped.map((s) => s.line)).toEqual(
      expect.arrayContaining([3, 4, 5, 6, 7, 8, 9, 10]),
    );
    expect(result.warnings.filter((w) => w.line >= 3 && w.line <= 10)).toEqual([]);
  });

  it('měnové zajištění (R-12u): nohy přeskočené, JEDNO upozornění za soubor s počtem a roky', () => {
    const hedgeSkipped = result.skipped.filter((s) => s.message.includes('měnového zajištění'));
    expect(hedgeSkipped.map((s) => s.line)).toEqual([11, 12, 13, 14, 15, 16, 17, 18]);

    expect(result.warnings).toHaveLength(1);
    const [warning] = result.warnings;
    expect(warning?.line).toBe(11);
    expect(warning?.message).toContain('8 pohybů měnového zajištění');
    expect(warning?.message).toContain('z let 2023, 2025');
    expect(warning?.message).toContain('§ 10');
  });

  it('jediná zajišťovací noha: upozornění v jednotném čísle', () => {
    const single = parsePortuCsv(
      [
        PORTU_HEADER,
        '10.11.2025;Moje portfolio;Forex nákup – 2.9.2025 Forward EURCZK;;EZ0000000001;;2.9.2025 Forward EURCZK;;7\u00a0410,50;CZK;;',
      ].join('\n'),
    );
    expect(single.warnings[0]?.message).toContain('1 pohyb měnového zajištění');
    expect(single.warnings[0]?.message).toContain('z roku 2025');
  });

  it('přesun kusů bez druhé strany (výpis jen jednoho portfolia) se ohlásí', () => {
    // Uživatel stáhne výpis jen cílového portfolia: kusy, které do něj přišly,
    // nemají nákup, a prodej z nich by skončil zápornou pozicí bez vysvětlení.
    const oneSided = parsePortuCsv(
      [
        PORTU_HEADER,
        '18.02.2026;Rezerva;Převod z Moje portfolio – VWCE GY – 0,2100 kusů;VWCE GY;IE00BK5BQT80;0,2100;;121,3000;25,47;EUR;;',
      ].join('\n'),
    );
    expect(oneSided.errors).toEqual([]);
    expect(oneSided.warnings).toHaveLength(1);
    expect(oneSided.warnings[0]?.message).toContain('nemá ve výpisu druhou stranu');
    expect(oneSided.warnings[0]?.message).toContain('0.21 ks');
  });

  it('neznámý „vklad“ (třeba cenných papírů) nepropadne potichu jako převod peněz', () => {
    const unknown = parsePortuCsv(
      [
        PORTU_HEADER,
        '02.03.2026;Moje portfolio;Vklad cenných papírů – VWCE GY – 3 kusy;VWCE GY;IE00BK5BQT80;3;;;;EUR;;',
      ].join('\n'),
    );
    expect(unknown.errors[0]?.message).toContain('Neznámý typ pohybu');
  });

  it('obyčejná konverze měny upozornění na zajištění nevyvolá', () => {
    const spot = parsePortuCsv(
      [
        PORTU_HEADER,
        '12.02.2026;Moje portfolio;Forex nákup – CZK/EUR;;;;CZK/EUR;;40,00;EUR;;',
        '12.02.2026;Moje portfolio;Forex prodej – EUR/CZK;;;;EUR/CZK;;-976,00;CZK;;',
      ].join('\n'),
    );
    expect(spot.skipped).toHaveLength(2);
    expect(spot.warnings).toEqual([]);
  });
});

/* ── MetaTrader 5 ────────────────────────────────────────────────────────── */

describe('MetaTrader 5: hlavička skutečného reportu', () => {
  const DEAL_COLUMNS = [
    'Time', 'Deal', 'Symbol', 'Type', 'Direction', 'Volume', 'Price', 'Order',
    'Commission', 'Fee', 'Swap', 'Profit', 'Balance', 'Comment',
  ];
  // otevření + uzavření EURUSD z výchozí fixtury: čistý výsledek 123,75
  const DEALS = MT5_DEALS.slice(1, 3);

  /**
   * Skutečný report nemá řádek „Currency:“. Měna účtu je v závorce u čísla
   * účtu a popisek „Account:“ leží v JINÉ buňce než hodnota.
   */
  const realHtml = (account: string): string =>
    [
      '<html>',
      '<head><title>555001: Test User - Trade History Report</title></head>',
      '<body>',
      '<div align="center">',
      '<table cellspacing="1" cellpadding="3" border="0">',
      '<tr align="center"><th colspan="14"><div style="font: 20pt Tahoma"><b>Trade History Report</b></div></th></tr>',
      '<tr align="left"><th colspan="4" nowrap align="right">Name:</th><th colspan="10" nowrap align="left"><b>Test User</b></th></tr>',
      `<tr align="left"><th colspan="4" nowrap align="right">Account:</th><th colspan="10" nowrap align="left"><b>${account}</b></th></tr>`,
      '<tr align="left"><th colspan="4" nowrap align="right">Company:</th><th colspan="10" nowrap align="left"><b>Test Trading Ltd</b></th></tr>',
      '<tr align="left"><th colspan="4" nowrap align="right">Date:</th><th colspan="10" nowrap align="left"><b>2026.01.05 12:00</b></th></tr>',
      '<tr align="center"><th colspan="14"><div style="font: 10pt Tahoma"><b>Deals</b></div></th></tr>',
      `<tr align="center" bgcolor="#E5F0FC">${DEAL_COLUMNS.map((column) => `<td nowrap><b>${column}</b></td>`).join('')}</tr>`,
      ...DEALS.map(mt5DealHtmlRow),
      '<tr align="right"><td nowrap colspan="8"></td><td nowrap><b>-1.40</b></td><td nowrap><b>-0.10</b></td><td nowrap><b>-0.25</b></td><td nowrap><b>125.50</b></td><td nowrap><b>10 123.75</b></td><td nowrap></td></tr>',
      '</table>',
      '</div>',
      '</body>',
      '</html>',
    ].join('\n');

  const expectEurusdTrade = (result: ImportResult): void => {
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(2);
    const sell = result.transactions.find((tx) => tx.type === 'SELL');
    if (!sell || sell.type !== 'SELL') throw new Error('uzavírací noha chybí');
    expect(sell.currency).toBe('EUR');
    expect(sell.pricePerShare.toString()).toBe('123.75');
  };

  it('HTML: měna účtu se vezme ze závorky „555001 (EUR, server, real, Hedge)“ vedle popisku „Account:“', () => {
    expectEurusdTrade(parseMt5Html(realHtml('555001 (EUR, Test-Server, real, Hedge)')));
  });

  it('XLSX: popisek „Account:“ ve sloupci A, hodnota se závorkou až ve sloupci D', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['Trade History Report']);
    sheet.addRow(['Name:', null, null, 'Test User']);
    sheet.addRow(['Account:', null, null, '555001 (EUR, Test-Server, real, Hedge)']);
    sheet.addRow(['Company:', null, null, 'Test Trading Ltd']);
    sheet.addRow(['Date:', null, null, '2026.01.05 12:00']);
    sheet.addRow(['Deals']);
    sheet.addRow(DEAL_COLUMNS);
    for (const deal of DEALS) {
      sheet.addRow([
        deal.time, deal.deal, deal.symbol, deal.type, deal.direction, deal.volume ?? '',
        // skutečný sešit nese čísla jako čísla, ne jako text
        Number(deal.price), deal.order ?? '', Number(deal.commission), Number(deal.fee ?? '0'),
        Number(deal.swap), Number(deal.profit), null, deal.comment ?? null,
      ]);
    }
    sheet.addRow([null, null, null, null, null, null, null, null, -1.4, -0.1, -0.25, 125.5, 10123.75]);
    const raw = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);

    expectEurusdTrade(await parseMt5Xlsx(buffer));
  });
});

describe('MetaTrader: centový účet (měna „USC“)', () => {
  /**
   * Centové účty (Exness Standard Cent, RoboForex ProCent…) vedou zůstatek
   * v centech a report u nich uvádí měnu „USC“. Kód projde kontrolou tří
   * písmen, kurz k němu ale neexistuje — engine pak skončí na FX_RATE_MISSING
   * a s ním celý výpočet. Správně: přepočet na USD (÷ 100), nebo odmítnutí
   * s větou, která centový účet pojmenuje.
   */
  const expectCentHandled = (result: ImportResult, netInCents: string): void => {
    const currencies = result.transactions.map((tx) =>
      tx.type === 'BUY' || tx.type === 'SELL' ? tx.currency : '',
    );
    expect(currencies).not.toContain('USC');
    if (result.transactions.length === 0) {
      expect(result.errors.map((error) => error.message).join('\n')).toMatch(/cent/i);
      return;
    }
    const sells = result.transactions.filter((tx) => tx.type === 'SELL');
    const expected = d(netInCents).div(100).toString();
    expect(
      sells.some(
        (tx) => tx.type === 'SELL' && tx.currency === 'USD' && tx.pricePerShare.toString() === expected,
      ),
    ).toBe(true);
  };

  it('MT5: výsledek 123,75 USC je 1,2375 USD', () => {
    expectCentHandled(parseMt5Html(buildMt5Html({ currency: 'USC' })), '123.75');
  });

  it('MT4: výsledek 14,34 USC je 0,1434 USD', () => {
    expectCentHandled(parseMt4Html(buildMt4Html({ currency: 'USC' })), '14.34');
  });
});

describe('MetaTrader 4: sniffer nesmí být přísnější než parser', () => {
  it('statement, který parser přečte, pozná i autodetekce — titulek stránky parser nečte', () => {
    // Sniffer chce `<title>Statement…`, parser se na titulek nedívá: stačí mu
    // sekce „Closed Transactions:“ a měna. Statement s jiným titulkem tak
    // skončí u „HTML soubor nepoznáváme“, přestože ho přečíst umíme.
    const html = buildMt4Html().replace('<title>Statement: 12345678</title>', '<title>12345678</title>');
    const parsed = parseMt4Html(html);
    expect(parsed.errors).toEqual([]);
    expect(parsed.transactions.length).toBeGreaterThan(0);
    expect(sniffMt4Html(html)).toBe(true);
  });
});

/* ── Univerzální šablona ─────────────────────────────────────────────────── */

describe('univerzální šablona: řádek, který shodí celý výpočet', () => {
  it('SPINOFF bez new_isin se odmítne už při importu (engine na něm jinak končí výjimkou)', () => {
    const parsed = parseUniversalCsv(
      [
        'type,date,isin,quantity,price,currency,subtype,ratio_from,ratio_to,new_isin',
        'BUY,2024-01-10,US1111111111,10,100,USD,,,,',
        'CORPORATE_ACTION,2025-03-01,US1111111111,,,,SPINOFF,1,1,',
      ].join('\n'),
    );
    const refused = parsed.errors.some((error) => error.line === 3);
    if (refused) return;
    // parser řádek pustil → engine si s ním musí poradit bez výjimky
    expect(() => analyze(parsed.transactions)).not.toThrow();
  });
});

describe('univerzální šablona: derivát bez asset_class', () => {
  it('řádek se settlement_style=margin a prefixem CFD: bez asset_class neprojde tiše jako akcie', () => {
    // Rada z výpisu XTB zní „doplň přes univerzální šablonu (derivát, řádky
    // s prefixem CFD:)“ — sloupec asset_class nejmenuje. Bez něj je řádek
    // akcie: nominál pozice se počítá do limitu 100 000 Kč a na výsledek se
    // vztáhne osvobození, které deriváty nemají.
    const parsed = parseUniversalCsv(
      [
        'type,date,isin,name,asset_class,settlement_style,quantity,price,currency',
        'BUY,2026-02-02,CFD:US500,S&P 500 CFD,,margin,2,5000,USD',
        'SELL,2026-03-16,CFD:US500,S&P 500 CFD,,margin,2,5150,USD',
      ].join('\n'),
    );
    const trades = parsed.transactions.filter((tx) => tx.type === 'BUY' || tx.type === 'SELL');
    const asStock = trades.some(
      (tx) => (tx.type === 'BUY' || tx.type === 'SELL') && tx.assetClass !== 'DERIVATIVE',
    );
    const said = [...parsed.errors, ...parsed.warnings].length > 0;
    expect(asStock && !said, 'derivát se uložil jako akcie a nikde se to neřeklo').toBe(false);
  });
});

/* ── Rady v hláškách parserů, které na šablonu odkazují ──────────────────── */

describe('rada „doplň přes univerzální šablonu“ jde provést', () => {
  it('IBKR příchozí převod: po doplnění TRANSFER_IN podle rady je v evidenci pořád 10 kusů, ne 20', () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<FlexQueryResponse queryName="danero" type="AF">',
      '<FlexStatements count="1">',
      '<FlexStatement accountId="U1234567" fromDate="20250101" toDate="20251231" period="Custom" whenGenerated="20260105;120000">',
      '<Transfers>',
      '<Transfer accountId="U1234567" assetCategory="STK" symbol="MSFT" description="MICROSOFT CORP" conid="272093" isin="US5949181045" currency="USD" date="20250505" type="ACATS" direction="IN" quantity="10" transactionID="9301" levelOfDetail="DETAIL" />',
      '</Transfers>',
      '</FlexStatement>',
      '</FlexStatements>',
      '</FlexQueryResponse>',
    ].join('\n');
    const ibkr = parseIbkrFlexXml(xml);
    expect(ibkr.errors).toEqual([]);
    const advice = ibkr.warnings.find((warning) => warning.message.includes('Příchozí převod'));
    // rada na šablonu neodkazuje → není co ověřovat
    if (!advice?.message.includes('šablon')) return;

    // přesně to, co rada říká: TRANSFER_IN s původním nabytím
    const template = parseUniversalCsv(
      [
        'type,date,isin,ticker,quantity,acquisition_date,acquisition_price,acquisition_currency',
        'TRANSFER_IN,2025-05-05,US5949181045,MSFT,10,2021-03-01,240.00,USD',
      ].join('\n'),
    );
    expect(template.errors).toEqual([]);

    // dedupe je jmenný prostor per broker, takže se uloží oba řádky
    const result = analyze([...ibkr.transactions, ...template.transactions]);
    const held = result.ledger.lots
      .filter((lot) => lot.isin === 'US5949181045')
      .reduce((sum, lot) => sum.plus(lot.remaining), d(0));
    expect(held.toString()).toBe('10');
  });

  /** Řádky zdrojáků parserů s hláškou pro uživatele (bez komentářů). */
  const parserMessageLines = (): Array<{ where: string; text: string }> => {
    const root = fileURLToPath(new URL('../src', import.meta.url));
    const lines: Array<{ where: string; text: string }> = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          // šablona sama o sobě mluví jinak než rady, které na ni odkazují
          if (entry.name !== 'universal') walk(path);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        readFileSync(path, 'utf8')
          .split('\n')
          .forEach((text, index) => {
            const trimmed = text.trim();
            if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;
            lines.push({ where: `${path.slice(root.length + 1)}:${index + 1}`, text: trimmed });
          });
      }
    };
    walk(root);
    return lines;
  };

  it('žádná hláška neradí „upravit“ šablonou řádek, který parser sám uložil', () => {
    // Šablona je jiný jmenný prostor dedupe a jednotlivou transakci smazat
    // nejde (jen celý import). Řádek dopsaný „na opravu“ se proto k uloženému
    // přičte: dividenda, obchod i opce jsou pak v evidenci dvakrát. Hláška
    // smí šablonu zmínit jen s poctivým návodem (vrátit import zpět) —
    // tak to už dělá varování u obchodu IBKR, který zavírá i otevírá pozici.
    const honest = /vrať|zpět|podruhé|zdvoj|nahrad/i;
    const misleading = parserMessageLines()
      .filter(({ text }) => text.includes('šablon') && /\buprav\b/i.test(text) && !honest.test(text))
      .map(({ where }) => where);
    expect(misleading).toEqual([]);
  });

  it('hláška, která radí doplnit „ostatní příjem“, má v šabloně typ, kterým to jde zapsat', () => {
    // Šablona umí z příjmů jen DIVIDEND a INTEREST. Odměnu ze stakingu nebo
    // z affiliate programu jako „ostatní příjem“ nezapíšeš ničím.
    const promises = parserMessageLines()
      .filter(({ text }) => text.includes('šablon') && text.includes('ostatní příjem'))
      .map(({ where }) => where);
    const templateCanRecordIt = UNIVERSAL_TEMPLATE_TYPES.some((type) => /INCOME/.test(type));
    expect(templateCanRecordIt ? [] : promises).toEqual([]);
  });
});
