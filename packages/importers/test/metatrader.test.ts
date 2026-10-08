import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { d } from '@danero/shared';
import { brokerIdKey, dedupeTransactions } from '../src';
import { extractHtmlRows, findAccountCurrency, type HtmlRow } from '../src/metatrader/common';
import { MT4_BROKER, parseMt4Html, sniffMt4Html } from '../src/metatrader/mt4-html';
import {
  MT5_BROKER,
  parseMt5Html,
  parseMt5Xlsx,
  sniffMt5Html,
  sniffMt5Xlsx,
} from '../src/metatrader/mt5';
import type { ImportResult } from '../src/types';
import type { BuyTransaction, SellTransaction } from '@danero/shared';
import {
  buildForeignXlsx,
  buildMt4Html,
  buildMt5Html,
  buildMt5Xlsx,
  MT4_HTML,
  MT4_OPEN_TRADE_ROW,
  MT5_DEALS,
  mt5DealHtmlRow,
  MT5_HTML,
} from './fixtures/metatrader';

/** Syntetický pár obchodu podle unikátního ISIN (MT4:<ticket> / MT5:<deal>). */
function pairOf(result: ImportResult, isin: string): { buy: BuyTransaction; sell: SellTransaction } {
  const buy = result.transactions.find((tx) => tx.type === 'BUY' && tx.isin === isin);
  const sell = result.transactions.find((tx) => tx.type === 'SELL' && tx.isin === isin);
  if (!buy || buy.type !== 'BUY' || !sell || sell.type !== 'SELL') {
    throw new Error(`pár ${isin} nenalezen`);
  }
  return { buy, sell };
}

/** Součet plnění: SELL nohy plus, BUY nohy minus = celkový čistý výsledek. */
function netSum(result: ImportResult) {
  return result.transactions.reduce((acc, tx) => {
    if (tx.type === 'SELL') return acc.plus(tx.pricePerShare);
    if (tx.type === 'BUY') return acc.minus(tx.pricePerShare);
    throw new Error(`nečekaný typ transakce ${tx.type}`);
  }, d(0));
}

/** Číslo řádku fixture podle obsahu — datové řádky jsou v souboru na jednom řádku. */
function lineOf(text: string, needle: string): number {
  const index = text.split('\n').findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`řádek s „${needle}“ nenalezen`);
  return index + 1;
}

const FOREIGN_CSV = 'type,date,isin\nBUY,2024-01-01,US0378331005\n';

