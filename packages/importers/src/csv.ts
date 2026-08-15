/**
 * Minimální RFC 4180 CSV parser: uvozovky, čárky a nové řádky uvnitř polí,
 * escapované uvozovky (""), CRLF i LF, BOM. Bez externích závislostí.
 */
export interface CsvTable {
  headers: string[];
  rows: string[][];
}

export function parseCsv(text: string, delimiter: ',' | ';' | '\t' = ','): CsvTable {
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
    if (ch === delimiter) {
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

/**
 * První řádek textu (hlavička) — bez kopírování celého souboru.
 *
 * Bere v úvahu i samotné `\r`: starší Excel pro Mac tak ukládá CSV celé a bez
 * téhle větve by „hlavička“ byla CELÝ soubor. To není teorie — hlavička se
 * vypisuje do hlášky „v hlavičce jsme našli…“ i do upozornění provozovateli,
 * takže by se do nich obtiskla data uživatele; a sniffery hledající slovo
 * v hlavičce by ho našly kdekoli v souboru.
 */
export function firstLine(text: string): string {
  const end = text.search(/[\r\n]/);
  return end === -1 ? text : text.slice(0, end);
}

/**
 * Oddělovač podle hlavičkového řádku.
 *
 * Český Excel ukládá „CSV“ se STŘEDNÍKEM (řídí se desetinnou čárkou v locale),
 * takže uživatel, který si stáhne univerzální šablonu, vyplní ji a uloží,
 * dostane soubor, který by čárkový parser přečetl jako JEDINÝ sloupec — a
 * import by ho odmítl s hláškou, že chybí sloupec „type“, přestože ho tam má.
 * Počítá se mimo uvozovky; při shodě vyhrává čárka (formát šablony).
 */
export function sniffDelimiter(header: string): ',' | ';' | '\t' {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of header) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === ',' || ch === ';' || ch === '\t')) counts[ch] += 1;
  }
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t';
  return ',';
}

/** Přístup k buňkám podle názvu sloupce — formáty brokerů mění pořadí i sadu sloupců. */
export class HeaderMap {
  private readonly index = new Map<string, number>();

  constructor(headers: string[]) {
    headers.forEach((header, i) => this.index.set(header, i));
  }

  has(name: string): boolean {
    return this.index.has(name);
  }

  /** Je přítomen ALESPOŇ JEDEN z alternativních názvů téhož sloupce? */
  hasAny(names: readonly string[]): boolean {
    return names.some((name) => this.index.has(name));
  }

  get(row: string[], name: string): string {
    const i = this.index.get(name);
    return i === undefined ? '' : (row[i] ?? '').trim();
  }

  /**
   * Buňka podle PRVNÍHO nalezeného z alternativních názvů sloupce. Brokeři
   * sloupce přejmenovávají za pochodu (T212: „Time“ → „Time (UTC)“), takže
   * jediný pevný název je časovaná bomba — viz `TRADING212_TIME_COLUMNS`.
   */
  getAny(row: string[], names: readonly string[]): string {
    const name = names.find((candidate) => this.index.has(candidate));
    return name === undefined ? '' : this.get(row, name);
  }
}

/**
 * Fiat měny pro klasifikaci krypto↔fiat vs. krypto↔krypto (sdílené krypto
 * parsery — Kraken, Anycoin…). Měna mimo seznam se bere jako krypto, takže
 * chybějící fiat kód znamená ZAHOZENÝ obchod s warningem — seznam drž široký.
 */
export const FIAT_CURRENCIES = new Set([
  'CZK', 'EUR', 'USD', 'GBP', 'CHF', 'PLN', 'HUF',
  'JPY', 'CAD', 'AUD', 'NOK', 'SEK', 'DKK', 'RON', 'BGN', 'TRY', 'NZD', 'SGD', 'HKD',
]);

/** Dekódování windows-1250 — kódování českých exportů (Fio, Coinmate, banky). */
export const decodeCp1250 = (data: ArrayBuffer | Uint8Array): string =>
  new TextDecoder('windows-1250').decode(data);

/** Odstraní diakritiku (porovnávání CZ/DE hlaviček nezávisle na kódování). */
export const stripDiacritics = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Kanonický tvar hlavičky pro synonyma: trim, lowercase, bez diakritiky. */
export const normalizeHeader = (value: string): string =>
  stripDiacritics(value.trim().toLowerCase());

/** Očistí číselný zápis (mezery, tisícové čárky à la "1,234.56"). */
export function cleanNumber(value: string): string {
  const trimmed = value.replace(/\s/g, '');
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(trimmed)) return trimmed.replace(/,/g, '');
  return trimmed;
}

/**
 * Je zápis nerozhodnutelný mezi tisícovou a desetinnou čárkou? (B-3-12)
 *
 * „7,848“ může být 7848 (US tisíce) i 7,848 (evropská desetinná čárka) a
 * `cleanNumber` z něj vždycky udělá 7848. U počtu kusů je to **tisícinásobná**
 * chyba, a protože Trading 212 prodává zlomky akcií, je desetinný výklad
 * u „No. of shares“ dokonce pravděpodobnější. Rozhodnout to z jednoho pole
 * nejde — chování proto neměníme (jinak by se rozbily exporty, kde tisícová
 * čárka opravdu je), ale volající o tom může uživatele zpravit.
 *
 * Nejednoznačné je jen JEDNO trojčíslí bez desetinné tečky: „1,234,567“ ani
 * „1,234.56“ jinak než jako tisíce číst nejdou.
 */
