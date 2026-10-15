import ExcelJS from 'exceljs';
import { Decimal, d, ZERO, TransactionSchema } from '@danero/shared';
import { isValidIsoDate, normalizeHeader } from '../csv';
import { fnv1a64 } from '../dedupe';
import { syntheticDerivativePair } from '../metatrader/common';
import { openXlsxSource, readSheetRows, type SheetRow, type XlsxSource } from '../xlsx';
import { emptyResult, type ImportResult, type IsinInstrumentMap } from '../types';

export const ETORO_BROKER = 'etoro';

/**
 * eToro „Account Statement“ XLSX (listy Closed Positions / Account Activity /
 * Dividends). Otevřené pozice v Account Activity neuvádějí ISIN — dodává ho
 * mapování symbolů; nenamapované BUY se neimportují a symbol skončí
 * v `unmappedSymbols`. Měnu mapování nenese — ledger eToro je vždy v USD.
 */
export type EtoroInstrumentMap = IsinInstrumentMap;

/** Účetní měna eToro ledgeru — Amount v Account Activity i rates jsou v USD. */
const LEDGER_CURRENCY = 'USD';

/**
 * Číslo z eToro výpisu — formát závisí na locale účtu a liší se PER HODNOTA:
 * US zápis „4,581.91“ (tečka desetinná, čárka tisíce) i EU zápis „ 1 212,77 “
 * (čárka desetinná, mezery tisíce); záporné hodnoty v závorkách „(6.97)“/„(0,10)“.
 * Rozhodování: závorky = minus; obě oddělovadla → poslední je desetinné;
 * jen čárka → tvar tisícových skupin (1–3 číslice, pak po třech) = tisíce,
 * jinak desetinná čárka. Prázdno a „-“ (výplň prázdných buněk) → null.
 */