describe('MT4 HTML statement parser', () => {
  it('happy path: 4 uzavřené obchody → 8 transakcí, balance skipped, currency z hlavičky', () => {
    const result = parseMt4Html(MT4_HTML);

    expect(result.broker).toBe(MT4_BROKER);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(8);
    expect(result.transactions.every((tx) => tx.type === 'BUY' || tx.type === 'SELL')).toBe(true);

    // balance vklad se přeskakuje s vysvětlením (částka s mezerou v tisících)
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.message).toContain('1 700.00 GBP');
    expect(result.skipped[0]!.message).toContain('nedaní');
  });

  it('ziskový obchod (R-12m): net = 15.51 + (-1.17) = 14.34 → BUY 0 + SELL 14.34', () => {
    const result = parseMt4Html(MT4_HTML);
    const { buy, sell } = pairOf(result, 'MT4:127763685');

    expect(buy.id).toBe('mt4-127763685-open');
    expect(sell.id).toBe('mt4-127763685-close');
    expect(buy.pricePerShare.toString()).toBe('0');
    expect(sell.pricePerShare.toString()).toBe('14.34');
    expect(buy.tradeDate).toBe('2023-09-11'); // open time
    expect(sell.tradeDate).toBe('2023-11-28'); // close time
    for (const leg of [buy, sell]) {
      expect(leg.quantity.toString()).toBe('1');
      expect(leg.currency).toBe('GBP');
      expect(leg.ticker).toBe('GBPUSD');
      expect(leg.assetClass).toBe('DERIVATIVE');
      expect(leg.settlementStyle).toBe('MARGIN');
    }
  });

  it('ztrátový obchod: net = -6.76 - 0.50 = -7.26 → BUY 7.26 + SELL 0', () => {
    const result = parseMt4Html(MT4_HTML);
    const { buy, sell } = pairOf(result, 'MT4:126991071');

    expect(buy.pricePerShare.toString()).toBe('7.26');
    expect(sell.pricePerShare.toString()).toBe('0');
    expect(buy.ticker).toBe('XAUUSD');
  });

  it('nulový výsledek: obchod proběhl → BUY 0 + SELL 0', () => {
    const result = parseMt4Html(MT4_HTML);
    const { buy, sell } = pairOf(result, 'MT4:128000001');

    expect(buy.pricePerShare.toString()).toBe('0');
    expect(sell.pricePerShare.toString()).toBe('0');
  });

  it('číslo s mezerou v tisících: profit „1 234.56“ + swap -0.44 → SELL 1234.12', () => {
    const result = parseMt4Html(MT4_HTML);
    const { buy, sell } = pairOf(result, 'MT4:128100002');

    expect(buy.pricePerShare.toString()).toBe('0');
    expect(sell.pricePerShare.toString()).toBe('1234.12');
  });

  it('součet plnění sedí na Closed P/L statementu (1 241.20)', () => {
    const result = parseMt4Html(MT4_HTML);
    expect(netSum(result).toString()).toBe('1241.2');
  });

  it('otevřené pozice → JEDEN warning s vysvětlením (i při více pozicích)', () => {
    const result = parseMt4Html(
      buildMt4Html({ openRows: [MT4_OPEN_TRADE_ROW, MT4_OPEN_TRADE_ROW] }),
    );

    const openWarnings = result.warnings.filter((w) => w.message.includes('Open Trades'));
    expect(openWarnings).toHaveLength(1);
    expect(openWarnings[0]!.message).toContain('nedaní');
    expect(openWarnings[0]!.line).toBe(lineOf(MT4_HTML, '144165417'));
  });

  it('bez otevřených pozic → žádný warning', () => {
    const result = parseMt4Html(buildMt4Html({ openRows: [] }));
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('chybějící měna účtu → error celého souboru, nic se neimportuje', () => {
    const result = parseMt4Html(buildMt4Html({ currency: null }));

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('chybí měna účtu');
  });

  it('soubor bez sekce Closed Transactions → srozumitelný error', () => {
    const result = parseMt4Html('<html><body><table><tr><td>foo</td></tr></table></body></html>');

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('Closed Transactions');
  });

  it('prázdný soubor → prázdný výsledek bez chyb', () => {
    const result = parseMt4Html('');
    expect(result.errors).toEqual([]);
    expect(result.transactions).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('vadné řádky → errors se skutečným číslem řádku, ostatní řádky se zpracují', () => {
    const badDate =
      '<tr align="right"><td>128999001</td><td class="msdate">2023.13.45 10:00:00</td><td>buy</td><td class="mspt">0.01</td><td>eurusd</td><td>1.1</td><td>0</td><td>0</td><td class="msdate">2023.12.01 10:00:00</td><td>1.2</td><td class="mspt">0.00</td><td class="mspt">0.00</td><td class="mspt">0.00</td><td class="mspt">1.00</td></tr>';
    const badNumber =
      '<tr align="right"><td>128999002</td><td class="msdate">2023.11.01 10:00:00</td><td>sell</td><td class="mspt">0.01</td><td>eurusd</td><td>1.1</td><td>0</td><td>0</td><td class="msdate">2023.12.01 10:00:00</td><td>1.2</td><td class="mspt">0.00</td><td class="mspt">0.00</td><td class="mspt">0.00</td><td class="mspt">abc</td></tr>';
    const goodRow =
      '<tr align="right"><td>128999005</td><td class="msdate">2023.11.01 10:00:00</td><td>buy</td><td class="mspt">0.01</td><td>eurusd</td><td>1.1</td><td>0</td><td>0</td><td class="msdate">2023.12.01 10:00:00</td><td>1.2</td><td class="mspt">0.00</td><td class="mspt">0.00</td><td class="mspt">0.00</td><td class="mspt">2.00</td></tr>';
    const html = buildMt4Html({ closedRows: [badDate, badNumber, goodRow], openRows: [] });
    const result = parseMt4Html(html);

    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]!.message).toContain('neplatné datum');
    expect(result.errors[0]!.line).toBe(lineOf(html, '128999001'));
    expect(result.errors[1]!.message).toContain('nečitelné číslo');
    expect(result.errors[1]!.line).toBe(lineOf(html, '128999002'));
    expect(result.transactions).toHaveLength(2); // vadné řádky nezastaví zbytek
  });

  it('neznámý typ řádku → error „nahlaš nám ho“; zrušený čekající pokyn → skipped', () => {
    const unknown =
      '<tr align="right"><td>128999003</td><td class="msdate">2023.11.01 10:00:00</td><td>rollover</td><td colspan="10">rollover fee</td><td class="mspt">-1.00</td></tr>';
    const cancelled =
      '<tr align="right"><td>128999004</td><td class="msdate">2023.11.01 10:00:00</td><td>buy limit</td><td class="mspt">0.01</td><td>eurusd</td><td>1.05</td><td>0</td><td>0</td><td class="msdate">2023.11.02 10:00:00</td><td>cancelled</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>';
    const result = parseMt4Html(buildMt4Html({ closedRows: [unknown, cancelled], openRows: [] }));

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('rollover');
    expect(result.errors[0]!.message).toContain('nahlaš nám ho');
    expect(result.skipped.some((s) => s.message.includes('buy limit'))).toBe(true);
    expect(result.transactions).toEqual([]);
  });

  it('idempotentní ID: dva parse téhož souboru → stejná ID, dedupe pozná duplicity', () => {
    const first = parseMt4Html(MT4_HTML);
    const second = parseMt4Html(MT4_HTML);

    expect(second.transactions.map((tx) => tx.id)).toEqual(first.transactions.map((tx) => tx.id));

    const combined = dedupeTransactions(MT4_BROKER, [
      ...first.transactions,
      ...second.transactions,
    ]);
    expect(combined.fresh).toHaveLength(8);
    expect(combined.duplicates).toBe(8);
  });

  it('sniff: pozná MT4 statement, nematchne MT5 report ani cizí soubory', () => {
    expect(sniffMt4Html(MT4_HTML)).toBe(true);
    expect(sniffMt4Html(MT5_HTML)).toBe(false);
    expect(sniffMt4Html(FOREIGN_CSV)).toBe(false);
    expect(sniffMt4Html('')).toBe(false);
  });
});

describe('MT5 report parser (HTML)', () => {
  it('happy path: 3 uzavírací dealy → 6 transakcí, balance skipped, Orders sekce ignorovaná', () => {
    const result = parseMt5Html(MT5_HTML);

    expect(result.broker).toBe(MT5_BROKER);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(6);

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.message).toContain('Deposit');
    expect(result.skipped[0]!.message).toContain('10 000.00 USD');
  });

  it('out deal s komisí z in dealu: net = 125.50 - 0.25 - 0.70 - 0.10 - 0.70 = 123.75', () => {
    const result = parseMt5Html(MT5_HTML);
    const { buy, sell } = pairOf(result, 'MT5:1003');

    expect(buy.id).toBe('mt5-1003-open');
    expect(sell.id).toBe('mt5-1003-close');
    expect(buy.pricePerShare.toString()).toBe('0');
    expect(sell.pricePerShare.toString()).toBe('123.75');
    // čas otevření pozice report neuvádí → obě nohy nesou čas out dealu + poznámka
    expect(buy.tradeDate).toBe('2025-02-10');
    expect(sell.tradeDate).toBe('2025-02-10');
    expect(buy.note).toContain('použit čas uzavření');
    expect(sell.note).toContain('komise otevíracích dealů -0.7');
    for (const leg of [buy, sell]) {
      expect(leg.quantity.toString()).toBe('1');
      expect(leg.currency).toBe('USD');
      expect(leg.ticker).toBe('EURUSD');
      expect(leg.assetClass).toBe('DERIVATIVE');
      expect(leg.settlementStyle).toBe('MARGIN');
    }
  });

  it('ztrátový obchod: net = -40 - 1 - 0.5 - 0.5 = -42 → BUY 42 + SELL 0', () => {
    const result = parseMt5Html(MT5_HTML);
    const { buy, sell } = pairOf(result, 'MT5:1005');

    expect(buy.pricePerShare.toString()).toBe('42');
    expect(sell.pricePerShare.toString()).toBe('0');
    expect(buy.ticker).toBe('GBPUSD');
  });

  it('direction in/out (otočení pozice) se bere jako uzavření; číslo s mezerou v tisících', () => {
    const result = parseMt5Html(MT5_HTML);
    const { sell } = pairOf(result, 'MT5:1006');

    expect(sell.pricePerShare.toString()).toBe('1234.56');
    expect(sell.ticker).toBe('USDJPY');
  });

  it('součet plnění sedí: 123.75 - 42 + 1234.56 = 1316.31', () => {
    const result = parseMt5Html(MT5_HTML);
    expect(netSum(result).toString()).toBe('1316.31');
  });

  it('komise in dealu bez uzavíracího dealu → warning, náklad se vynechá', () => {
    const result = parseMt5Html(MT5_HTML);

    const leftover = result.warnings.filter((w) => w.message.includes('AUDUSD'));
    expect(leftover).toHaveLength(1);
    expect(leftover[0]!.message).toContain('0.3');
    expect(leftover[0]!.message).toContain('nemá v reportu uzavírací deal');
    expect(leftover[0]!.line).toBe(lineOf(MT5_HTML, '1007'));
  });

  it('vadné dealy → errors s číslem řádku (čas, typ, směr, nečitelné číslo)', () => {
    const badDeals = [
      '<tr><td>2025.13.40 10:00:00</td><td>1101</td><td>EURUSD</td><td>sell</td><td>out</td><td>1</td><td>1.05</td><td>2101</td><td>0.00</td><td>0.00</td><td>0.00</td><td>5.00</td><td></td><td></td></tr>',
      '<tr><td>2025.06.01 10:00:00</td><td>1102</td><td>EURUSD</td><td>dividend</td><td>out</td><td>1</td><td>1.05</td><td>2102</td><td>0.00</td><td>0.00</td><td>0.00</td><td>5.00</td><td></td><td></td></tr>',
      '<tr><td>2025.06.02 10:00:00</td><td>1103</td><td>EURUSD</td><td>sell</td><td>sideways</td><td>1</td><td>1.05</td><td>2103</td><td>0.00</td><td>0.00</td><td>0.00</td><td>5.00</td><td></td><td></td></tr>',
      '<tr><td>2025.06.03 10:00:00</td><td>1104</td><td>EURUSD</td><td>sell</td><td>out</td><td>1</td><td>1.05</td><td>2104</td><td>abc</td><td>0.00</td><td>0.00</td><td>5.00</td><td></td><td></td></tr>',
    ];
    const html = buildMt5Html({ deals: badDeals });
    const result = parseMt5Html(html);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(4);
    expect(result.errors[0]!.message).toContain('neplatný čas');
    expect(result.errors[0]!.line).toBe(lineOf(html, '1101'));
    expect(result.errors[1]!.message).toContain('Neznámý typ dealu „dividend“');
    expect(result.errors[2]!.message).toContain('neznámý směr „sideways“');
    expect(result.errors[3]!.message).toContain('nečitelné číslo');
  });

  it('report bez sekce Deals → srozumitelný error', () => {
    const result = parseMt5Html(buildMt5Html({ deals: null }));

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('chybí sekce „Deals“');
  });

  it('report bez měny účtu → error celého souboru', () => {
    const result = parseMt5Html(buildMt5Html({ currency: null }));

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('chybí měna účtu');
  });

  it('prázdný soubor → prázdný výsledek; text bez tabulky → error', () => {
    expect(parseMt5Html('').errors).toEqual([]);
    expect(parseMt5Html('').transactions).toEqual([]);

    const noTable = parseMt5Html('tohle není report');
    expect(noTable.errors).toHaveLength(1);
    expect(noTable.errors[0]!.message).toContain('neobsahuje žádnou tabulku');
  });

  it('idempotentní ID: dva parse téhož souboru → stejná ID, dedupe pozná duplicity', () => {
    const first = parseMt5Html(MT5_HTML);
    const second = parseMt5Html(MT5_HTML);

    expect(second.transactions.map((tx) => tx.id)).toEqual(first.transactions.map((tx) => tx.id));

    const combined = dedupeTransactions(MT5_BROKER, [
      ...first.transactions,
      ...second.transactions,
    ]);
    expect(combined.fresh).toHaveLength(6);
    expect(combined.duplicates).toBe(6);
  });

  it('sniff: pozná MT5 report, nematchne MT4 statement ani cizí soubory', () => {
    expect(sniffMt5Html(MT5_HTML)).toBe(true);
    expect(sniffMt5Html(MT4_HTML)).toBe(false);
    expect(sniffMt5Html(FOREIGN_CSV)).toBe(false);
    expect(sniffMt5Html('')).toBe(false);
  });
});

