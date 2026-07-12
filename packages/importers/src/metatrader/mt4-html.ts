import { emptyResult, type ImportResult } from '../types';
import {
  extractHtmlRows,
  findAccountCurrency,
  makePush,
  mtDateToIso,
  parseMtNumber,
  syntheticDerivativePair,
  type HtmlRow,
} from './common';

export const MT4_BROKER = 'mt4';

/**
 * Parser MT4 statementu (terminál: Account History → „Save as Report“ → .htm)
 * — Purple Trading, InstaForex, Admirals, RoboForex a další MT4 brokeři.
 *
 * Statement neuvádí hodnoty podkladu, jen výsledek obchodu v měně účtu —
 * každý řádek buy/sell v sekci Closed Transactions se proto modeluje jako
 * syntetický derivátový pár dle R-12/R-12m (viz syntheticDerivativePair):
 * net = Profit + Swap + Commission + Taxes (hodnoty už jsou se znaménky).
 * Balance řádky (vklady/výběry) se přeskakují, Open Trades a Working Orders
 * se nedaní a do importu nevstupují.
 */

/** Kanonická hlavička tabulky (14 sloupců) — MT4 ji generuje v pevném pořadí. */
const MT4_COLUMNS = [
  'ticket',
  'opentime',
  'type',
  'size',
  'item',
  'price',
  's/l',
  't/p',
  'closetime',
  'price',
  'commission',
  'taxes',
  'swap',
  'profit',
] as const;

/** Klíč buňky hlavičky: lowercase, úplně bez mezer („S / L“ → „s/l“). */
const headerKey = (cell: string): string => cell.toLowerCase().replace(/\s+/g, '');

type Section = 'preamble' | 'closed' | 'open' | 'working' | 'summary';

/** Řádek s nadpisem sekce statementu („Closed Transactions:“ …). */
function sectionOf(row: HtmlRow): Section | null {
  for (const cell of row.cells) {
    const text = cell.trim().toLowerCase();
    if (text === 'closed transactions:') return 'closed';
    if (text === 'open trades:') return 'open';
    if (text === 'working orders:') return 'working';
    if (text === 'summary:') return 'summary';
  }
  return null;
}

/** Tvar obchodního řádku: číselný ticket, typ buy/sell, plných 14 sloupců. */
const isTradeShape = (row: HtmlRow): boolean =>
  row.cells.length >= 14 &&
  /^\d+$/.test((row.cells[0] ?? '').trim()) &&
  ['buy', 'sell'].includes((row.cells[2] ?? '').trim().toLowerCase());

/**
 * Autodetekce MT4 statementu: `<title>Statement…` + buňky Ticket / Open Time /
 * Close Time. „Direction“ je poznávací znak MT5 reportu — MT4 a MT5 sniffy
 * nesmí matchnout navzájem.
 */
export function sniffMt4Html(text: string): boolean {
  if (!/<title>\s*statement/i.test(text)) return false;
  if (/>\s*Direction\s*</i.test(text)) return false;
  return (
    />\s*Ticket\s*</i.test(text) &&
    />\s*Open\s+Time\s*</i.test(text) &&
    />\s*Close\s+Time\s*</i.test(text)
  );
}

