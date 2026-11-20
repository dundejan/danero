import type ExcelJS from 'exceljs';
import { Decimal, d, TransactionSchema } from '@danero/shared';
import {
  detectDecimalSeparator,
  isAmbiguousThousandGroup,
  normalizeHeader,
  parseEuroDate,
} from '../csv';
import { fnv1a64, uniqueIdFactory } from '../dedupe';
import { emptyResult, type ImportResult } from '../types';
import { openXlsxSource, readSheetRows, type SheetRow, type XlsxSource } from '../xlsx';

export const AMUNDI_BROKER = 'amundi';

/**
 * Parser sešitu „Export transakcí“ z portálu Moje Amundi (fondy Amundi
 * a partnerských správců, typicky pravidelné investice v korunách).
 *
 * Formát (doloženo skutečným exportem z 20. 11. 2026): XLSX se dvěma listy,
 * všechny buňky jsou TEXT — čísla s desetinnou čárkou a pevnou mezerou mezi
 * tisíci („12 500,00“), datum „11. 03. 2025“ (ukázky jsou smyšlené).
 *
 *  - **Transakce** — pokyny, jak je klient zadal:
 *    `Datum přijetí | Datum vypořádání | Typ | Produkt | Hodnota pokynu |
 *    Vstupní poplatek | Hodnota investice | Stav`. Částky nesou měnu v buňce
 *    (částka, mezera, „Kč“ nebo „$“); chybí ISIN, kusy i cena.
 *  - **Detail transakce** — obchody, jak se provedly:
 *    `Zobchodování | Typ | Fond | ISIN | Datum ceny | Množství | Cena |
 *    Částka | Měna`. Z tohohle listu čteme.
 *
 * Tři věci, které z hlavičky nejsou vidět:
 *
 * 1. **„Primární prodej“ je NÁKUP.** Typ je psaný z pohledu fondu: fond
 *    investorovi primárně prodává (vydává) podílové listy. Jiný typ jsme ve
 *    skutečném exportu neviděli, takže odkup ani výměnu nehádáme — neznámý typ
 *    končí chybou s doslovným zněním.
 * 2. **Množství je zaokrouhlené na tři místa a u drahých fondů je k ničemu.**
 *    Fond s cenou v desítkách tisíc a investicí kolem tisíce korun má
 *    v exportu třeba „0,119“ — zobrazené kusy × cena se od zaplacené částky
 *    liší až o jednotky procent. Částka a cena jsou přesné, takže kusy dopočítáváme z nich
 *    (částka ÷ cena na šest míst; ve skutečném exportu pak kusy × cena dají
 *    částku na haléř u každého řádku). Zobrazené množství slouží jen jako
 *    kontrola: musí být zaokrouhlením dopočítaného, jinak řádek odmítneme.
 * 3. **Vstupní poplatek je jen na listu pokynů a k obchodu ho nejde bezpečně
 *    přiřadit** — listy nemají společný klíč, u fondu v cizí měně je navíc
 *    „poplatek“ rozdíl dvou částek v různých měnách a u části pokynů vychází
 *    záporný. Do nabývací ceny ho proto nezapočítáváme (bezpečný směr: daň
 *    vyjde nanejvýš vyšší) a import to řekne.
 *
 * Export nemá id řádku → id je otisk obsahu s pořadím shodných řádků.
 */

/** Sloupce listu obchodů v tvaru normalizeHeader. */
const COL = {
  tradeDate: 'zobchodovani',
  type: 'typ',
  fund: 'fond',
  isin: 'isin',
  quantity: 'mnozstvi',
  price: 'cena',
  amount: 'castka',
  currency: 'mena',
} as const;

/**
 * Sloupce, podle kterých se list obchodů pozná A které parser vyžaduje —
 * jeden seznam pro sniffer i parser. `Fond` a `Množství` mezi nimi nejsou:
 * parser se bez nich obejde.
 */
const REQUIRED_COLUMNS = [COL.tradeDate, COL.type, COL.isin, COL.price, COL.amount, COL.currency] as const;