describe('MT5 report parser (XLSX)', () => {
  it('happy path s Fee sloupcem: stejné výsledky i ID jako HTML report', async () => {
    const result = await parseMt5Xlsx(await buildMt5Xlsx());

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(6);
    expect(result.skipped).toHaveLength(1);
    expect(netSum(result).toString()).toBe('1316.31');

    // stejný účet → stejná ID jako z HTML exportu (deduplikace mezi formáty)
    const htmlResult = parseMt5Html(MT5_HTML);
    expect(result.transactions.map((tx) => tx.id).sort()).toEqual(
      htmlResult.transactions.map((tx) => tx.id).sort(),
    );

    const { sell } = pairOf(result, 'MT5:1003');
    expect(sell.pricePerShare.toString()).toBe('123.75');
    expect(sell.currency).toBe('USD');
  });

  it('starší build bez Fee sloupce: net bez poplatku = 125.50 - 0.25 - 0.70 - 0.70 = 123.85', async () => {
    const result = await parseMt5Xlsx(await buildMt5Xlsx({ withFee: false }));

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(6);
    const { sell } = pairOf(result, 'MT5:1003');
    expect(sell.pricePerShare.toString()).toBe('123.85');
    // ostatní dealy měly Fee 0 → beze změny
    expect(pairOf(result, 'MT5:1005').buy.pricePerShare.toString()).toBe('42');
    expect(pairOf(result, 'MT5:1006').sell.pricePerShare.toString()).toBe('1234.56');
  });

  it('XLSX bez měny účtu → error; bez sekce Deals → error', async () => {
    const noCurrency = await parseMt5Xlsx(await buildMt5Xlsx({ currency: null }));
    expect(noCurrency.transactions).toEqual([]);
    expect(noCurrency.errors).toHaveLength(1);
    expect(noCurrency.errors[0]!.message).toContain('chybí měna účtu');

    const noDeals = await parseMt5Xlsx(await buildMt5Xlsx({ deals: null }));
    expect(noDeals.transactions).toEqual([]);
    expect(noDeals.errors).toHaveLength(1);
    expect(noDeals.errors[0]!.message).toContain('chybí sekce „Deals“');
  });

  it('prázdný list → prázdný výsledek; nečitelný soubor → error', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Sheet1');
    const raw = await workbook.xlsx.writeBuffer();
    const empty = await parseMt5Xlsx(Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer));
    expect(empty.errors).toEqual([]);
    expect(empty.transactions).toEqual([]);

    const broken = await parseMt5Xlsx(Buffer.from('tohle není xlsx'));
    expect(broken.errors).toHaveLength(1);
    expect(broken.errors[0]!.message).toContain('nepodařilo přečíst jako XLSX');
  });

  it('sniffMt5Xlsx: pozná MT5 report, nematchne cizí workbook', async () => {
    const mt5 = new ExcelJS.Workbook();
    await mt5.xlsx.load((await buildMt5Xlsx()) as unknown as ArrayBuffer);
    expect(sniffMt5Xlsx(mt5)).toBe(true);

    const foreign = new ExcelJS.Workbook();
    await foreign.xlsx.load((await buildForeignXlsx()) as unknown as ArrayBuffer);
    expect(sniffMt5Xlsx(foreign)).toBe(false);
  });

  it('idempotentní ID: dva parse téhož bufferu → dedupe pozná duplicity', async () => {
    const buffer = await buildMt5Xlsx();
    const first = await parseMt5Xlsx(buffer);
    const second = await parseMt5Xlsx(buffer);

    const combined = dedupeTransactions(MT5_BROKER, [
      ...first.transactions,
      ...second.transactions,
    ]);
    expect(combined.fresh).toHaveLength(6);
    expect(combined.duplicates).toBe(6);
  });
});

