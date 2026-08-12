/**
 * Společné pomůcky parserů MetaTrader reportů (MT4 statement, MT5 report).
 *
 * HTML se parsuje ručně regexy — MetaTrader reporty NEJSOU validní XML
 * (neuzavřené tagy, atributy bez hodnot, podmíněné komentáře), fast-xml-parser
 * na nich selhává. Struktura je ale strojově generovaná a stabilní:
 * tabulkové řádky `<tr>…</tr>` s buňkami `<td>/<th>`.
 */
import { d, Decimal, TransactionSchema } from '@danero/shared';
import { isValidIsoDate } from '../csv';
import type { ImportResult } from '../types';

export interface HtmlRow {
  /** Skutečné číslo řádku v souboru (1-based) — řádek s otevíracím `<tr>`. */
  line: number;
  /** Texty buněk `<td>`/`<th>`: bez vnitřních tagů, s dekódovanými entitami. */
  cells: string[];
}

const ENTITY_MAP: Record<string, string> = {
  nbsp: '\u00a0',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
};

/** Dekóduje entity, které MetaTrader reporty používají (&nbsp; &amp; &#39; …). */
const decodeEntities = (text: string): string =>
  text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&(nbsp|amp|lt|gt|quot);/g, (_, name: string) => ENTITY_MAP[name]!);

/** Text buňky: pryč vnitřní tagy (<b>, <div>…), entity, sjednocené bílé znaky. */
const cellText = (inner: string): string =>
  decodeEntities(inner.replace(/<[^>]*>/g, ' '))
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();

/** Rozseká HTML na řádky tabulek s texty buněk a skutečnými čísly řádků souboru. */
export function extractHtmlRows(html: string): HtmlRow[] {
  const rows: HtmlRow[] = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let line = 1;
  let scannedTo = 0;
  for (let match = rowRe.exec(html); match !== null; match = rowRe.exec(html)) {
    for (let i = scannedTo; i < match.index; i += 1) {
      if (html.charCodeAt(i) === 10) line += 1;
    }
    scannedTo = match.index;
    const cells: string[] = [];
    const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    for (let cell = cellRe.exec(match[1]!); cell !== null; cell = cellRe.exec(match[1]!)) {
      cells.push(cellText(cell[1]!));
    }
    rows.push({ line, cells });
  }
  return rows;
}