export function parseMt4Html(text: string): ImportResult {
  const result = emptyResult(MT4_BROKER);
  // prázdný soubor = prázdné období, ne chyba formátu (konzistentně s T212)
  if (text.trim() === '') return result;

  const rows = extractHtmlRows(text);
  if (!rows.some((row) => sectionOf(row) === 'closed')) {
    result.errors.push({
      line: 1,
      message:
        'V souboru chybí sekce „Closed Transactions:“ — nevypadá jako MT4 statement. V MT4 terminálu: záložka Account History → pravé tlačítko → „Save as Report“.',
    });
    return result;
  }

  const currency = findAccountCurrency(rows);
  if (!currency) {
    result.errors.push({
      line: 1,
      message:
        'V hlavičce statementu chybí měna účtu („Currency: …“) — bez ní neumíme výsledky obchodů zpracovat. Ulož statement znovu z MT4 terminálu (Account History → „Save as Report“).',
    });
    return result;
  }

  const push = makePush(result);
  let section: Section = 'preamble';
  let headerMismatch = false;
  let firstOpenTrade: HtmlRow | null = null;

  for (const row of rows) {
    const marker = sectionOf(row);
    if (marker !== null) {
      section = marker;
      continue;
    }
    if (section === 'open') {
      // otevřené pozice se nedaní — jen si pamatujeme první pro JEDEN warning
      if (firstOpenTrade === null && isTradeShape(row)) firstOpenTrade = row;
      continue;
    }
    if (section !== 'closed' || headerMismatch) continue;

    const raw = row.cells.join(' | ');
    const first = (row.cells[0] ?? '').trim();

    // hlavička tabulky: ověříme pevné pořadí 14 sloupců (jediná varianta, kterou známe)
    if (headerKey(first) === 'ticket') {
      const keys = row.cells.map(headerKey);
      const matches =
        keys.length >= MT4_COLUMNS.length && MT4_COLUMNS.every((column, i) => keys[i] === column);
      if (!matches) {
        headerMismatch = true;
        result.errors.push({
          line: row.line,
          message: `Tabulka Closed Transactions má neočekávané sloupce (${row.cells.filter((c) => c !== '').join(' | ')}) — tuhle variantu MT4 statementu neznáme, nahlaš nám ji.`,
        });
      }
      continue;
    }

    // řádky bez čísla ticketu = mezisoučty a patička sekce („Closed P/L:“, „No transactions“)
    if (!/^\d+$/.test(first)) continue;

    const type = (row.cells[2] ?? '').trim().toLowerCase();

    if (type === 'balance' || type === 'credit') {
      // vklad/výběr: [ticket, čas, 'balance', komentář (colspan), částka]
      const comment = (row.cells[3] ?? '').trim();
      const amount = (row.cells[row.cells.length - 1] ?? '').trim();
      result.skipped.push({
        line: row.line,
        message: `Vklad/výběr (${type})${comment !== '' ? ` „${comment}“` : ''}: ${amount} ${currency} — peněžní pohyby se nedaní a do importu nevstupují.`,
        raw,
      });
      continue;
    }

    if (type === 'buy' || type === 'sell') {
      if (row.cells.length < 14) {
        result.errors.push({
          line: row.line,
          message: `Obchod ${first} má méně sloupců, než statement mívá (${row.cells.length} ze 14) — řádek nejde zpracovat.`,
          raw,
        });
        continue;
      }
      const [ticket, openTimeRaw, , size, item, openPrice, , , closeTimeRaw, closePrice] =
        row.cells as [string, string, string, string, string, string, string, string, string, string];
      const openDate = mtDateToIso(openTimeRaw);
      const closeDate = mtDateToIso(closeTimeRaw);
      if (openDate === null || closeDate === null) {
        result.errors.push({
          line: row.line,
          message: `Obchod ${ticket}: neplatné datum otevření/uzavření („${openTimeRaw}“ / „${closeTimeRaw}“) — očekáváme YYYY.MM.DD HH:MM:SS.`,
          raw,
        });
        continue;
      }
      const commission = parseMtNumber(row.cells[10]!);
      const taxes = parseMtNumber(row.cells[11]!);
      const swap = parseMtNumber(row.cells[12]!);
      const profit = parseMtNumber(row.cells[13]!);
      if (commission === null || taxes === null || swap === null || profit === null) {
        result.errors.push({
          line: row.line,
          message: `Obchod ${ticket}: nečitelné číslo ve sloupcích Commission/Taxes/Swap/Profit („${row.cells[10]}“ / „${row.cells[11]}“ / „${row.cells[12]}“ / „${row.cells[13]}“).`,
          raw,
        });
        continue;
      }
      const symbol = item.trim().toUpperCase();
      if (symbol === '') {
        result.errors.push({
          line: row.line,
          message: `Obchod ${ticket}: chybí symbol instrumentu (sloupec Item).`,
          raw,
        });
        continue;
      }

      // čistý výsledek obchodu v měně účtu — všechny složky už se znaménky
      const net = profit.plus(swap).plus(commission).plus(taxes);
      const note = `MT4 ${type} ${size} ${symbol} ${openPrice} → ${closePrice}; čistý výsledek ${net.toString()} ${currency} (profit ${profit.toString()} + swap ${swap.toString()} + komise ${commission.toString()} + daně ${taxes.toString()}).`;
      const [buyLeg, sellLeg] = syntheticDerivativePair({
        idBase: `mt4-${ticket}`,
        isin: `MT4:${ticket}`,
        symbol,
        openDate,
        closeDate,
        net,
        currency,
        note,
      });
      push(row.line, raw, buyLeg);
      push(row.line, raw, sellLeg);
      continue;
    }

    // zrušené čekající pokyny se v části statementů objevují v Closed Transactions
    if (/^(buy|sell)\s+(limit|stop)/.test(type)) {
      result.skipped.push({
        line: row.line,
        message: `Zrušený čekající pokyn (${type}) — žádný obchod neproběhl, nedaní se.`,
        raw,
      });
      continue;
    }

    result.errors.push({
      line: row.line,
      message: `Neznámý typ řádku „${row.cells[2] ?? ''}“ v Closed Transactions — nahlaš nám ho, doplníme podporu.`,
      raw,
    });
  }

  if (firstOpenTrade !== null) {
    result.warnings.push({
      line: firstOpenTrade.line,
      message:
        'Statement obsahuje otevřené pozice (Open Trades) — otevřené pozice se nedaní a do importu nevstupují; po jejich uzavření nahraj nový statement.',
    });
  }

  return result;
}