describe('MT5: dva překrývající se reporty (kratší období po delším)', () => {
  it('tentýž obchod se podruhé neuloží, jen se ohlásí jiná čísla', () => {
    // Výsledek uzavíracího dealu závisí na tom, jestli je v reportu i deal
    // otevírací (komise se do něj započítávají), takže export „poslední
    // 3 měsíce“ dá jinou cenu než „celá historie“ — obsahový dedupe je proto
    // nepozná. Id dealu je ale v obou stejné, a to je ta druhá síť.
    const cely = parseMt5Html(MT5_HTML);
    expect(cely.errors).toEqual([]);

    // report jen s uzavíracími dealy (otevírací padly mimo období)
    const jenUzavreni = parseMt5Html(
      buildMt5Html({
        deals: MT5_DEALS.filter((deal) => deal.direction !== 'in').map(mt5DealHtmlRow),
      }),
    );
    expect(jenUzavreni.errors).toEqual([]);

    const prvni = dedupeTransactions(MT5_BROKER, cely.transactions);
    const druhy = dedupeTransactions(
      MT5_BROKER,
      jenUzavreni.transactions,
      prvni.fresh.map((f) => f.key),
      prvni.fresh.map((f) => brokerIdKey(MT5_BROKER, f.tx.id)),
    );
    // bez druhé sítě by se tytéž obchody uložily znovu s jinou cenou
    expect(druhy.fresh).toHaveLength(0);
    expect(druhy.restated.length).toBeGreaterThan(0);
  });
});

