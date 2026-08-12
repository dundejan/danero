import ExcelJS from 'exceljs';
import { Decimal, d, TransactionSchema } from '@danero/shared';
import {
  detectDecimalSeparator,
  isAmbiguousThousandGroup,
  isValidIsoDate,
  normalizeHeader,
} from '../csv';
import { fnv1a64 } from '../dedupe';
import { readSheetRows } from '../xlsx';
import { emptyResult, type ImportResult } from '../types';

export const SAXO_BROKER = 'saxo';

/**
 * Parser Saxo Bank „Transactions“ XLSX exportu (SaxoTraderGO).
 *
 * Jeden list (název lokalizovaný — bere se PRVNÍ list), 13 sloupců, hlavičky
 * lokalizované podle jazyka účtu. Jazyk se detekuje PŘESNOU shodou celého
 * hlavičkového řádku se slovníkem známých jazyků; neznámý jazyk = error
 * s výzvou přepnout export do angličtiny (bezpečnější než hádat sloupce).
 *
 * Důkazy: EN a DA hlavičky doložené z reálných exportů (HIGH); NL a DE řádky
 * jsou ODVOZENÉ (MEDIUM) — pokud se skutečný export liší, spadne do chyby
 * „neznámý jazyk“, nikdy do tichého špatného parsování.
 */

interface SaxoLanguage {
  code: 'en' | 'da' | 'nl' | 'de';
  /** 13 hlaviček doslova; porovnává se po normalizeHeader (trim, lowercase, bez diakritiky). */
  headers: readonly string[];
  /** Zkratky měsíců v datu DD-MMM-YYYY — klíč po normalizeHeader → číslo měsíce. */
  months: Record<string, number>;
}

const SAXO_LANGUAGES: readonly SaxoLanguage[] = [
  {
    code: 'en',
    headers: [
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
      'Amount',
      'Order ID',
      'Conversion Rate',
    ],
    months: { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 },
  },
  {
    code: 'da',
    headers: [
      'Kunde-id',
      'Handelsdato',
      'Valørdato',
      'Type',
      'Instrument',
      'Instrumentets ISIN',
      'Instrumentvaluta',
      'Børsbeskrivelse',
      'Instrumentsymbol',
      'Arrangement',
      'Antal/Beløb',
      'Ordre ID',
      'Omregningssats',
    ],
    months: { jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 },
  },
  {
    // ODVOZENO (MEDIUM): Type obchodu je „Transactie“, datumy malými „16-jan-2025“;
    // přesný tvar hlaviček není doložen — při odchylce spadne do chyby neznámého jazyka.
    code: 'nl',
    headers: [
      'Klant-id',
      'Handelsdatum',
      'Valutadatum',
      'Type',
      'Instrument',
      'Instrument ISIN',
      'Instrumentvaluta',
      'Beursomschrijving',
      'Instrumentsymbool',
      'Gebeurtenis',
      'Bedrag',
      'Order-id',
      'Conversiekoers',
    ],
    months: { jan: 1, feb: 2, mrt: 3, apr: 4, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 },
  },
  {
    // ODVOZENO (MEDIUM) — stejná pojistka jako u NL.
    code: 'de',
    headers: [
      'Kunden-ID',
      'Handelsdatum',
      'Valutadatum',
      'Typ',
      'Instrument',
      'Instrument-ISIN',
      'Instrumentwährung',
      'Börsenbeschreibung',
      'Instrumentsymbol',
      'Ereignis',
      'Betrag',
      'Auftrags-ID',
      'Umrechnungskurs',
    ],
    // „Mär“ po normalizeHeader = „mar“; „Mrz“ je běžná alternativní zkratka
    months: { jan: 1, feb: 2, mar: 3, mrz: 3, apr: 4, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dez: 12 },
  },
];

