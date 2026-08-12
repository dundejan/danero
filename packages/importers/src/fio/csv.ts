import { Decimal, d, TransactionSchema, ZERO } from '@danero/shared';
import { HeaderMap, isValidIsoDate } from '../csv';
import { fnv1a64 } from '../dedupe';
import type { ImportResult } from '../types';

export const FIO_BROKER = 'fio';

export interface FioParseOptions {
  /**
   * Fio e-Broker ISIN neexportuje (jen symbol/ticker) — mapování symbol → ISIN
   * dodává volající (uložené mapování uživatele). Bez něj se BUY/SELL neemitují.
   */
  symbolMap?: Record<string, { isin: string }>;
}

export interface FioImportResult extends ImportResult {
  /** Symboly obchodů bez ISIN mapování — uživatel je musí doplnit a import zopakovat. */
  unmappedSymbols: string[];
}

/**
 * Fio exportuje CSV v kódování windows-1250 — dekódování drž mimo parsování,
 * string vstup parseru už musí být dekódovaný.
 */
/**
 * Poznává Fio export z hlavičky — jediná definice pro autodetekci i parser.
 *
 * ⚠️ Ptá se JEN na „Datum obchodu“, ne na „Směr“, a schválně: autodetekce běží
 * nad textem dekódovaným jako UTF-8, ale Fio posílá windows-1250. „Datum
 * obchodu“ je čisté ASCII, takže je čitelné i při špatném dekódování — „Směr“
 * by se rozsypalo na „Sm?r“ a soubor by se nepoznal. Parser si obě hlavičky
 * ověřuje znovu, už nad správně dekódovaným textem.
 */
export function sniffFioCsv(header: string): boolean {
  return header.includes('Datum obchodu');
}

export function decodeFioCsv(data: ArrayBuffer | Uint8Array): string {
  return new TextDecoder('windows-1250').decode(data);
}

/**
 * Středníkové CSV (vzor parseCsv v ../csv.ts, jen jiný oddělovač): uvozovky,
 * escapované uvozovky (""), CRLF i LF, BOM, prázdné řádky na konci.
 */
function parseSemicolonCsv(text: string): { headers: string[]; rows: string[][] } {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const pushField = (): void => {
    row.push(field);
    field = '';
  };
  const pushRow = (): void => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ';') {
      pushField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      if (input[i + 1] === '\n') i += 1;
      pushRow();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== '' || row.length > 0) pushRow();

  while (rows.length > 0 && rows[rows.length - 1]!.every((cell) => cell.trim() === '')) {
    rows.pop();
  }

  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, rows };
}

/** Fio čísla: desetinná čárka, mezery (i nezlomitelné) jako oddělovač tisíců. */
function cleanFioNumber(value: string): string {
  return value.replace(/\s/g, '').replace(',', '.');
}

/**
 * Číslo z Fio buňky, nebo `null`, když se přečíst nedá.
 *
 * `d()` na nečitelném vstupu vyhodí `DecimalError`, a ta letěla z celého
 * `parseFioCsv` ven: jeden řádek s `Objem v CZK = "12.345,67"` (nebo „N/A“
 * či pomlčkou) shodil import **včetně všech zdravých řádků** a uživatel dostal
 * anglickou hlášku knihovny. Fuzz přes 24 fixtur našel 231 pádů — všechny
 * ve Fiu, ostatních 23 parserů výjimku nevyhodilo ani jednou (nález B-3-5).
 * Nečitelná buňka teď zůstane chybou jednoho řádku, jak to dělají ostatní.
 */
function fioNumber(value: string): Decimal | null {
  try {
    return d(cleanFioNumber(value));
  } catch {
    return null;
  }
}

/** Fio datum `dd.MM.yyyy`, s časem `dd.MM.yyyy HH:mm[:ss]` → ISO; neexistující den → null. */
function toIsoDate(value: string): string | null {
  const match = /^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(
    value.trim(),
  );
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
  return isValidIsoDate(iso) ? iso : null;
}

/** Země zdroje dividendy z Text FIO — jen jistoty (USA); jinak se doplní z ISIN. */
function countryFromText(text: string): string | undefined {
  return /\busa\b/i.test(text) ? 'US' : undefined;
}