describe('volitelné sloupce reportu bývají prázdné', () => {
  it('MT4: prázdné Commission/Taxes se čtou jako nula, obchod se nezahodí', () => {
    // Commission a Taxes jsou v terminálu zaškrtávací sloupce; když je uživatel
    // nemá zapnuté, broker je v reportu nechá prázdné (často jako &nbsp;).
    // Dokud to byla „nečitelná čísla“, mizel kvůli tomu CELÝ obchod.
    const html = MT4_HTML.replace(
      '<td class="mspt">-0.50</td><td class="mspt">0.00</td>',
      '<td class="mspt">&nbsp;</td><td class="mspt"></td>',
    );
    const result = parseMt4Html(html);
    expect(result.errors).toEqual([]);
    expect(result.transactions.length).toBeGreaterThan(0);
  });
});

describe('nezavřené závorky a značky (L8a-02): čas roste se souborem lineárně', () => {
  // Strop je schválně volný, stroj bývá vytížený. Lineární průchod má tyhle
  // vstupy hotové za desítky milisekund; regulární výrazy, které se po neúspěchu
  // vracely na každý další znak, je počítaly desítky sekund — a u 4 MB, které
  // upload pustí, by to byly hodiny, po které stojí celý proces.
  const CEILING_MS = 5_000;
  const REPEATS = 200_000;
  const UNCLOSED = '<'.repeat(400_000);

  function timed<T>(run: () => T): { ms: number; value: T } {
    const started = performance.now();
    const value = run();
    return { ms: performance.now() - started, value };
  }

  it('jedna buňka se 400 000 znaky „<“ bez „>“ zůstane textem buňky', () => {
    const { ms, value } = timed(() =>
      extractHtmlRows(`<table>\n<tr><td>${UNCLOSED}</td></tr></table>`),
    );
    expect(ms).toBeLessThan(CEILING_MS);
    expect(value).toEqual([{ line: 2, cells: [UNCLOSED] }]);
  });

  it('mnoho „<tr “ bez „>“ nedá žádný řádek', () => {
    const { ms, value } = timed(() => extractHtmlRows('<tr '.repeat(REPEATS)));
    expect(ms).toBeLessThan(CEILING_MS);
    expect(value).toEqual([]);
  });

  it('mnoho „<tr>“ bez „</tr>“ nedá žádný řádek', () => {
    const { ms, value } = timed(() => extractHtmlRows('<tr>'.repeat(REPEATS)));
    expect(ms).toBeLessThan(CEILING_MS);
    expect(value).toEqual([]);
  });

  it('mnoho „<td>“ bez „</td>“ dá řádek bez buněk', () => {
    const { ms, value } = timed(() => extractHtmlRows(`<tr>${'<td>'.repeat(REPEATS)}</tr>`));
    expect(ms).toBeLessThan(CEILING_MS);
    expect(value).toEqual([{ line: 1, cells: [] }]);
  });

  it('mnoho „Account:“ bez závorky s měnou → měna se nenajde', () => {
    const rows = [{ cells: ['Account: '.repeat(REPEATS / 2)] }];
    const { ms, value } = timed(() => findAccountCurrency(rows));
    expect(ms).toBeLessThan(CEILING_MS);
    expect(value).toBeNull();
  });

  it('MT5 i MT4 report s takovou buňkou navíc se zpracuje stejně jako bez ní', () => {
    const extraRow = `<table><tr><td>${UNCLOSED}</td></tr></table>`;
    const mt5 = timed(() => parseMt5Html(extraRow + MT5_HTML));
    const mt4 = timed(() => parseMt4Html(MT4_HTML.replace('<table', `${extraRow}<table`)));
    expect(mt5.ms).toBeLessThan(CEILING_MS);
    expect(mt4.ms).toBeLessThan(CEILING_MS);
    expect(mt5.value).toEqual(parseMt5Html(MT5_HTML));
    expect(mt4.value).toEqual(parseMt4Html(MT4_HTML));
  });
});