/** Typy řádků — hodnoty sloupce Type napříč jazyky (po normalizeHeader). */
const TRADE_TYPES = new Set(['trade', 'handel', 'transactie']);
const CORPORATE_TYPES = new Set(['corporate action']);
const CASH_AMOUNT_TYPES = new Set(['cash amount']);
// „ø“ diakritika není (nerozkládá se) — v setu musí zůstat doslova
const CASH_TRANSFER_TYPES = new Set(['cash transfer', 'kontantoverførsel']);

/** Eventy dividend napříč jazyky (EN/DA/DE; NL používá „Dividend“). */
const DIVIDEND_EVENTS = new Set(['dividend', 'udbytte', 'bardividende']);
/** Eventy vkladů/výběrů u Cash Transfer — vědomě mimo import (nejsou zdanitelné). */
const CASH_TRANSFER_SKIP_EVENTS = new Set(['deposit', 'withdrawal', 'indbetaling', 'einlage']);

/** Kusy a cena z Eventu obchodu: „Buy 3 @ 134.85 USD“, „Købt 2,5 @ 615,20 DKK“. */
const TRADE_EVENT_RE = /^(buy|sell|købt|salg|koop|verkoop|kauf|verkauf)\s+([\d.,]+)\s*@\s*([\d.,]+)/i;
const BUY_VERBS = new Set(['buy', 'købt', 'koop', 'kauf']);

/**
 * Jazyk podle NÁZVŮ sloupců, ne podle délky hlavičky.
 *
 * Do 12. 8. 2026 se porovnával celý řádek na přesnou shodu i délku, takže
 * jediný sloupec navíc — stačila prázdná, ale nastylovaná buňka za hlavičkou —
 * shodil celý import s hláškou „hlavičky v jazyce, který zatím neumíme“
 * NAD ANGLICKÝM exportem. Sloupce se stejně mapují podle názvů (`columnOf`),
 * takže stačí, aby všechny názvy daného jazyka v hlavičce byly.
 */
function detectLanguage(headerCells: string[]): SaxoLanguage | null {
  const normalized = new Set(headerCells.map(normalizeHeader).filter((h) => h !== ''));
  return (
    SAXO_LANGUAGES.find((lang) =>
      lang.headers.every((header) => normalized.has(normalizeHeader(header))),
    ) ?? null
  );
}

/**
 * Číslo z XLSX buňky: nativní number dorazí jako „419.22“, stringy tolerujeme
 * i s desetinnou čárkou a tisícovými oddělovači („1.234,56“, „1,234.56“, „1 234,56“).
 * Konzervativně: poslední oddělovač = desetinný; víc výskytů téhož = tisíce.
 */
function parseSaxoNumber(value: string, decimal: ',' | '.' | null = null): Decimal | null {
  let v = value.replace(/[\s\u00a0\u202f]/g, '');
  if (v === '' || v === '-') return null;
  const hasComma = v.includes(',');
  const hasDot = v.includes('.');
  if (hasComma && hasDot) {
    if (v.lastIndexOf(',') > v.lastIndexOf('.')) {
      v = v.replace(/\./g, '').replace(',', '.');
    } else {
      v = v.replace(/,/g, '');
    }
  } else if (hasComma) {
    const parts = v.split(',');
    // trojčíslí („Buy 1,500 @ …“) rozhodne lokalizace celého souboru: bez ní
    // se z 1 500 kusů stalo 1,5 kusu — tiše, jen se zavádějícím varováním
    // o „nesmyslném poplatku“
    const thousands = parts.length > 2 || (isAmbiguousThousandGroup(v) && decimal !== ',');
    v = thousands ? parts.join('') : parts.join('.');
  } else if (hasDot) {
    const parts = v.split('.');
    const thousands = parts.length > 2 || (isAmbiguousThousandGroup(v) && decimal === ',');
    v = thousands ? parts.join('') : v;
  }
  return /^-?\d+(\.\d+)?$/.test(v) ? d(v) : null;
}