export function isAmbiguousThousands(value: string): boolean {
  return /^-?\d{1,3},\d{3}$/.test(value.replace(/\s/g, ''));
}

/**
 * Zápis `1.000` / `1,234` — jedna skupina přesně tří číslic, tedy neodlišitelně
 * tisíce nebo tři desetinná místa. Sám o sobě nerozhodnutelný; rozhodne až
 * `detectDecimalSeparator` nad celým souborem.
 */
export function isAmbiguousThousandGroup(value: string): boolean {
  return /^-?\d{1,3}[.,]\d{3}$/.test(value.replace(/[\s\u00a0\u202f]/g, ''));
}

/**
 * Desetinný oddělovač CELÉHO souboru z jeho vlastních čísel (B-3-12).
 *
 * Broker píše čísla podle lokalizace, kterou nikde neuvádí: `1.000` je
 * v holandském exportu Degira tisíc kusů, v anglickém jedna celá nula.
 * Z jedné buňky to rozhodnout nejde, ze souboru ano — stačí jediné číslo,
 * které jednoznačné je (`26,45` = desetinná čárka, `185.50` = desetinná tečka,
 * `1.234,56` i `1,234.56` = obojí zároveň). Hlasování přes celý soubor je
 * odolné i vůči jednomu divnému políčku.
 *
 * `null` = soubor neobsahuje jediné rozhodující číslo → volající musí
 * nejednoznačné hodnoty ohlásit uživateli, ne tiše hádat.
 */
export function detectDecimalSeparator(values: Iterable<string>): ',' | '.' | null {
  let comma = 0;
  let dot = 0;
  for (const raw of values) {
    const value = raw.replace(/[\s\u00a0\u202f]/g, '');
    if (!/^-?[\d.,]+$/.test(value) || value === '') continue;
    const lastComma = value.lastIndexOf(',');
    const lastDot = value.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      // oba oddělovače naráz: ten poslední je desetinný
      if (lastComma > lastDot) comma += 1;
      else dot += 1;
      continue;
    }
    // jediný oddělovač: rozhoduje počet číslic za ním (tři = nerozhodnutelné)
    const single = /^-?\d+([.,])(\d+)$/.exec(value);
    if (!single) continue;
    if (single[2]!.length === 3) continue;
    if (single[1] === ',') comma += 1;
    else dot += 1;
  }
  if (comma === dot) return null;
  return comma > dot ? ',' : '.';
}

/**
 * Evropský číselný zápis → kanonický: „1 234,56“ i „1.234,56“ → „1234.56“.
 * Použij tam, kde formát PROKAZATELNĚ píše desetinnou čárku — na US zápis
 * s tisícovými čárkami patří cleanNumber.
 */
export function cleanNumberEu(value: string): string {
  let trimmed = value.replace(/[\s\u00a0\u202f]/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(trimmed)) trimmed = trimmed.replace(/\./g, '');
  return trimmed.replace(',', '.');
}

/**
 * Datum evropských výpisů → ISO YYYY-MM-DD: „31.12.2025“, „31. 12. 2025“,
 * „31/12/2025“ i ISO — případný čas za datem se zahodí. POZOR: lomítkový tvar
 * čte den/měsíc/rok (EU) — na US formáty (mm/dd/yyyy, Schwab) nepatří.
 * Neexistující dny vrací null — řádek se odmítne s chybou, ne tichým posunem.
 */
export function parseEuroDate(value: string): string | null {
  const trimmed = value.trim();
  let iso: string | null = null;
  const eu = trimmed.match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})(?![\d.])/);
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?!\d)/);
  const m = eu ?? slash;
  if (m) {
    iso = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  } else {
    const isoM = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?!\d)/);
    if (isoM) iso = isoM[1]!;
  }
  return iso !== null && isValidIsoDate(iso) ? iso : null;
}

/**
 * US datum MM/DD/YYYY → ISO (měsíc/den! — NIKDY nepoužívat parseEuroDate,
 * ta čte lomítkový tvar jako den/měsíc). Tvar „07/15/2024 as of 07/12/2024“
 * (Schwab) znamená „zaúčtováno později, efektivně platí druhý den“ — bere se
 * DRUHÉ datum (skutečný obchodní den). Neexistující kalendářní den → null.
 */
export function parseUsDate(value: string): string | null {
  const trimmed = value.trim();
  const asOf = /as of\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(trimmed);
  const match = asOf ?? /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?!\d)/.exec(trimmed);
  if (!match) return null;
  const iso = `${match[3]}-${match[1]!.padStart(2, '0')}-${match[2]!.padStart(2, '0')}`;
  return isValidIsoDate(iso) ? iso : null;
}

/**
 * Skutečná kalendářní kontrola ISO data YYYY-MM-DD — regex sám nestačí
 * („2025-13-31“ by prošlo). Round-trip přes Date UTC odhalí neexistující dny.
 */
export function isValidIsoDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