export function parseEtoroNumber(raw: string): Decimal | null {
  let s = raw.replace(/[\s\u00a0\u202f]/g, '');
  if (s === '' || s === '-' || s === '--') return null;
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  if (s === '') return null;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  let canonical: string;
  if (hasComma && hasDot) {
    // poslední oddělovač je desetinný, druhý odděluje tisíce
    canonical =
      s.lastIndexOf('.') > s.lastIndexOf(',')
        ? s.replace(/,/g, '')
        : s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    canonical = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else {
    canonical = s;
  }
  if (!/^\d+(\.\d+)?$/.test(canonical)) return null;
  const value = d(canonical);
  return negative ? value.neg() : value;
}

/** „02/01/2024 00:10:33“ je DEN/měsíc/rok (eToro), Excel Date buňky ISO → 'YYYY-MM-DD'. */
function toIsoDate(value: string): string | null {
  const trimmed = value.trim();
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(trimmed);
  const iso = slash
    ? `${slash[3]}-${slash[2]!.padStart(2, '0')}-${slash[1]!.padStart(2, '0')}`
    : /^(\d{4}-\d{2}-\d{2})/.exec(trimmed)?.[1];
  return iso !== undefined && isValidIsoDate(iso) ? iso : null;
}

/** Řádek listu: skutečné číslo řádku v Excelu (uživatel ho tam vidí) + buňky jako stringy. */
/** Načte list do matice stringů; úplně prázdné řádky vynechá. */
/** Kanonický tvar hlavičky/hodnoty: trim, lowercase, bez diakritiky, sjednocené mezery. */
const canon = (value: string): string => normalizeHeader(value).replace(/\s+/g, ' ');

const findSheet = (workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined =>
  workbook.worksheets.find((sheet) => sheet.name.trim().toLowerCase() === name);

/**
 * eToro překládá sešit do jazyka rozhraní — i názvy listů a sloupců („Posiciones
 * cerradas“, „Dividendos“). Čteme jen anglickou verzi, stejně jako ostatní
 * nástroje nad tímhle výpisem; uživatel se musí dozvědět, co s tím.
 */
export const ETORO_ENGLISH_ONLY =
  'eToro výpis překládá do jazyka, ve kterém máš platformu — čteme jen anglickou verzi. Přepni si eToro v nastavení do angličtiny a Account Statement stáhni znovu.';

/** Sniff: eToro Account Statement poznáme podle listů Closed Positions + Account Activity. */
export function sniffEtoroXlsx(workbook: ExcelJS.Workbook): boolean {
  return (
    findSheet(workbook, 'closed positions') !== undefined &&
    findSheet(workbook, 'account activity') !== undefined
  );
}

type HeaderMatcher = (header: string) => boolean;
const oneOf =
  (...names: string[]): HeaderMatcher =>
  (header) =>
    names.includes(header);
const prefixed =
  (prefix: string): HeaderMatcher =>
  (header) =>
    header.startsWith(prefix);

interface FoundHeader<F extends string> {
  index: number;
  columns: Partial<Record<F, number>>;
  /** Kanonické texty hlavičky (např. pro čtení měny ze sufixu „(USD)“). */
  headerCells: string[];
}

/**
 * Hlavička se hledá obsahem (první řádek se všemi povinnými sloupci) — sady
 * sloupců se mezi verzemi exportů mění, mapujeme výhradně podle názvů.
 */
function findHeaderRow<F extends string>(
  rows: SheetRow[],
  matchers: Record<F, HeaderMatcher>,
  required: readonly NoInfer<F>[],
): FoundHeader<F> | null {
  for (let i = 0; i < rows.length; i += 1) {
    const headerCells = rows[i]!.cells.map(canon);
    const columns: Partial<Record<F, number>> = {};
    headerCells.forEach((cell, col) => {
      for (const field of Object.keys(matchers) as F[]) {
        if (columns[field] === undefined && matchers[field](cell)) columns[field] = col;
      }
    });
    if (required.every((field) => columns[field] !== undefined)) {
      return { index: i, columns, headerCells };
    }
  }
  return null;
}

/** Leverage bývá „1“/„2“, výjimečně „x2“ — cokoli nečitelného čteme jako 1 (bez páky). */
function parseLeverage(raw: string): Decimal {
  const value = parseEtoroNumber(raw.replace(/^x/i, ''));
  return value !== null && value.gt(0) ? value : d(1);
}

/** „Buy NVIDIA Corporation (NVDA)“ i starší „Buy NVDA“ → směr pozice + ticker. */
function parseAction(action: string): { short: boolean; ticker: string } | null {
  const match = /^(buy|sell)\s+(.+)$/i.exec(action.trim());
  if (!match) return null;
  const rest = match[2]!.trim();
  const paren = /\(([^()]+)\)\s*$/.exec(rest);
  return {
    short: match[1]!.toLowerCase() === 'sell',
    ticker: (paren ? paren[1]! : rest).trim(),
  };
}

/** Typy Closed Positions / Asset type, které jsou deriváty (R-12, vypořádání rozdílem). */
const DERIVATIVE_TYPES = new Set(['cfd', 'currency', 'commodities']);

/**
 * Klíč instrumentu pro derivát. **Nikdy to nesmí být holý ticker ani ISIN
 * podkladu** — engine bere druh příjmu jako vlastnost instrumentu, takže by
 * derivát a spotová pozice se stejným klíčem splynuly v jeden instrument
 * a celá držba by se překlopila na derivátový příjem.
 *
 * Doloženo (nález A2-3-06): krypto se napříč VŠEMI importéry klíčuje tickerem,
 * takže jediný short nebo pákový obchod na eToru sdílel klíč se spotovým BTC —
 * klidně u jiného brokera. Šest let držené BTC osvobozené časovým testem se tím
 * překlopilo na zdanitelný derivát: **daň 0 → 159 120 Kč** a prolomený limit
 * 50 000 Kč. Výchozí konfigurace, běžné částky. Engine sice vydal
 * `ASSET_CLASS_CONFLICT`, ale jeho rada „oprav asset_class v importu“ je
 * u eToro exportu nesplnitelná — takový sloupec tam není.
 *
 * Prefix `CFD:` je konvence, kterou používá i univerzální šablona
 * (`CFD:US500`, `OPT:…`), takže se derivát pozná i v UI.
 */
const derivativeIsin = (ticker: string): string => `CFD:${ticker}`;

/** Sdílený stav parsování napříč listy jednoho workbooku. */
interface Ctx {
  result: ImportResult & { unmappedSymbols: string[] };
  instrumentMap: EtoroInstrumentMap;
  /** Position ID z listu Closed Positions — Activity řádky s nimi jsou pokryté párem. */
  closedPositionIds: Set<string>;
  push: (line: number, raw: string, candidate: Record<string, unknown>) => void;
  contentId: (parts: string[]) => string;
  requireIsin: (ticker: string, line: number) => string | null;
  /** Kolik dividendových řádků má Account Activity — musí je pokrýt list Dividends. */
  activityDividendRows: { count: number };
  /** Řádky listu Dividends zaúčtované jako derivátový příjem (R-12t), ne jako DIVIDEND. */
  derivativeDividendRows: { count: number };
  /**
   * ISIN, které výpis sám uvádí u tickeru v Closed Positions (spot, ne
   * derivát) — otevřená pozice téhož tickeru v Account Activity ISIN nemá.
   */
  fileIsins: Map<string, Set<string>>;
}

const CLOSED_MATCHERS = {
  positionId: oneOf('position id'),
  action: oneOf('action'),
  longShort: oneOf('long / short', 'long/short'),
  units: oneOf('units / contracts', 'units/contracts', 'units'),
  openDate: oneOf('open date'),
  closeDate: oneOf('close date'),
  leverage: oneOf('leverage'),
  openRate: oneOf('open rate'),
  closeRate: oneOf('close rate'),
  type: oneOf('type'),
  isin: oneOf('isin'),
  amount: oneOf('amount'),
  profit: (header: string) =>
    header === 'profit' || header.startsWith('profit(usd') || header.startsWith('profit (usd'),
} as const;
type ClosedField = keyof typeof CLOSED_MATCHERS;
const CLOSED_REQUIRED = [
  'positionId',
  'action',
  'units',
  'openDate',
  'closeDate',
  'openRate',
  'closeRate',
] as const satisfies readonly ClosedField[];

/**
 * List Closed Positions: každý řádek = celý životní cyklus pozice → emitujeme
 * pár BUY/SELL (short: SELL/BUY). Ceny z Open/Close Rate, měna USD (ledger).
 */
function parseClosedSheet(ctx: Ctx, sheet: ExcelJS.Worksheet): void {
  const rows = readSheetRows(sheet);
  if (rows.length === 0) return;
  const header = findHeaderRow(rows, CLOSED_MATCHERS, CLOSED_REQUIRED);
  if (!header) {
    ctx.result.errors.push({
      line: rows[0]!.rowNumber,
      message: `V listu „${sheet.name}“ se nepodařilo najít hlavičku tabulky (Position ID, Action, Open/Close Date, Open/Close Rate…) — nevypadá jako výpis z eToro.`,
    });
    return;
  }

  // Předprůchod: ISIN, které list uvádí u tickeru (spot, ne derivát). Musí
  // být hotový dřív, než se čte první řádek — řádek téhož tickeru bez ISIN
  // může v listu stát před tím s ISIN (revize N5).
  for (let i = header.index + 1; i < rows.length; i += 1) {
    const cells = rows[i]!.cells;
    const at = (field: ClosedField): string => {
      const col = header.columns[field];
      return col === undefined ? '' : (cells[col] ?? '');
    };
    const parsed = parseAction(at('action'));
    const isin = at('isin');
    if (!parsed || isin === '') continue;
    const typeNorm = canon(at('type'));
    const short = canon(at('longShort')).startsWith('short') || parsed.short;
    const derivative =
      short || DERIVATIVE_TYPES.has(typeNorm) || parseLeverage(at('leverage')).gt(1);
    if (derivative || typeNorm === 'crypto') continue;
    const known = ctx.fileIsins.get(parsed.ticker) ?? new Set<string>();
    ctx.fileIsins.set(parsed.ticker, known.add(isin));
  }

  for (let i = header.index + 1; i < rows.length; i += 1) {
    const row = rows[i]!;
    const line = row.rowNumber;
    const raw = row.cells.join(' | ');
    const cell = (field: ClosedField): string => {
      const col = header.columns[field];
      return col === undefined ? '' : (row.cells[col] ?? '');
    };

    const pid = cell('positionId');
    if (pid === '' || pid === '-') {
      ctx.result.skipped.push({ line, message: 'Řádek bez Position ID (souhrn listu) — přeskočen.', raw });
      continue;
    }
    // PID registrujeme hned — i když řádek skončí chybou, Activity ho nesmí
    // zpracovat podruhé (uživatel dostane jednu chybu, ne dvojí počítání)
    ctx.closedPositionIds.add(pid);

    const action = cell('action');
    const parsed = parseAction(action);
    if (!parsed) {
      ctx.result.errors.push({
        line,
        message: `Uzavřená pozice ${pid}: z pole Action „${action}“ se nepodařilo přečíst směr a instrument.`,
        raw,
      });
      continue;
    }
    const short = canon(cell('longShort')).startsWith('short') || parsed.short;

    const units = parseEtoroNumber(cell('units'));
    if (units === null || units.lte(0)) {
      ctx.result.errors.push({
        line,
        message: `Uzavřená pozice ${pid} (${parsed.ticker}): neplatný počet kusů „${cell('units')}“.`,
        raw,
      });
      continue;
    }
    const openDate = toIsoDate(cell('openDate'));
    const closeDate = toIsoDate(cell('closeDate'));
    if (!openDate || !closeDate) {
      ctx.result.errors.push({
        line,
        message: `Uzavřená pozice ${pid} (${parsed.ticker}): neplatné datum „${!openDate ? cell('openDate') : cell('closeDate')}“ (očekáván formát DD/MM/RRRR).`,
        raw,
      });
      continue;
    }
    const openRate = parseEtoroNumber(cell('openRate'));
    const closeRate = parseEtoroNumber(cell('closeRate'));
    if (openRate === null || openRate.lt(0) || closeRate === null || closeRate.lt(0)) {
      ctx.result.errors.push({
        line,
        message: `Uzavřená pozice ${pid} (${parsed.ticker}): neplatná cena otevření/uzavření.`,
        raw,
      });
      continue;
    }

    const typeNorm = canon(cell('type'));
    // R-12f/g: CFD/měnové/komoditní pozice, páka i short = derivát vypořádaný
    // rozdílem (MARGIN) — short na spotu eToro nedělá, jen přes CFD
    const derivative = short || DERIVATIVE_TYPES.has(typeNorm) || parseLeverage(cell('leverage')).gt(1);
    let assetClass: 'STOCK' | 'ETF' | 'CRYPTO' | 'DERIVATIVE';
    let isin: string | null;
    if (derivative) {
      assetClass = 'DERIVATIVE';
      // ISIN podkladu se schválně NEPOUŽIJE ani když ho export nese — sdílený
      // klíč se spotovou pozicí je právě ta vada (viz `derivativeIsin`)
      isin = derivativeIsin(parsed.ticker);
    } else if (typeNorm === 'crypto') {
      assetClass = 'CRYPTO';
      isin = parsed.ticker; // krypto: isin = symbol (kanonický klíč napříč brokery)
    } else {
      assetClass = typeNorm === 'etf' ? 'ETF' : 'STOCK';
      isin = cell('isin') !== '' ? cell('isin') : ctx.requireIsin(parsed.ticker, line);
    }
    if (isin === null) continue; // error per symbol už je nahlášený

    // „Open Rate“ a „Close Rate“ jsou v měně, ve které se titul KOTUJE (eToro
    // API: „Entry price of the position in the instrument's currency“); v USD
    // je jen „Amount“ (investovaná částka) a „Profit(USD)“. Účet je přitom
    // vedený v USD a všechno se ukládá v USD — kurz evropské akcie vydávaný
    // za dolarový dával chybu kolem 10 %, u pencí a jenů řádovou.
    const amount = parseEtoroNumber(cell('amount'));
    const profit = parseEtoroNumber(cell('profit'));

    if (derivative && profit !== null) {
      // R-12r: u derivátu se přebírá realizovaný výsledek pozice v měně účtu,
      // stejně jako u MetaTraderu. Vlastní klíč na pozici: páry s nulovou
      // cenou by se jinak FIFO spárovaly napříč pozicemi a výsledek by se
      // mohl přesunout do jiného roku.
      const [open, close] = syntheticDerivativePair({
        idBase: `etoro-${pid}`,
        isin: `${derivativeIsin(parsed.ticker)}#${pid}`,
        symbol: parsed.ticker,
        openDate,
        closeDate,
        net: profit,
        currency: LEDGER_CURRENCY,
        note: `${short ? 'Short' : 'Long'} ${units.toString()} ks, výsledek pozice podle sloupce Profit(USD)`,
      });
      ctx.push(line, raw, open);
      ctx.push(line, raw, close);
      continue;
    }

    // Ceny v USD dávají jen Amount a Profit(USD): nákup = Amount / kusy,
    // prodej = (Amount + Profit) / kusy. Berou se tak VŽDY, když je výpis má —
    // hádat měnu kurzu z toho, jestli Amount sedí na kusy × kurz, selže, kdykoli
    // byl kurz měny při otevření blízko jedné (EUR/USD na podzim 2022). Stejně
    // se počítá i otevřená pozice z listu Account Activity, takže se obě verze
    // téže nohy shodnou. Bez těch sloupců (starší výpisy) zbývají kurzy.
    let openPrice = openRate;
    let closePrice = closeRate;
    if (amount !== null && amount.gt(0) && profit !== null) {
      openPrice = amount.div(units);
      closePrice = Decimal.max(amount.plus(profit), 0).div(units);
    }

    const common = {
      isin,
      ticker: parsed.ticker,
      quantity: units.toString(),
      currency: LEDGER_CURRENCY,
      assetClass,
      ...(derivative ? { settlementStyle: 'MARGIN' } : {}),
    };
    ctx.push(line, raw, {
      type: short ? 'SELL' : 'BUY',
      id: `etoro-${pid}-open`,
      ...common,
      pricePerShare: openPrice.toString(),
      tradeDate: openDate,
    });
    ctx.push(line, raw, {
      type: short ? 'BUY' : 'SELL',
      id: `etoro-${pid}-close`,
      ...common,
      pricePerShare: closePrice.toString(),
      tradeDate: closeDate,
    });
  }
}

const ACTIVITY_MATCHERS = {
  date: oneOf('date'),
  type: oneOf('type'),
  details: oneOf('details'),
  amount: oneOf('amount'), // přesná shoda — nesmí chytit „Amount in EUR“
  units: oneOf('units / contracts', 'units/contracts', 'units'),
  positionId: oneOf('position id'),
  assetType: oneOf('asset type'),
} as const;
type ActivityField = keyof typeof ACTIVITY_MATCHERS;
const ACTIVITY_REQUIRED = ['date', 'type', 'amount', 'positionId'] as const satisfies readonly ActivityField[];

/** Typy Account Activity vědomě mimo import (pro výpočet daně nejsou potřeba). */
const ACTIVITY_SKIP_MESSAGES: Record<string, string> = {
  deposit: 'Vklad na účet — pro výpočet daně není potřeba.',
  'withdraw request': 'Výběr z účtu — pro výpočet daně není potřeba.',
  'withdraw fee': 'Poplatek za výběr — s obchody nesouvisí, do výpočtu daně nevstupuje.',
  'withdrawal fee': 'Poplatek za výběr — s obchody nesouvisí, do výpočtu daně nevstupuje.',
  'withdrawal conversion fee':
    'Poplatek za konverzi při výběru — s obchody nesouvisí, do výpočtu daně nevstupuje.',
  'deposit conversion fee':
    'Poplatek za konverzi při vkladu — s obchody nesouvisí, do výpočtu daně nevstupuje.',
  'conversion fee': 'Poplatek za konverzi měny — s obchody nesouvisí, do výpočtu daně nevstupuje.',
  'transfer to crypto wallet':
    'Převod na vlastní krypto peněženku — není zdanitelná událost, přeskočen.',
  'withdraw request cancelled': 'Zrušená žádost o výběr — peníze zůstaly na účtu, pro výpočet daně není potřeba.',
  'withdraw fee cancelled': 'Vrácený poplatek za zrušený výběr — s obchody nesouvisí, do výpočtu daně nevstupuje.',
  'start copy': 'Začátek kopírování obchodníka — přesun peněz uvnitř účtu, obchody kopie jsou ve výpisu samostatně.',
  'stop copy': 'Konec kopírování obchodníka — přesun peněz uvnitř účtu, obchody kopie jsou ve výpisu samostatně.',
  'overnight refund':
    'Vratka overnight poplatku — záporný poplatek zatím neumíme zaúčtovat; případně si o ni sniž výdaje ručně.',
};

/** Řádky Account Activity → FEE (kladná částka = náklad). */
const ACTIVITY_FEE_TYPES = new Set(['commission', 'sdrt', 'overnight fee']);

/**
 * List Account Activity: bere se z něj jen to, co jinde není — otevřené pozice
 * (BUY bez prodeje, nutné pro časový test), úroky a poplatky. Obchody uzavřených
 * pozic a dividendy jsou pokryté vlastními listy (žádné dvojí počítání).
 */
function parseActivitySheet(ctx: Ctx, sheet: ExcelJS.Worksheet): void {
  const rows = readSheetRows(sheet);
  if (rows.length === 0) return;
  const header = findHeaderRow(rows, ACTIVITY_MATCHERS, ACTIVITY_REQUIRED);
  if (!header) {
    ctx.result.errors.push({
      line: rows[0]!.rowNumber,
      message: `V listu „${sheet.name}“ se nepodařilo najít hlavičku tabulky (Date, Type, Amount, Position ID) — nevypadá jako výpis z eToro.`,
    });
    return;
  }

  for (let i = header.index + 1; i < rows.length; i += 1) {
    const row = rows[i]!;
    const line = row.rowNumber;
    const raw = row.cells.join(' | ');
    const cell = (field: ActivityField): string => {
      const col = header.columns[field];
      return col === undefined ? '' : (row.cells[col] ?? '');
    };

    const typeRaw = cell('type');
    const t = canon(typeRaw);
    if (t === '') {
      ctx.result.skipped.push({ line, message: 'Řádek bez typu operace — přeskočen.', raw });
      continue;
    }
    // dividendy duplikují list Dividends (tam je i srážková daň) — bez hlášky,
    // ale spočítat: bez listu Dividends by jinak tiše zmizely (§ 8 by chyběl)
    if (t === 'dividend') {
      ctx.activityDividendRows.count += 1;
      continue;
    }

    const pid = cell('positionId');

    if (t === 'open position' || t === 'position closed') {
      // pozice uzavřená v témž exportu je pokrytá párem z Closed Positions
      if (ctx.closedPositionIds.has(pid)) continue;
      if (t === 'position closed') {
        ctx.result.warnings.push({
          line,
          message: `Uzavření pozice ${pid} (${cell('details')}) chybí v listu Closed Positions — obchod se nenaimportoval, zkontroluj, že export pokrývá celé období.`,
          raw,
        });
        continue;
      }
      const date = toIsoDate(cell('date'));
      if (!date) {
        ctx.result.errors.push({
          line,
          message: `Otevřená pozice ${pid}: neplatné datum „${cell('date')}“ (očekáván formát DD/MM/RRRR).`,
          raw,
        });
        continue;
      }
      const details = cell('details');
      if (details === '' || details === '-') {
        ctx.result.errors.push({ line, message: `Otevřená pozice ${pid}: chybí instrument (Details).`, raw });
        continue;
      }
      const assetType = canon(cell('assetType'));
      // „AMD/USD“ → AMD; měnové páry (EUR/USD) se nezkracují — pár JE instrument
      const ticker = assetType === 'currency' ? details.trim() : details.split('/')[0]!.trim();
      const amount = parseEtoroNumber(cell('amount'));
      const units = parseEtoroNumber(cell('units'));
      if (amount === null || amount.lte(0) || units === null || units.lte(0)) {
        ctx.result.errors.push({
          line,
          message: `Otevřená pozice ${ticker}: chybí kladná částka nebo počet kusů — cenu za kus nejde dopočítat.`,
          raw,
        });
        continue;
      }
      // Otevřený derivát nemá daňový dopad (R-12e) a z tohohle listu ho ani
      // zaúčtovat nejde: „Amount“ je u páky jen složená marže, takže
      // Amount / Units není cena, a list neříká směr — short by se uložil
      // jako nákup. Výsledek přijde s uzavřením pozice (list Closed Positions).
      if (DERIVATIVE_TYPES.has(assetType)) {
        ctx.result.skipped.push({
          line,
          message: `Otevřená pozice ${ticker} (${cell('assetType')}): derivát se daní až při uzavření — do té doby ho neevidujeme.`,
          raw,
        });
        continue;
      }
      let assetClass: 'STOCK' | 'ETF' | 'CRYPTO';
      let isin: string | null;
      if (assetType === 'crypto') {
        assetClass = 'CRYPTO';
        isin = ticker;
      } else {
        assetClass = assetType === 'etf' ? 'ETF' : 'STOCK';
        isin = ctx.requireIsin(ticker, line);
      }
      if (isin === null) continue;
      ctx.push(line, raw, {
        type: 'BUY',
        id: pid !== '' && pid !== '-' ? `etoro-${pid}-open` : ctx.contentId(['open', cell('date'), details, cell('amount')]),
        isin,
        ticker,
        assetClass,
        quantity: units.toString(),
        // Amount je investovaná částka v USD → cena za kus = Amount / Units (Decimal)
        pricePerShare: amount.div(units).toString(),
        currency: LEDGER_CURRENCY,
        tradeDate: date,
      });
      continue;
    }

    if (t === 'interest payment') {
      const date = toIsoDate(cell('date'));
      const amount = parseEtoroNumber(cell('amount'));
      if (!date) {
        ctx.result.errors.push({ line, message: `Interest Payment: neplatné datum „${cell('date')}“.`, raw });
        continue;
      }
      if (amount === null || amount.lt(0)) {
        ctx.result.errors.push({ line, message: 'Interest Payment: chybí kladná částka úroku.', raw });
        continue;
      }
      const details = cell('details');
      ctx.push(line, raw, {
        type: 'INTEREST',
        id: ctx.contentId(['interest', cell('date'), details, cell('amount')]),
        amount: amount.toString(),
        currency: LEDGER_CURRENCY,
        date,
        ...(details !== '' && details !== '-' ? { note: details } : {}),
      });
      continue;
    }

    if (ACTIVITY_FEE_TYPES.has(t)) {
      const date = toIsoDate(cell('date'));
      const amount = parseEtoroNumber(cell('amount'));
      if (!date) {
        ctx.result.errors.push({ line, message: `${typeRaw}: neplatné datum „${cell('date')}“.`, raw });
        continue;
      }
      if (amount === null) {
        ctx.result.errors.push({ line, message: `${typeRaw}: chybí částka poplatku.`, raw });
        continue;
      }
      const details = cell('details');
      ctx.push(line, raw, {
        type: 'FEE',
        id: ctx.contentId(['fee', cell('date'), typeRaw, details, cell('amount'), pid]),
        amount: amount.abs().toString(),
        currency: LEDGER_CURRENCY,
        date,
        note: details !== '' && details !== '-' ? `${typeRaw} ${details}` : typeRaw,
      });
      continue;
    }

    if (t === 'staking') {
      ctx.result.warnings.push({
        line,
        message: `Staking odměna ${cell('details')} (${cell('amount')} USD) — daňové zařazení staking odměn zatím nepodporujeme, řádek jsme přeskočili. Případně ji doplň přes univerzální šablonu.`,
        raw,
      });
      continue;
    }
    if (t.startsWith('corp action')) {
      if (t.includes('split')) {
        // Details nese poměr („NVDA/USD 10:1“); kusy otevřené pozice v tomhle
        // listu jsou z doby PŘED štěpením. Jestli jsou kusy v Closed Positions
        // po štěpení přepočtené, doložené není — proto akci neúčtujeme sami.
        const ratio = /(\d{1,9}(?:\.\d{1,9})?)[ \t\u00a0]{0,3}:[ \t\u00a0]{0,3}(\d{1,9}(?:\.\d{1,9})?)/.exec(
          cell('details').slice(0, 200),
        );
        ctx.result.warnings.push({
          line,
          message: ratio
            ? `Split ${cell('details')}: štěpení v poměru ${ratio[1]}:${ratio[2]} sami nezaúčtujeme. Držíš-li titul dál, doplň ho přes univerzální šablonu (CORPORATE_ACTION, subtyp SPLIT, ratio_from ${ratio[2]}, ratio_to ${ratio[1]}), jinak nebudou počty kusů před a po štěpení sedět.`
            : `Split ${cell('details')}: poměr štěpení se z výpisu nepodařilo přečíst — doplň korporátní akci přes univerzální šablonu, jinak nebudou počty kusů před a po štěpení sedět.`,
          raw,
        });
      } else {
        ctx.result.errors.push({
          line,
          message: `Neznámý typ operace „${typeRaw}“ — nahlaš nám ho, doplníme podporu.`,
          raw,
        });
      }
      continue;
    }

    const skipMessage = ACTIVITY_SKIP_MESSAGES[t];
    if (skipMessage !== undefined) {
      ctx.result.skipped.push({ line, message: skipMessage, raw });
      continue;
    }
    // „Transfer: EUR > USD“ a další interní převody — konkrétní znění se mění
    if (t.startsWith('transfer')) {
      ctx.result.skipped.push({
        line,
        message: 'Interní převod/směna měn na účtu — pro výpočet daně není potřeba.',
        raw,
      });
      continue;
    }

    ctx.result.errors.push({
      line,
      message: `Neznámý typ operace „${typeRaw}“ — nahlaš nám ho, doplníme podporu.`,
      raw,
    });
  }
}

const DIVIDEND_MATCHERS = {
  date: oneOf('date of payment', 'date'),
  instrument: oneOf('instrument name', 'instrument'),
  net: prefixed('net dividend'), // „Net Dividend Received (USD)“ i „Net dividends (EUR)“
  whtAmount: prefixed('withholding tax amount'),
  positionId: oneOf('position id'),
  isin: oneOf('isin'),
  currency: oneOf('currency'),
  type: oneOf('type'),
} as const;
type DividendField = keyof typeof DIVIDEND_MATCHERS;
const DIVIDEND_REQUIRED = ['date', 'net'] as const satisfies readonly DividendField[];

/**
 * List Dividends: net + srážková daň po řádcích → gross = net + srážka.
 * Měna ze sufixu hlavičky „(USD)“/„(EUR)“, případně ze sloupce Currency.
 */
function parseDividendsSheet(ctx: Ctx, sheet: ExcelJS.Worksheet): void {
  const rows = readSheetRows(sheet);
  if (rows.length === 0) return;
  const header = findHeaderRow(rows, DIVIDEND_MATCHERS, DIVIDEND_REQUIRED);
  if (!header) {
    ctx.result.errors.push({
      line: rows[0]!.rowNumber,
      message: `V listu „${sheet.name}“ se nepodařilo najít hlavičku tabulky (Date of Payment, Net Dividend…) — nevypadá jako výpis z eToro.`,
    });
    return;
  }

  const netHeader = header.headerCells[header.columns.net!] ?? '';
  const headerCurrency = /\(([a-z]{3})\)/.exec(netHeader)?.[1]?.toUpperCase();
  if (header.columns.whtAmount === undefined) {
    ctx.result.warnings.push({
      line: rows[header.index]!.rowNumber,
      message:
        'List Dividends neuvádí sloupec se srážkovou daní — dividendy importujeme bez srážky (brutto = čistá vyplacená částka).',
    });
  }

  for (let i = header.index + 1; i < rows.length; i += 1) {
    const row = rows[i]!;
    const line = row.rowNumber;
    const raw = row.cells.join(' | ');
    const cell = (field: DividendField): string => {
      const col = header.columns[field];
      return col === undefined ? '' : (row.cells[col] ?? '');
    };

    const instrument = cell('instrument');
    const date = toIsoDate(cell('date'));
    if (!date) {
      ctx.result.errors.push({
        line,
        message: `Dividenda ${instrument}: neplatné datum „${cell('date')}“ (očekáván formát DD/MM/RRRR).`,
        raw,
      });
      continue;
    }
    const net = parseEtoroNumber(cell('net'));
    if (net === null) {
      ctx.result.errors.push({ line, message: `Dividenda ${instrument}: chybí částka.`, raw });
      continue;
    }
    // R-12t: u pozice CFD nejde o dividendu od firmy, ale o úpravu, kterou
    // eToro připisuje (u shortu strhává) držiteli kontraktu. Je to plnění
    // z derivátu — § 10, nikdy § 8 (R-12a) — a „sražená daň“ u něj není
    // zahraniční daň k zápočtu. Přebírá se čistá připsaná částka.
    if (DERIVATIVE_TYPES.has(canon(cell('type')))) {
      const symbol = instrument.split('/')[0]!.trim() || instrument;
      const idBase = ctx.contentId(['cfd-dividend', cell('date'), instrument, cell('net'), cell('positionId')]);
      const [open, close] = syntheticDerivativePair({
        idBase,
        isin: `${derivativeIsin(symbol)}#${idBase}`,
        symbol,
        openDate: date,
        closeDate: date,
        net,
        currency: LEDGER_CURRENCY,
        note: 'Dividendová úprava u pozice CFD (plnění z derivátu, R-12t)',
      });
      ctx.push(line, raw, open);
      ctx.push(line, raw, close);
      ctx.derivativeDividendRows.count += 1;
      continue;
    }
    if (net.lt(0)) {
      ctx.result.warnings.push({
        line,
        message: `Záporná dividenda ${instrument} (${net.toString()}) — nejspíš korekce u CFD/short pozice; zatím ji neumíme zaúčtovat, případně ji zadej ručně.`,
        raw,
      });
      continue;
    }
    const wht =
      header.columns.whtAmount === undefined
        ? ZERO
        : (parseEtoroNumber(cell('whtAmount')) ?? ZERO).abs();
    const rowCurrency = cell('currency');
    const currency = /^[A-Za-z]{3}$/.test(rowCurrency)
      ? rowCurrency.toUpperCase()
      : (headerCurrency ?? LEDGER_CURRENCY);
    // „NKE/USD“ → ticker NKE; plný název firmy jde do poznámky, ticker není
    const slash = instrument.split('/');
    const ticker =
      slash.length === 2 && /^[A-Za-z0-9.]+$/.test(slash[0]!.trim()) ? slash[0]!.trim() : undefined;
    const isin = cell('isin');
    ctx.push(line, raw, {
      type: 'DIVIDEND',
      id: ctx.contentId(['dividend', cell('date'), instrument, cell('net'), cell('positionId')]),
      ...(isin !== '' && isin !== '-' ? { isin } : {}),
      ...(ticker !== undefined ? { ticker } : {}),
      ...(ticker === undefined && instrument !== '' ? { note: instrument } : {}),
      gross: net.plus(wht).toString(),
      withholdingTax: wht.toString(),
      currency,
      date,
    });
  }
}

/**
 * Parser eToro „Account Statement“ XLSX. Obchody bere z listu Closed Positions
 * (pár BUY/SELL za pozici), otevřené pozice z Account Activity (ISIN dodává
 * `instrumentMap` — eToro ho u aktivit neuvádí), dividendy z listu Dividends.
 * Ledger je v USD; čísla i datumy se čtou tolerantně k locale účtu.
 */
export async function parseEtoroXlsx(
  data: XlsxSource,
  instrumentMap: EtoroInstrumentMap = {},
): Promise<ImportResult & { unmappedSymbols: string[] }> {
  const result = { ...emptyResult(ETORO_BROKER), unmappedSymbols: [] as string[] };

  const opened = await openXlsxSource(data);
  if ('error' in opened) {
    result.errors.push({ line: 1, message: opened.error });
    return result;
  }
  const { workbook } = opened;

  const closedSheet = findSheet(workbook, 'closed positions');
  const activitySheet = findSheet(workbook, 'account activity');
  if (!closedSheet || !activitySheet) {
    const missing = [
      ...(closedSheet ? [] : ['„Closed Positions“']),
      ...(activitySheet ? [] : ['„Account Activity“']),
    ].join(' a ');
    result.errors.push({
      line: 1,
      message: `Soubor neobsahuje list ${missing} — nevypadá jako výpis z eToro (Account Statement). Nalezené listy: ${workbook.worksheets.map((s) => s.name).join(', ') || '(žádné)'}. ${ETORO_ENGLISH_ONLY}`,
    });
    return result;
  }

  // stabilní obsahová ID pro řádky bez vlastního ID; identické řádky rozliší suffix -2, -3…
  const idOccurrences = new Map<string, number>();
  const contentId = (parts: string[]): string => {
    const base = `etoro-${fnv1a64(parts.join('|'))}`;
    const seen = (idOccurrences.get(base) ?? 0) + 1;
    idOccurrences.set(base, seen);
    return seen === 1 ? base : `${base}-${seen}`;
  };

  const seenIds = new Set<string>();
  const push = (line: number, raw: string, candidate: Record<string, unknown>): void => {
    try {
      const tx = TransactionSchema.parse(candidate);
      if (seenIds.has(tx.id)) {
        result.warnings.push({
          line,
          message: `Duplicitní ID transakce ${tx.id} — deduplikace záznamy sloučí. Zkontroluj, zda nejde o dvě skutečné operace.`,
        });
      }
      seenIds.add(tx.id);
      result.transactions.push(tx);
    } catch (error) {
      result.errors.push({
        line,
        message: `Řádek se nepodařilo zpracovat: ${error instanceof Error ? error.message : String(error)}`,
        raw,
      });
    }
  };

  const unmapped = new Set<string>();
  const fileIsins = new Map<string, Set<string>>();
  /**
   * ISIN pro akcie/ETF bez ISIN na řádku — JEDEN error per symbol. Nejdřív
   * z téhož výpisu (Closed Positions uvádí ISIN u tickeru, Account Activity
   * u otevřené pozice ne; revize R5), pak z číselníku. Ticker, který má ve
   * výpisu dva různé ISIN, se ze souboru nebere.
   */
  const requireIsin = (ticker: string, line: number): string | null => {
    const inFile = fileIsins.get(ticker);
    if (inFile?.size === 1) return [...inFile][0]!;
    const mapped = instrumentMap[ticker]?.isin;
    if (mapped !== undefined) return mapped;
    if (!unmapped.has(ticker)) {
      unmapped.add(ticker);
      result.errors.push({
        line,
        message: `Symbol ${ticker}: doplň ISIN instrumentu (eToro ho u této pozice neuvádí).`,
        unmappedSymbol: ticker,
      });
    }
    return null;
  };

  const ctx: Ctx = {
    result,
    instrumentMap,
    closedPositionIds: new Set<string>(),
    push,
    contentId,
    requireIsin,
    activityDividendRows: { count: 0 },
    derivativeDividendRows: { count: 0 },
    fileIsins,
  };
  // pořadí je závazné: Closed Positions plní closedPositionIds, Activity je čte
  parseClosedSheet(ctx, closedSheet);
  parseActivitySheet(ctx, activitySheet);
  const dividendsSheet = findSheet(workbook, 'dividends');
  if (dividendsSheet) parseDividendsSheet(ctx, dividendsSheet);

  // Activity dividendy jen přeskakuje (srážková daň je jen v listu Dividends) —
  // chybí-li ten list, zmizely by beze stopy a příjem § 8 by se do daně nedostal
  // Pojistka byla všechno-nebo-nic (`imported === 0`), takže stačila JEDINÁ
  // dividenda v listu Dividends a zbytek zmizel bez hlášky: 3 řádky v Account
  // Activity + 1 v Dividends → naimportovala se 1 a mezi errors/warnings/skipped
  // o dividendách ani zmínka. Vynechaný příjem § 8 přitom umí shodit i limit
  // 50 000 Kč (nález B-3-7). Porovnává se proto s POČTEM řádků, ne s nulou.
  const imported =
    result.transactions.filter((tx) => tx.type === 'DIVIDEND').length +
    ctx.derivativeDividendRows.count;
  const missingDividends = ctx.activityDividendRows.count - imported;
  if (missingDividends > 0) {
    result.errors.push({
      line: 1,
      message:
        imported === 0
          ? `V listu „Account Activity“ je ${ctx.activityDividendRows.count} dividendových řádků, ale list „Dividends“ ve výpisu chybí (nebo je prázdný) — dividendy jsme proto nenaimportovali. Stáhni z eToro Account Statement za celé období včetně listu Dividends (je v něm i sražená daň) a nahraj ho znovu.`
          : `V listu „Account Activity“ je ${ctx.activityDividendRows.count} dividendových řádků, ale z listu „Dividends“ jich jde načíst jen ${imported} — ${missingDividends} by se do daně nedostalo. Stáhni z eToro Account Statement za celé období, ať je list Dividends kompletní (je v něm i sražená daň), a nahraj ho znovu.`,
    });
  }

  result.unmappedSymbols = [...unmapped];
  return result;
}