describe('ruční průchod HTML dává totéž co dřívější regulární výrazy (L8a-02)', () => {
  // Původní výrazy z common.ts, opsané doslova — slouží už jen jako měřítko.
  const referenceEntities = (text: string): string =>
    text
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
      .replace(/&(nbsp|amp|lt|gt|quot);/g, (_, name: string) =>
        name === 'nbsp' ? '\u00a0' : name === 'amp' ? '&' : name === 'lt' ? '<' : name === 'gt' ? '>' : '"',
      );
  const referenceCellText = (inner: string): string =>
    referenceEntities(inner.replace(/<[^>]*>/g, ' '))
      .replace(/[\s\u00a0]+/g, ' ')
      .trim();
  function referenceRows(html: string): HtmlRow[] {
    const rows: HtmlRow[] = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    for (let match = rowRe.exec(html); match !== null; match = rowRe.exec(html)) {
      const cells: string[] = [];
      const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
      for (let cell = cellRe.exec(match[1]!); cell !== null; cell = cellRe.exec(match[1]!)) {
        cells.push(referenceCellText(cell[1]!));
      }
      rows.push({ line: html.slice(0, match.index).split('\n').length, cells });
    }
    return rows;
  }
  const referenceBracketCurrency = (cell: string): string | null =>
    /account\s*:[^()]*\(\s*([A-Za-z]{3})\s*[,)]/i.exec(cell)?.[1]?.toUpperCase() ?? null;

  /**
   * Opakovatelná „náhoda“ (mulberry32) — tytéž vstupy při každém běhu. Prostý
   * LCG tu nestačil: jeho spodní bity se opakují po pár krocích, úlomky pak
   * chodily pořád ve stejném pořadí a test nepoznal ani schválně rozbitý kód.
   */
  function sampler(seed: number): (tokens: readonly string[], maxLength: number) => string {
    let state = seed;
    const next = (bound: number): number => {
      state = (state + 0x6d2b79f5) | 0;
      let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
      mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
      return ((mixed ^ (mixed >>> 14)) >>> 0) % bound;
    };
    return (tokens, maxLength) => {
      const length = 1 + next(maxLength);
      let out = '';
      for (let i = 0; i < length; i += 1) out += tokens[next(tokens.length)]!;
      return out;
    };
  }

  it.each([
    ['MT4 statement', MT4_HTML],
    ['MT5 report', MT5_HTML],
    ['velká písmena a atributy', '<TABLE>\n<TR ALIGN="left">\n<TD nowrap>A <B>b</B></TD><Th>c&amp;d</tH></tR>'],
    ['značka podobná řádku a buňce', '<track><tr><tdx>1</tdx><td>2</td><thead><th>3</th></tr>'],
    ['řádek bez konce za posledním úplným', '<tr><td>1</td></tr>\n<tr><td>2</td>'],
    ['buňka bez konce za poslední úplnou', '<tr><td>1</td><td>2</tr>\n<tr><td>3</td></tr>'],
    ['nezavřená značka uvnitř buňky', '<tr><td>a <b nezavrena</td><td>b > c <i>d</i></td></tr>'],
    ['řádek bez „>“ na konci souboru', '<tr><td>1</td></tr><tr class="x"'],
  ])('%s', (_name, html) => {
    expect(referenceRows(html).length).toBeGreaterThan(0);
    expect(extractHtmlRows(html)).toEqual(referenceRows(html));
  });

  it('náhodně poskládané úlomky značek: stejné řádky i buňky', () => {
    const tokens = [
      '<tr', '<TR ', '<tr>', '</tr>', '</TR>', '<td', '<td>', '<TD x="1">', '</td>', '<th>', '</TH>',
      '<', '>', '<b>', '</b>', '<track>', '<tdx>', 'x', ' ', '\n', '&amp;', '&#65;', '&nbsp;',
    ] as const;
    const sample = sampler(20261009);
    for (let i = 0; i < 5_000; i += 1) {
      const html = sample(tokens, 40);
      expect(extractHtmlRows(html), JSON.stringify(html)).toEqual(referenceRows(html));
    }
  });

  it('náhodně poskládané úlomky hlavičky: stejná měna ze závorky u čísla účtu', () => {
    const tokens = [
      'Account', 'account:', 'ACCOUNT :', ':', '(', ')', ',', ' ', 'USD', 'eur', 'Kc', '555001', 'x',
      '(USD', '( eur ', 'account: 555001 ',
    ] as const;
    const sample = sampler(20261010);
    let found = 0;
    for (let i = 0; i < 20_000; i += 1) {
      const cell = sample(tokens, 14);
      const expected = referenceBracketCurrency(cell);
      if (expected !== null) found += 1;
      expect(findAccountCurrency([{ cells: [cell] }]), JSON.stringify(cell)).toBe(expected);
    }
    // ať test neporovnává jen samá „nenalezeno“
    expect(found).toBeGreaterThan(300);
  });
});