type RowKind =
  | 'BUY'
  | 'SELL'
  | 'DIVIDEND'
  | 'TAX'
  | 'FEE'
  | 'INTEREST'
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'TRANSFER'
  | 'TEXT_ONLY'
  | 'UNKNOWN';

/** Klasifikace řádku dle sloupce Směr (case-insensitive), doplňkově dle Text FIO. */
function classifyRow(smer: string, text: string): RowKind {
  const s = smer.trim().toLowerCase();
  const t = text.trim().toLowerCase();
  if (s.includes('nákup')) return 'BUY';
  if (s.includes('prodej')) return 'SELL';
  if (s.includes('vloženo')) return 'DEPOSIT';
  if (s.includes('vybráno')) return 'WITHDRAWAL';
  if (s.includes('převod')) return 'TRANSFER';
  if (s.includes('úrok')) return 'INTEREST';
  if (s.includes('poplatek')) return 'FEE';
  // daň PŘED dividendou — „Daň z dividendy“ obsahuje obě klíčová slova
  if (t.includes('srážková daň') || t.startsWith('daň')) return 'TAX';
  if (s.includes('dividenda') || t.includes('dividend')) return 'DIVIDEND';
  if (s === '' && t !== '') return 'TEXT_ONLY';
  return 'UNKNOWN';
}

interface DividendEntry {
  line: number;
  id: string;
  symbol: string;
  isin?: string;
  date: string;
  gross: Decimal;
  currency: string;
  sourceCountry?: string;
  note?: string;
  raw: string;
  withholding?: Decimal;
}

interface TaxEntry {
  line: number;
  symbol: string;
  date: string;
  amount: Decimal;
  currency: string;
}

/**
 * Parser CSV exportu Fio e-Brokeru (docs/03). Kódování windows-1250 (binární
 * vstup dekóduje TextDecoder, string bere jako už dekódovaný), oddělovač
 * středník, CZ hlavičky, čísla s desetinnou čárkou, datum dd.MM.yyyy.
 * Mapuje výhradně podle NÁZVŮ sloupců — varianty exportu mají různé sady
 * měnových sloupců (Objem/Poplatky v CZK/USD/EUR).
 *
 * Fio neexportuje ISIN — obchody potřebují options.symbolMap; dividendu a daň
 * dává jako samostatné řádky téhož symbolu a data (párujeme 1:1).
 */