/** Sloupce, které má jen list pokynů — podle nich ho poznáme a ohlásíme. */
const ORDER_SHEET_COLUMNS = ['hodnota pokynu', 'vstupni poplatek'] as const;

/** Na kolik míst dopočítáváme kusy z částky a ceny. */
const QUANTITY_PLACES = 6;

/** O kolik se smí zobrazené množství (tři místa) lišit od dopočítaného. */
const SHOWN_QUANTITY_TOLERANCE = d('0.001');

const isCurrency = (value: string): boolean => /^[A-Z]{3}$/.test(value);

interface TradeSheet {
  name: string;
  header: string[];
  rows: SheetRow[];
}

const headerOf = (rows: SheetRow[]): string[] => (rows[0]?.cells ?? []).map(normalizeHeader);

/** List obchodů: první, jehož první řádek nese všechny vyžadované sloupce. */
function findTradeSheet(workbook: ExcelJS.Workbook): TradeSheet | null {
  for (const sheet of workbook.worksheets) {
    const rows = readSheetRows(sheet);
    const header = headerOf(rows);
    if (REQUIRED_COLUMNS.every((column) => header.includes(column))) {
      return { name: sheet.name, header, rows: rows.slice(1) };
    }
  }
  return null;
}

/** Autodetekce: sešit má list obchodů se sloupci, které parser vyžaduje. */
export function sniffAmundiXlsx(workbook: ExcelJS.Workbook): boolean {
  return findTradeSheet(workbook) !== null;
}