/**
 * Datum „DD-MMM-YYYY“ s lokalizovanou zkratkou měsíce (case-insensitive),
 * plus ISO fallback (nativní Date buňky z Excelu). Neexistující den → null.
 */
function toIsoDate(value: string, months: Record<string, number>): string | null {
  const trimmed = value.trim();
  const isoMatch = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (isoMatch) return isValidIsoDate(isoMatch[1]!) ? isoMatch[1]! : null;
  const match = /^(\d{1,2})-([^\s-]+)-(\d{4})$/.exec(trimmed);
  if (!match) return null;
  const month = months[normalizeHeader(match[2]!)];
  if (month === undefined) return null;
  const iso = `${match[3]}-${String(month).padStart(2, '0')}-${match[1]!.padStart(2, '0')}`;
  return isValidIsoDate(iso) ? iso : null;
}

/**
 * Autodetekce Saxo Transactions XLSX: hlavičkový řádek prvního listu nese
 * všechny sloupce některého známého jazyka. Sniffer i parser rozhodují STEJNĚ
 * (touž funkcí `detectLanguage`, podle názvů sloupců, ne podle pozic) —
 * volnější sniffer nad přísnějším parserem znamenal, že soubor prošel detekcí,
 * ale parser ho odmítl hláškou o cizím jazyce.
 */
export function sniffSaxoXlsx(workbook: ExcelJS.Workbook): boolean {
  const sheet = workbook.worksheets[0];
  if (!sheet) return false;
  const rows = readSheetRows(sheet);
  const header = rows[0];
  if (!header) return false;
  return detectLanguage(header.cells) !== null;
}

/**
 * Parser Saxo „Transactions“ XLSX. Obchody čte z Eventu („Buy 3 @ 134.85 USD“),
 * poplatek dopočítává z rozdilu Amount vs. kusy×cena; dividendy z Corporate
 * action (bez srážkové daně — ta v tomto reportu není!); Custody Fee/VAT jako
 * FEE, Interest jako INTEREST; vklady/výběry se vědomě přeskakují.
 * GBX (pence) se normalizuje na GBP s cenou/100.
 */