export function parseFioCsv(
  data: ArrayBuffer | Uint8Array | string,
  options: FioParseOptions = {},
): FioImportResult {
  const text = typeof data === 'string' ? data : decodeFioCsv(data);
  const result: FioImportResult = {
    broker: FIO_BROKER,
    transactions: [],
    errors: [],
    skipped: [],
    warnings: [],
    unmappedSymbols: [],
  };

  if (text.trim() === '') {
    result.errors.push({
      line: 1,
      message: 'Soubor je prázdný — vyexportuj z e-Brokeru pohyby za zvolené období znovu.',
    });
    return result;
  }

  const { headers, rows } = parseSemicolonCsv(text);
  const map = new HeaderMap(headers);

  if (!map.has('Datum obchodu') || !map.has('Směr')) {
    result.errors.push({
      line: 1,
      message: `Soubor nevypadá jako export z Fio e-Brokeru — chybí sloupce "Datum obchodu"/"Směr". Nalezené sloupce: ${headers.join(', ')}`,
    });
    return result;
  }

  // měnové sloupce podle skutečných hlaviček — sada se mezi variantami exportu liší
  const volumeCurrencies = headers
    .filter((h) => /^Objem v [A-Z]{3}$/.test(h))
    .map((h) => h.slice(-3));
  const feeCurrencies = headers
    .filter((h) => /^Poplatky v [A-Z]{3}$/.test(h))
    .map((h) => h.slice(-3));

  /** Částka řádku: preferuj sloupec měny obchodu, jinak první neprázdný (nese svou měnu). */
  const resolveAmount = (
    row: string[],
    preferredCurrency: string,
  ): { amount: Decimal; currency: string } | null => {
    const order = volumeCurrencies.includes(preferredCurrency)
      ? [preferredCurrency, ...volumeCurrencies.filter((c) => c !== preferredCurrency)]
      : volumeCurrencies;
    for (const currency of order) {
      const raw = map.get(row, `Objem v ${currency}`);
      if (raw === '') continue;
      const amount = fioNumber(raw);
      // nečitelná částka = chyba tohohle řádku (volající ji ohlásí), ne pád
      // celého importu (B-3-5)
      if (amount) return { amount, currency };
      return null;
    }
    return null;
  };

  /** Poplatek obchodu: sloupec měny obchodu, jinak jiný neprázdný (Fio často účtuje v CZK). */
  const resolveFee = (
    row: string[],
    tradeCurrency: string,
    line: number,
  ): { amount: string; currency: string } | undefined => {
    const candidates: Array<{ currency: string; amount: Decimal }> = [];
    for (const currency of feeCurrencies) {
      const raw = map.get(row, `Poplatky v ${currency}`);
      if (raw === '') continue;
      const parsed = fioNumber(raw);
      if (!parsed) {
        result.warnings.push({
          line,
          message: `Poplatek „${raw}“ ve sloupci „Poplatky v ${currency}“ se nepodařilo přečíst — počítáme ho 0, zkontroluj ho v e-Brokeru.`,
        });
        continue;
      }
      const amount = parsed.abs();
      if (amount.gt(0)) candidates.push({ currency, amount });
    }
    if (candidates.length === 0) {
      if (!feeCurrencies.includes(tradeCurrency)) {
        result.warnings.push({
          line,
          message: `Export nemá sloupec „Poplatky v ${tradeCurrency}“ — poplatek počítáme 0, zkontroluj ho v e-Brokeru.`,
        });
      }
      return undefined;
    }
    const chosen = candidates.find((c) => c.currency === tradeCurrency) ?? candidates[0]!;
    for (const other of candidates) {
      if (other !== chosen) {
        result.warnings.push({
          line,
          message: `Poplatek ${other.amount.toString()} ${other.currency} v další měně nebyl započten (bereme ${chosen.amount.toString()} ${chosen.currency}) — doplň ručně.`,
        });
      }
    }
    return { amount: chosen.amount.toString(), currency: chosen.currency };
  };

  // Fio nemá ID řádku → obsahový hash; identické legitimní řádky dostanou
  // pořadový suffix -2, -3 (stabilní mezi překrývajícími se exporty, viz dedupe)
  const idOccurrences = new Map<string, number>();
  const contentId = (parts: Array<string | undefined>): string => {
    const base = `fio-${fnv1a64(parts.map((p) => p ?? '').join('|'))}`;
    const seen = (idOccurrences.get(base) ?? 0) + 1;
    idOccurrences.set(base, seen);
    return seen === 1 ? base : `${base}-${seen}`;
  };

  const push = (line: number, raw: string, candidate: Record<string, unknown>): void => {
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

  const symbolMap = options.symbolMap ?? {};
  // dvě evidence: `unmappedListed` hlídá, ať se symbol dostane do unmappedSymbols
  // jen jednou; `unmappedErrored` hlídá chybu u obchodů — dividendové varování
  // ji nesmí umlčet (obchod bez ISIN se zahazuje a bez chyby by zmizel tiše)
  const unmappedListed = new Set<string>();
  const unmappedErrored = new Set<string>();
  /** Symbol bez ISIN → jednou do seznamu k doplnění (UI nabídne číselník). */
  const listUnmapped = (symbol: string): void => {
    if (unmappedListed.has(symbol)) return;
    unmappedListed.add(symbol);
    result.unmappedSymbols.push(symbol);
  };
  const dividends: DividendEntry[] = [];
  const taxes: TaxEntry[] = [];

  rows.forEach((row, rowIndex) => {
    const line = rowIndex + 2; // 1 = hlavička
    if (row.every((cell) => cell.trim() === '')) return;

    const raw = row.join(';');
    const rawDate = map.get(row, 'Datum obchodu');
    const smer = map.get(row, 'Směr');
    const symbol = map.get(row, 'Symbol');
    const mena = map.get(row, 'Měna');
    const note = map.get(row, 'Text FIO');

    const date = toIsoDate(rawDate);
    if (!date) {
      result.errors.push({
        line,
        message: `Neplatné datum „${rawDate}“ (očekáván formát dd.mm.rrrr, případně s časem).`,
        raw,
      });
      return;
    }

    const quantity = cleanFioNumber(map.get(row, 'Počet'));
    const price = cleanFioNumber(map.get(row, 'Cena'));
    // ID nese i vyřešenou částku — hotovostní operace téhož dne s různými
    // částkami nesmí sdílet základ hashe (ID by pak záviselo na pořadí v souboru)
    const rowId = (amount?: Decimal): string =>
      contentId([smer.toLowerCase(), date, symbol, quantity, price, mena, amount?.toString()]);
    const kind = classifyRow(smer, note);

    switch (kind) {
      case 'BUY':
      case 'SELL': {
        if (!symbol || !quantity || !price || !mena) {
          result.errors.push({
            line,
            message: `${smer}: chybí symbol, počet kusů, cena nebo měna — řádek nelze zpracovat.`,
            raw,
          });
          return;
        }
        // Nečitelné číslo patří k JEDNOMU řádku. `d()` v argumentech push()
        // stálo mimo jeho try/catch, takže jediná buňka jako „1.234,50“
        // vyhodila DecimalError z celého parseru a nenaimportoval se ani jeden
        // zdravý řádek — uživatel dostal „soubor je nejspíš poškozený“ (B-3-5).
        const quantityValue = fioNumber(quantity);
        const priceValue = fioNumber(price);
        if (quantityValue === null || priceValue === null) {
          result.errors.push({
            line,
            message: `${smer}: nečitelný počet kusů „${map.get(row, 'Počet')}“ nebo cena „${map.get(row, 'Cena')}“ — řádek nelze zpracovat.`,
            raw,
          });
          return;
        }
        const isin = symbolMap[symbol]?.isin;
        if (!isin) {
          // jeden error per symbol — uživatel doplní mapování a import zopakuje
          listUnmapped(symbol);
          if (!unmappedErrored.has(symbol)) {
            unmappedErrored.add(symbol);
            result.errors.push({
              line,
              message: `Symbol ${symbol}: doplň ISIN — Fio ho neexportuje.`,
              raw,
            });
          }
          return;
        }
        push(line, raw, {
          type: kind,
          id: rowId(),
          isin,
          ticker: symbol,
          quantity: quantityValue.abs().toString(),
          pricePerShare: priceValue.abs().toString(),
          currency: mena,
          fee: resolveFee(row, mena, line),
          tradeDate: date,
          note: note || undefined,
        });
        return;
      }
      case 'DIVIDEND': {
        const resolved = resolveAmount(row, mena);
        if (!resolved) {
          result.errors.push({ line, message: 'Dividenda bez částky — řádek nelze zpracovat.', raw });
          return;
        }
        // symbol, ke kterému má soubor JEN dividendy, se dřív k doplnění ISIN
        // vůbec nenabídl (unmappedSymbols se plnily jen ve větvi BUY/SELL)
        if (symbol && !symbolMap[symbol]?.isin && !unmappedListed.has(symbol)) {
          listUnmapped(symbol);
          result.warnings.push({
            line,
            message: `Symbol ${symbol}: doplň ISIN — Fio ho neexportuje. Dividendu jsme zaúčtovali podle symbolu, ale bez ISIN ji nepřiřadíme k pozici a zemi zdroje odhadujeme jen z textu.`,
          });
        }
        dividends.push({
          line,
          id: rowId(resolved.amount),
          symbol,
          isin: symbolMap[symbol]?.isin,
          date,
          gross: resolved.amount.abs(),
          currency: resolved.currency,
          sourceCountry: countryFromText(note),
          note: note || undefined,
          raw,
        });
        return;
      }
      case 'TAX': {
        const resolved = resolveAmount(row, mena);
        if (!resolved) {
          result.errors.push({
            line,
            message: 'Srážková daň bez částky — řádek nelze zpracovat.',
            raw,
          });
          return;
        }
        taxes.push({ line, symbol, date, amount: resolved.amount.abs(), currency: resolved.currency });
        return;
      }
      case 'INTEREST':
      case 'FEE': {
        const resolved = resolveAmount(row, mena);
        if (!resolved) {
          result.errors.push({ line, message: `${smer}: chybí částka.`, raw });
          return;
        }
        push(line, raw, {
          type: kind,
          id: rowId(resolved.amount),
          amount: resolved.amount.abs().toString(),
          currency: resolved.currency,
          date,
          note: note || undefined,
        });
        return;
      }
      case 'DEPOSIT':
      case 'WITHDRAWAL':
      case 'TRANSFER': {
        const resolved = resolveAmount(row, mena);
        if (!resolved) {
          result.errors.push({ line, message: `${smer}: chybí částka.`, raw });
          return;
        }
        // „Převod“ nese směr znaménkem částky; Vloženo/Vybráno ho mají ve Směru
        const type =
          kind === 'TRANSFER' ? (resolved.amount.gte(0) ? 'DEPOSIT' : 'WITHDRAWAL') : kind;
        push(line, raw, {
          type,
          id: rowId(resolved.amount),
          amount: resolved.amount.abs().toString(),
          currency: resolved.currency,
          date,
          note: note || undefined,
        });
        return;
      }
      case 'TEXT_ONLY': {
        // prázdný Směr s textem (poplatek za data, ADR fee…) — záporná částka = poplatek
        const resolved = resolveAmount(row, mena);
        if (resolved && resolved.amount.lt(0)) {
          push(line, raw, {
            type: 'FEE',
            id: rowId(resolved.amount),
            amount: resolved.amount.abs().toString(),
            currency: resolved.currency,
            date,
            note,
          });
          return;
        }
        result.errors.push({
          line,
          message: `Neznámý řádek „${note}“ — nahlaš nám ho, doplníme podporu.`,
          raw,
        });
        return;
      }
      case 'UNKNOWN': {
        result.errors.push({
          line,
          message: `Neznámý směr „${smer}“ — nahlaš nám ho, doplníme podporu.`,
          raw,
        });
        return;
      }
    }
  });

  // Dividenda a srážková daň = samostatné řádky téhož symbolu a data → páruj 1:1
  const ambiguityWarned = new Set<string>();
  for (const tax of taxes) {
    const candidates = dividends.filter(
      (div) => div.symbol === tax.symbol && div.date === tax.date && div.currency === tax.currency,
    );
    // 2+ dividend téhož symbolu a dne: srážky přiřazujeme podle pořadí v souboru,
    // což nemusí odpovídat skutečnosti → upozorni (jednou per symbol+den)
    if (candidates.length > 1 && !ambiguityWarned.has(`${tax.symbol}|${tax.date}`)) {
      ambiguityWarned.add(`${tax.symbol}|${tax.date}`);
      result.warnings.push({
        line: tax.line,
        message: `Více dividend ${tax.symbol || 'bez symbolu'} téhož dne (${tax.date}) — přiřazení srážkových daní podle pořadí v souboru, zkontroluj správnost.`,
      });
    }
    const target = candidates.find((div) => div.withholding === undefined);
    if (!target) {
      result.warnings.push({
        line: tax.line,
        message: `Srážková daň ${tax.amount.toString()} ${tax.currency} (${tax.symbol || 'bez symbolu'}, ${tax.date}) nemá párovou dividendu — nezaúčtováno, zkontroluj export za celé období.`,
      });
      continue;
    }
    target.withholding = tax.amount;
  }

  for (const div of dividends) {
    push(div.line, div.raw, {
      type: 'DIVIDEND',
      id: div.id,
      isin: div.isin,
      ticker: div.symbol || undefined,
      gross: div.gross.toString(),
      currency: div.currency,
      withholdingTax: (div.withholding ?? ZERO).toString(),
      sourceCountry: div.sourceCountry,
      date: div.date,
      note: div.note,
    });
  }

  return result;
}