export async function parseAmundiXlsx(data: XlsxSource): Promise<ImportResult> {
  const result = emptyResult(AMUNDI_BROKER);

  const opened = await openXlsxSource(data);
  if ('error' in opened) {
    result.errors.push({ line: 1, message: opened.error });
    return result;
  }
  const { workbook } = opened;

  const trades = findTradeSheet(workbook);
  if (!trades) {
    result.errors.push({
      line: 1,
      message:
        'Sešit nevypadá jako export transakcí z portálu Moje Amundi — chybí list „Detail transakce“ se sloupci Zobchodování, Typ, ISIN, Cena, Částka a Měna.',
    });
    return result;
  }

  const index = (name: string): number => trades.header.indexOf(name);
  const get = (row: SheetRow, name: string): string => {
    const i = index(name);
    return i === -1 ? '' : (row.cells[i] ?? '').trim();
  };

  // Lokalizace čísel se rozhoduje jednou za list. Tisíce odděluje mezera,
  // takže jediný oddělovač v čísle je vždy desetinný.
  const numericColumns = [COL.quantity, COL.price, COL.amount].map(index).filter((i) => i !== -1);
  const decimal = detectDecimalSeparator(
    trades.rows.flatMap((row) => numericColumns.map((i) => row.cells[i] ?? '')),
  );

  /** Číslo s mezerami mezi tisíci → Decimal; prázdné → null; jiný zápis → 'invalid'. */
  const num = (raw: string): Decimal | null | 'invalid' => {
    const value = raw.replace(/\s/g, '');
    if (value === '') return null;
    const match = /^(-?\d+)(?:([.,])(\d+))?$/.exec(value);
    if (!match) return 'invalid';
    if (match[2] !== undefined && decimal !== null && match[2] !== decimal) return 'invalid';
    // List, který lokalizaci neprozradil, a číslo se třemi místy za jediným
    // oddělovačem: tisíce, nebo desetiny? Nehádáme — řádek skončí chybou.
    if (decimal === null && isAmbiguousThousandGroup(value)) return 'invalid';
    return d(match[3] === undefined ? match[1]! : `${match[1]}.${match[3]}`);
  };

  const uniqueId = uniqueIdFactory();

  // účet jen s přijatými, ještě nezobchodovanými pokyny: „0 nových, 0 chyb“
  // by vypadalo jako úspěch
  if (trades.rows.length === 0) {
    result.warnings.push({
      line: 1,
      message: `List „${trades.name}“ je prázdný — v sešitu není žádný provedený obchod. Pokud jsi investoval teprve nedávno, stáhni export znovu, až se pokyny zobchodují.`,
    });
  }

  for (const row of trades.rows) {
    const line = row.rowNumber;
    const raw = row.cells.join(';');
    const fail = (message: string): void => {
      result.errors.push({ line, message, raw });
    };

    const rawType = get(row, COL.type);
    if (normalizeHeader(rawType) !== 'primarni prodej') {
      fail(`Neznámý typ transakce „${rawType}“ — nahlaš nám ho, doplníme podporu.`);
      continue;
    }

    const rawDate = get(row, COL.tradeDate);
    const tradeDate = parseEuroDate(rawDate);
    if (!tradeDate) {
      fail(`Neplatné datum „${rawDate}“ ve sloupci Zobchodování (očekáván formát dd. mm. rrrr).`);
      continue;
    }
    const currency = get(row, COL.currency);
    if (!isCurrency(currency)) {
      fail(`Řádku chybí měna (sloupec Měna) — nalezeno „${currency}“, očekáván třípísmenný kód (CZK, EUR…).`);
      continue;
    }
    const isin = get(row, COL.isin);
    if (isin === '') {
      fail(`${rawType}: chybí ISIN fondu — řádek nelze zpracovat.`);
      continue;
    }
    const price = num(get(row, COL.price));
    if (price === null || price === 'invalid' || price.lte(0)) {
      fail(`${rawType}: chybí cena podílového listu nebo ji neumíme přečíst („${get(row, COL.price)}“).`);
      continue;
    }
    const amount = num(get(row, COL.amount));
    if (amount === null || amount === 'invalid' || amount.lte(0)) {
      fail(`${rawType}: chybí zaplacená částka nebo ji neumíme přečíst („${get(row, COL.amount)}“).`);
      continue;
    }

    const quantity = amount.div(price).toDecimalPlaces(QUANTITY_PLACES);
    if (quantity.lte(0)) {
      fail(`${rawType}: z částky a ceny vychází nulový počet kusů — řádek nelze zpracovat.`);
      continue;
    }
    // Zobrazené množství je zaokrouhlení skutečného. Když dopočítanému
    // neodpovídá, čteme sloupce jinak, než co znamenají — raději chyba.
    const rawShown = get(row, COL.quantity);
    const shown = num(rawShown);
    if (shown === 'invalid') {
      fail(`${rawType}: množství neumíme přečíst („${rawShown}“).`);
      continue;
    }
    if (shown !== null) {
      // Pevná mez, ne podle počtu zobrazených míst: export koncové nuly
      // nepíše („0,36“ je 0,360), takže „1“ smí být jen 1,000.
      if (quantity.minus(shown).abs().gt(SHOWN_QUANTITY_TOLERANCE)) {
        fail(
          `${rawType}: množství „${rawShown}“ neodpovídá částce a ceně (z nich vychází ${quantity.toString()} ks) — řádek jsme nezaúčtovali. Nahlaš nám ho, podíváme se na něj.`,
        );
        continue;
      }
    }

    const candidate = {
      type: 'BUY',
      id: uniqueId(
        `amundi-${fnv1a64([tradeDate, isin, amount.toString(), price.toString(), currency].join('|'))}`,
      ),
      isin,
      name: get(row, COL.fund) || undefined,
      quantity: quantity.toString(),
      pricePerShare: price.toString(),
      currency,
      tradeDate,
    };
    try {
      result.transactions.push(TransactionSchema.parse(candidate));
    } catch (err) {
      fail(`Řádek se nepodařilo zpracovat: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const sheet of workbook.worksheets) {
    if (sheet.name === trades.name) continue;
    const header = headerOf(readSheetRows(sheet));
    if (!ORDER_SHEET_COLUMNS.every((column) => header.includes(column))) continue;
    result.skipped.push({
      line: 1,
      message: `List „${sheet.name}“ (pokyny) nečteme — obchody bereme z listu „${trades.name}“. Vstupní poplatek z něj do nabývací ceny nezapočítáváme: k jednotlivým obchodům ho nejde spolehlivě přiřadit, takže daň z pozdějšího prodeje vyjde nanejvýš o něco vyšší.`,
    });
  }

  return result;
}