export async function parseSaxoXlsx(data: ArrayBuffer | Buffer): Promise<ImportResult> {
  const result = emptyResult(SAXO_BROKER);

  const workbook = new ExcelJS.Workbook();
  try {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (error) {
    result.errors.push({
      line: 1,
      message: `Soubor se nepodařilo přečíst jako XLSX: ${error instanceof Error ? error.message : String(error)}`,
    });
    return result;
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    result.errors.push({ line: 1, message: 'Soubor neobsahuje žádný list — nevypadá jako export ze Saxo.' });
    return result;
  }

  const rows = readSheetRows(sheet);
  // úplně prázdný list = prázdné období, ne chyba formátu (konzistentně s T212)
  if (rows.length === 0) return result;

  // lokalizace čísel z celého listu — Saxo míchá nativní čísla (tečka)
  // s textovými buňkami v jazyce účtu („419,22“)
  const decimal = detectDecimalSeparator(rows.flatMap((row) => row.cells));
  const header = rows[0]!;
  const lang = detectLanguage(header.cells);
  if (!lang) {
    result.errors.push({
      line: header.rowNumber,
      message:
        'Export ze Saxo má hlavičky v jazyce, který zatím neumíme — přepni si v SaxoTraderGO jazyk na angličtinu a stáhni export znovu.',
    });
    return result;
  }

  // mapování sloupců podle NÁZVŮ hlaviček detekovaného jazyka (ne podle pozic)
  const normalizedHeaders = header.cells.map(normalizeHeader);
  const columnOf = (canonicalIndex: number): number =>
    normalizedHeaders.indexOf(normalizeHeader(lang.headers[canonicalIndex]!));
  const col = {
    tradeDate: columnOf(1),
    valueDate: columnOf(2),
    type: columnOf(3),
    instrument: columnOf(4),
    isin: columnOf(5),
    currency: columnOf(6),
    symbol: columnOf(8),
    event: columnOf(9),
    amount: columnOf(10),
    conversionRate: columnOf(12),
  };

  // stabilní obsahová ID; identické řádky rozliší pořadový suffix -2, -3…
  const idOccurrences = new Map<string, number>();
  const contentId = (cells: string[]): string => {
    const base = `saxo-${fnv1a64(cells.join('|'))}`;
    const seen = (idOccurrences.get(base) ?? 0) + 1;
    idOccurrences.set(base, seen);
    return seen === 1 ? base : `${base}-${seen}`;
  };

  const push = (line: number, raw: string, candidate: Record<string, unknown>): void => {
    try {
      result.transactions.push(TransactionSchema.parse(candidate));
    } catch (error) {
      result.errors.push({
        line,
        message: `Řádek se nepodařilo zpracovat: ${error instanceof Error ? error.message : String(error)}`,
        raw,
      });
    }
  };

  // výpis Transactions neuvádí srážkovou daň u dividend — upozorňujeme JEDNOU na dávku
  let dividendWarningAdded = false;

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i]!;
    const line = row.rowNumber;
    const raw = row.cells.join(' | ');
    const cellAt = (index: number): string => (index >= 0 ? (row.cells[index] ?? '').trim() : '');

    const typeRaw = cellAt(col.type);
    const type = normalizeHeader(typeRaw);
    const eventRaw = cellAt(col.event);
    const event = normalizeHeader(eventRaw);

    const date = toIsoDate(cellAt(col.tradeDate), lang.months);
    if (!date) {
      result.errors.push({
        line,
        message: `Neplatné datum „${cellAt(col.tradeDate)}“ (očekáván formát DD-MMM-YYYY, např. 02-Jan-2025).`,
        raw,
      });
      continue;
    }

    const amount = parseSaxoNumber(cellAt(col.amount), decimal);

    if (TRADE_TYPES.has(type)) {
      const match = TRADE_EVENT_RE.exec(eventRaw);
      if (!match) {
        result.errors.push({
          line,
          message: `Obchod: z textu „${eventRaw}“ se nepodařilo přečíst směr, počet kusů a cenu (očekáván tvar „Buy 3 @ 134.85“).`,
          raw,
        });
        continue;
      }
      const isBuy = BUY_VERBS.has(normalizeHeader(match[1]!));
      const quantity = parseSaxoNumber(match[2]!, decimal);
      const price = parseSaxoNumber(match[3]!, decimal);
      // nerozhodnutelný zápis bez důkazu ze souboru → řekni to nahlas, stejně
      // jako u Degira, Revolutu a T212 (tichý tisícinásobek je to nejhorší)
      if (decimal === null) {
        for (const [field, raw2, parsed] of [
          ['Počet kusů', match[2]!, quantity],
          ['Cena', match[3]!, price],
        ] as const) {
          if (parsed !== null && isAmbiguousThousandGroup(raw2)) {
            result.warnings.push({
              line,
              message: `${field} „${raw2}“ v textu „${eventRaw}“ jsme přečetli jako ${parsed.toString()}. Tenhle výpis nikde neprozrazuje, jestli tečka a čárka oddělují tisíce, nebo desetinná místa — zkontroluj si ten řádek; kdyby to bylo naopak, lišila by se hodnota tisíckrát.`,
            });
          }
        }
      }
      if (!quantity || quantity.lte(0) || !price || price.lt(0)) {
        result.errors.push({
          line,
          message: `Obchod: neplatný počet kusů nebo cena v textu „${eventRaw}“.`,
          raw,
        });
        continue;
      }
      const isin = cellAt(col.isin);
      if (isin === '') {
        result.errors.push({ line, message: 'Obchod bez ISIN instrumentu — řádek nelze zpracovat.', raw });
        continue;
      }
      const rawCurrency = cellAt(col.currency).toUpperCase();
      // GBX = pence sterling → GBP, ceny i částky /100 (kotace londýnských ETF/akcií)
      const isGbx = rawCurrency === 'GBX';
      const currency = isGbx ? 'GBP' : rawCurrency;
      const toGbp = (v: Decimal): Decimal => (isGbx ? v.div(100) : v);

      // Poplatek = rozdíl mezi peněžním dopadem (Amount) a kusy×cena.
      //
      // B-3-8: nemusí ale jít o tutéž měnu. U vícemenového účtu je Amount
      // v měně ÚČTU, zatímco cena v měně instrumentu — a z rozdílu pak vyjde
      // jako „poplatek" celý kurzový rozdíl: doloženo na `Buy 3 @ 134.85 USD`
      // s Amount −2 903,75 a Conversion Rate 0,13966, kde se zaúčtoval poplatek
      // 2 499,20 USD na obchodu za 404,55 USD (6× hodnota obchodu, žádná chyba).
      // Sloupec Conversion Rate byl přitom v hlavičkách vypsaný a nikdo ho nečetl.
      //
      // Ve které měně Amount je, se z exportu spolehlivě určit nedá (v jednom
      // exportu je v měně instrumentu, v jiném v měně účtu), takže se přijme
      // jen ta varianta, která dává smysl: poplatek nesmí přerůst samotný
      // obchod. Když nedává smysl ani jedna, poplatek nedopočítáváme a řekneme
      // to nahlas — vymyšlený poplatek by tiše snížil zisk.
      let fee: { amount: string; currency: string } | undefined;
      if (amount) {
        const gross = quantity.mul(price);
        const rate = parseSaxoNumber(cellAt(col.conversionRate), decimal);
        const converted = rate && rate.gt(0) && !rate.eq(1) ? amount.mul(rate) : undefined;
        const impliedFee = (value: Decimal): Decimal =>
          isBuy ? value.abs().minus(gross) : gross.minus(value);
        // Přepočtená varianta má PŘEDNOST: vyplněný kurz jiný než 1 je sám
        // o sobě doklad, že Amount je v jiné měně než cena. Poplatek uznáme jen
        // nezáporný a menší než obchod — přepočet špatným směrem vyjde záporný
        // a propadne zpátky na částku, jak přišla.
        const feeAmount = [converted, amount]
          .filter((value): value is Decimal => value !== undefined)
          .map(impliedFee)
          .find((candidate) => candidate.gte(0) && candidate.lte(gross));
        if (feeAmount === undefined) {
          result.warnings.push({
            line,
            message:
              `Obchod ${cellAt(col.symbol) || isin}: z částky ${amount.toString()} a ceny ` +
              `${quantity.toString()} × ${price.toString()} ${currency} vychází nesmyslný poplatek ` +
              '(vyšší než celý obchod) — typicky je částka v jiné měně, než je cena. Poplatek jsme ' +
              'radši nedopočítali, ať ti vymyšlené číslo nesníží zisk; pokud jsi nějaký zaplatil, ' +
              'doplň obchod ručně přes univerzální šablonu.',
          });
        } else if (feeAmount.gt(0)) {
          fee = { amount: toGbp(feeAmount).toString(), currency };
        }
      } else {
        result.warnings.push({
          line,
          message: 'Obchod bez čitelné částky (Amount) — poplatek nešlo dopočítat, zkontroluj ho ručně.',
        });
      }

      const settlementDate = toIsoDate(cellAt(col.valueDate), lang.months);
      push(line, raw, {
        type: isBuy ? 'BUY' : 'SELL',
        id: contentId(row.cells),
        isin,
        ticker: cellAt(col.symbol) || undefined,
        name: cellAt(col.instrument) || undefined,
        quantity: quantity.toString(),
        pricePerShare: toGbp(price).toString(),
        currency,
        fee,
        tradeDate: date,
        settlementDate: settlementDate ?? undefined,
      });
      continue;
    }

    if (CORPORATE_TYPES.has(type)) {
      if (DIVIDEND_EVENTS.has(event)) {
        if (!amount || amount.lte(0)) {
          result.errors.push({
            line,
            message: `Dividenda ${cellAt(col.symbol) || cellAt(col.instrument)}: chybí kladná částka.`,
            raw,
          });
          continue;
        }
        const rawCurrency = cellAt(col.currency).toUpperCase();
        const isGbx = rawCurrency === 'GBX';
        if (!dividendWarningAdded) {
          dividendWarningAdded = true;
          result.warnings.push({
            line,
            message:
              'Saxo výpis Transactions neuvádí sráženou daň — brutto/srážku doplň z reportu Dividends, jinak počítáme bez zápočtu v zahraničí.',
          });
        }
        push(line, raw, {
          type: 'DIVIDEND',
          id: contentId(row.cells),
          isin: cellAt(col.isin) || undefined,
          ticker: cellAt(col.symbol) || undefined,
          gross: (isGbx ? amount.div(100) : amount).toString(),
          currency: isGbx ? 'GBP' : rawCurrency,
          withholdingTax: '0',
          date,
        });
        continue;
      }
      if (event === 'dividend reinvestment') {
        result.warnings.push({
          line,
          message:
            'Reinvestice dividendy — Saxo v tomto výpisu neuvádí kusy ani cenu reinvestice, řádek přeskočen. Dividendu a nákup doplň ručně (univerzální šablona).',
        });
        continue;
      }
      result.warnings.push({
        line,
        message: `Korporátní akci „${eventRaw}“ zatím neumíme zaúčtovat automaticky — řádek přeskočen, zkontroluj a případně doplň ručně.`,
        raw,
      });
      continue;
    }

    if (CASH_AMOUNT_TYPES.has(type)) {
      if (event === 'custody fee' || event === 'vat') {
        if (!amount) {
          result.errors.push({ line, message: `Poplatek „${eventRaw}“: chybí částka.`, raw });
          continue;
        }
        push(line, raw, {
          type: 'FEE',
          id: contentId(row.cells),
          amount: amount.abs().toString(),
          currency: cellAt(col.currency).toUpperCase(),
          date,
          note: eventRaw,
        });
        continue;
      }
      if (event === 'interest') {
        if (!amount) {
          result.errors.push({ line, message: 'Úrok: chybí částka.', raw });
          continue;
        }
        if (amount.lte(0)) {
          result.skipped.push({
            line,
            message: `Záporný úrok ${amount.toString()} ${cellAt(col.currency)} (debetní úrok) — do § 8 nevstupuje, přeskočeno.`,
            raw,
          });
          continue;
        }
        push(line, raw, {
          type: 'INTEREST',
          id: contentId(row.cells),
          amount: amount.toString(),
          currency: cellAt(col.currency).toUpperCase(),
          date,
        });
        continue;
      }
      result.errors.push({
        line,
        message: `Neznámá peněžní operace „${eventRaw}“ (Type „${typeRaw}“) — nahlaš nám ji, doplníme podporu.`,
        raw,
      });
      continue;
    }

    if (CASH_TRANSFER_TYPES.has(type)) {
      if (CASH_TRANSFER_SKIP_EVENTS.has(event)) {
        result.skipped.push({
          line,
          message: `„${eventRaw}“: vklad/výběr hotovosti — pro daňový výpočet není potřeba.`,
        });
        continue;
      }
      result.errors.push({
        line,
        message: `Neznámý převod hotovosti „${eventRaw}“ (Type „${typeRaw}“) — nahlaš nám ho, doplníme podporu.`,
        raw,
      });
      continue;
    }

    result.errors.push({
      line,
      message: `Neznámý typ řádku „${typeRaw}“ (Event „${eventRaw}“) — nahlaš nám ho, doplníme podporu.`,
      raw,
    });
  }

  return result;
}