/** MetaTrader číslo: mezera (i nbsp) jako oddělovač tisíců („1 700.00“), desetinná tečka. */
export function parseMtNumber(value: string): Decimal | null {
  const cleaned = value.replace(/[\s\u00a0\u202f]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return d(cleaned);
}

/**
 * \u010c\u00edslo z voliteln\u00e9ho sloupce reportu; PR\u00c1ZDN\u00c1 bu\u0148ka je nula, ne ne\u010diteln\u00e9
 * \u010d\u00edslo. Commission, Taxes, Swap i Fee jsou v termin\u00e1lu voliteln\u00e9 sloupce
 * a \u010d\u00e1st broker\u016f je nech\u00e1v\u00e1 pr\u00e1zdn\u00e9 (\u010dasto jako `&nbsp;`) \u2014 MT4 parser kv\u016fli
 * tomu zahazoval cel\u00fd obchod, MT5 na t\u00e9m\u017ee m\u00edst\u011b dosazoval nulu. Pouh\u00e9
 * `value || '0'` nesta\u010d\u00ed: nezlomiteln\u00e1 mezera je nepr\u00e1zdn\u00fd \u0159et\u011bzec.
 */
export function parseMtNumberOrZero(value: string): Decimal | null {
  return value.replace(/[\s\u00a0\u202f]/g, '') === '' ? d(0) : parseMtNumber(value);
}

/** „2023.09.11 20:55:26“ (MT4/MT5) i ISO tvar → 'YYYY-MM-DD'; neexistující den → null. */
export function mtDateToIso(value: string): string | null {
  const match = /^(\d{4})[.-](\d{2})[.-](\d{2})(?![\d.-])/.exec(value.trim());
  if (!match) return null;
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  return isValidIsoDate(iso) ? iso : null;
}

/**
 * Měna účtu z hlavičky reportu: „Currency: GBP“ v jedné buňce, „Currency:“
 * + kód v následující buňce (MT5 XLSX), fallback „Account: 123 (USD, …)“
 * — některé MT5 buildy měnu uvádí jen v závorce u čísla účtu.
 */
export function findAccountCurrency(rows: Array<{ cells: string[] }>): string | null {
  for (const row of rows) {
    for (let i = 0; i < row.cells.length; i += 1) {
      const cell = row.cells[i]!;
      const inline = /currency\s*:\s*([A-Za-z]{3})(?![A-Za-z])/i.exec(cell);
      if (inline) return inline[1]!.toUpperCase();
      if (/^currency\s*:?$/i.test(cell.trim())) {
        for (let j = i + 1; j < row.cells.length; j += 1) {
          const next = /^([A-Za-z]{3})(?![A-Za-z])/.exec(row.cells[j]!.trim());
          if (next) return next[1]!.toUpperCase();
        }
      }
    }
  }
  for (const row of rows) {
    for (const cell of row.cells) {
      const bracket = /account\s*:[^()]*\(\s*([A-Za-z]{3})\s*[,)]/i.exec(cell);
      if (bracket) return bracket[1]!.toUpperCase();
    }
  }
  return null;
}

export interface SyntheticTradeSpec {
  /** Základ ID: `mt4-<ticket>` / `mt5-<deal>` → přípony `-open` / `-close`. */
  idBase: string;
  /** Unikátní syntetický „ISIN“ per obchod (`MT4:<ticket>` / `MT5:<deal>`). */
  isin: string;
  /** Symbol instrumentu uppercase (GBPUSD). */
  symbol: string;
  openDate: string;
  closeDate: string;
  /** Čistý výsledek obchodu v měně účtu (profit + swap + náklady, se znaménky). */
  net: Decimal;
  currency: string;
  note: string;
  /** Doplněk poznámky jen pro otevírací nohu (např. neznámý čas otevření u MT5). */
  openNote?: string;
}

/**
 * R-12/R-12m: MT4/MT5 reporty neuvádí hodnoty podkladu, jen výsledek obchodu
 * v měně účtu → každý uzavřený obchod modelujeme jako syntetický derivátový
 * pár s quantity 1: zisk = BUY za 0 + SELL za net; ztráta = BUY za |net| +
 * SELL za 0; nula = BUY 0 + SELL 0 (obchod proběhl, výsledek nulový).
 * MARGIN vypořádání = daní se jen rozdíl; unikátní ISIN per obchod → FIFO
 * párování v enginu je triviálně správné.
 */
export function syntheticDerivativePair(
  spec: SyntheticTradeSpec,
): [Record<string, unknown>, Record<string, unknown>] {
  const gain = spec.net.gte(0);
  const shared = {
    isin: spec.isin,
    ticker: spec.symbol,
    name: spec.symbol,
    assetClass: 'DERIVATIVE',
    settlementStyle: 'MARGIN',
    quantity: '1',
    currency: spec.currency,
  };
  return [
    {
      type: 'BUY',
      id: `${spec.idBase}-open`,
      ...shared,
      pricePerShare: gain ? '0' : spec.net.abs().toString(),
      tradeDate: spec.openDate,
      note: spec.openNote === undefined ? spec.note : `${spec.note} ${spec.openNote}`,
    },
    {
      type: 'SELL',
      id: `${spec.idBase}-close`,
      ...shared,
      pricePerShare: gain ? spec.net.toString() : '0',
      tradeDate: spec.closeDate,
      note: spec.note,
    },
  ];
}

export type PushFn = (line: number, raw: string, candidate: Record<string, unknown>) => void;

/** Validace + zařazení transakce; nevalidní kandidát = error s číslem řádku. */
export function makePush(result: ImportResult): PushFn {
  return (line, raw, candidate) => {
    try {
      result.transactions.push(TransactionSchema.parse(candidate));
    } catch (err) {
      result.errors.push({
        line,
        message: `Řádek se nepodařilo zpracovat: ${err instanceof Error ? err.message : String(err)}`,
        raw,
      });
    }
  };
}
