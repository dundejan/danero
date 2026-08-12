import { detectDecimalSeparator, isAmbiguousThousandGroup } from '../csv';
import { fnv1a64, uniqueIdFactory } from '../dedupe';

export const REVOLUT_BROKER = 'revolut';

/** Buňka očištěná na číslo — částky Revolutu nesou symbol měny („$52.07“). */
const digitsOf = (value: string): string => value.replace(/[^0-9.,-]/g, '');

/** Desetinný oddělovač celého výpisu (částky se čistí od symbolů měn). */
export const detectRevolutDecimal = (rows: string[][]): ',' | '.' | null =>
  detectDecimalSeparator(rows.flat().map(digitsOf));

/**
 * Věta k nerozhodnutelnému zápisu (jedna čárka a přesně tři číslice za ní),
 * když soubor lokalizaci nijak neprozradil. `null` = hodnota je jednoznačná.
 */
export function revolutAmbiguityNote(field: string, raw: string, used: string): string | null {
  if (!isAmbiguousThousandGroup(digitsOf(raw))) return null;
  return (
    `${field} „${raw.trim()}“ jsme přečetli jako ${used}. Tenhle výpis nikde neprozrazuje, jestli čárka ` +
    'odděluje tisíce, nebo desetinná místa — zkontroluj si ten řádek ve výpisu; kdyby to bylo naopak, ' +
    'lišila by se hodnota tisíckrát.'
  );
}

/** Symboly měn ve výpisech Revolutu → ISO kód. */
const CURRENCY_SYMBOLS: [symbol: string, code: string][] = [
  ['€', 'EUR'],
  ['$', 'USD'],
  ['£', 'GBP'],
];

export interface RevolutMoney {
  /** Normalizovaná částka s desetinnou tečkou (zachovává znaménko). */
  amount: string;
  /** ISO kód měny z hodnoty (symbol € $ £ nebo kód „SEK“), null pokud hodnota měnu neuvádí. */
  currency: string | null;
}

/**
 * Peněžní hodnota Revolutu: symbol nebo kód měny UVNITŘ hodnoty („$52.07“,
 * „€88.94“, „-$0.01“, „USD 529.68“, „137,211.36 SEK“), tisícové čárky
 * („5,837.33“) a ojediněle desetinná ČÁRKA („0,76672417“).
 * Vrací null, pokud hodnota není číslo.
 *
 * `decimal` je desetinný oddělovač CELÉHO souboru (`detectDecimalSeparator`).
 * Rozhoduje jediný nerozhodnutelný případ — jedna čárka a přesně tři číslice
 * za ní: `0,125` je v evropsky lokalizovaném výpisu 0,125 kusu, v anglickém
 * 125 kusů. Do 12. 8. 2026 vyhrávaly vždycky tisíce, takže množství 0,125 BTC
 * se uložilo jako 125 BTC — bez chyby i bez varování.
 */
export function parseRevolutMoney(
  value: string,
  decimal: ',' | '.' | null = null,
): RevolutMoney | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;

  let currency: string | null = null;
  for (const [symbol, code] of CURRENCY_SYMBOLS) {
    if (trimmed.includes(symbol)) {
      currency = code;
      break;
    }
  }
  if (currency === null) {
    const code = /(?:^|\s)([A-Z]{3})(?:\s|$)/.exec(trimmed);
    if (code) currency = code[1]!;
  }

  const negative = trimmed.includes('-');
  let digits = trimmed.replace(/[^0-9.,]/g, '');
  const hasComma = digits.includes(',');
  const hasDot = digits.includes('.');
  if (hasComma && hasDot) {
    // oba oddělovače: poslední je desetinný, ostatní tisícové („5,837.33“)
    if (digits.lastIndexOf('.') > digits.lastIndexOf(',')) {
      digits = digits.replace(/,/g, '');
    } else {
      digits = digits.replace(/\./g, '').replace(',', '.');
    }
  } else if (hasComma) {
    const parts = digits.split(',');
    // jediná čárka + skupina jiná než 3 číslice = desetinná čárka („0,76672417“);
    // u trojčíslí rozhoduje lokalizace souboru, výchozí je americký zápis
    const decimalComma =
      parts.length === 2 && (parts[1]!.length !== 3 || decimal === ',');
    digits = decimalComma ? parts.join('.') : parts.join('');
  }
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;

  return { amount: negative ? `-${digits}` : digits, currency };
}

/**
 * Stabilní id `rev-<fnv1a64 celého řádku>`; identické legitimní řádky
 * (dva stejné obchody v týž okamžik) rozliší pořadový suffix -2, -3…
 * — v rámci stejné množiny záznamů zůstává stabilní mezi opakovanými importy.
 */
export function revolutIdFactory(): (row: string[]) => string {
  const unique = uniqueIdFactory();
  return (row: string[]): string => unique(`rev-${fnv1a64(row.join('|'))}`);
}

export const isIsoCurrency = (value: string): boolean => /^[A-Z]{3}$/.test(value);
