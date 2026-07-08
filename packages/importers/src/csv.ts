/**
 * Minimální RFC 4180 CSV parser: uvozovky, čárky a nové řádky uvnitř polí,
 * escapované uvozovky (""), CRLF i LF, BOM. Bez externích závislostí.
 */
export interface CsvTable {
  headers: string[];
  rows: string[][];
}

export function parseCsv(text: string): CsvTable {
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
    if (ch === ',') {
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

/** Přístup k buňkám podle názvu sloupce — formáty brokerů mění pořadí i sadu sloupců. */
export class HeaderMap {
  private readonly index = new Map<string, number>();

  constructor(headers: string[]) {
    headers.forEach((header, i) => this.index.set(header, i));
  }

  has(name: string): boolean {
    return this.index.has(name);
  }

  get(row: string[], name: string): string {
    const i = this.index.get(name);
    return i === undefined ? '' : (row[i] ?? '').trim();
  }
}

/** Očistí číselný zápis (mezery, tisícové čárky à la "1,234.56"). */
export function cleanNumber(value: string): string {
  const trimmed = value.replace(/\s/g, '');
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(trimmed)) return trimmed.replace(/,/g, '');
  return trimmed;
}

/**
 * Skutečná kalendářní kontrola ISO data YYYY-MM-DD — regex sám nestačí
 * („2025-13-31" by prošlo). Round-trip přes Date UTC odhalí neexistující dny.
 */
export function isValidIsoDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
