/** Sdílená Fio e-Broker fixture — středníkové CSV, CZ hlavičky dle docs/03. */
export const FIO_HEADER =
  'Datum obchodu;Směr;Symbol;Cena;Počet;Měna;Objem v CZK;Poplatky v CZK;Objem v USD;Poplatky v USD;Objem v EUR;Poplatky v EUR;Text FIO';

export const FIO_FIXTURE = [
  FIO_HEADER,
  '05.01.2024;Vloženo;;;;CZK;100 000,00;;;;;;Vklad na účet',
  '10.01.2024 14:30;Nákup;AAPL;185,50;100;USD;;;-18 550,00;-2,50;;;Nákup: AAPL 100 ks',
  '05.03.2025;Prodej;AAPL;210,00;40;USD;;;8 400,00;-2,50;;;Prodej: AAPL 40 ks',
  '10.05.2026;;AAPL;;;USD;;;25,00;;;;Dividenda AAPL, USA',
  '10.05.2026;;AAPL;;;USD;;;-3,75;;;;Daň z dividendy AAPL, USA',
  '01.06.2025;Poplatek;;;;CZK;-150,00;;;;;;Poplatek za vedení účtu',
  '30.06.2025;Úrok;;;;CZK;12,34;;;;;;Úrok z hotovosti',
  '01.07.2025;Vybráno;;;;CZK;-20 000,00;;;;;;Výběr z účtu',
  '15.03.2025;;AAPL;;;USD;;;-5,00;;;;ADR Fee',
].join('\n');

/**
 * Jediný nákup (smyšlená čísla) — tentýž text se v testu kódování zapíše jako
 * windows-1250, UTF-8, UTF-8 s BOM a UTF-16 a pokaždé musí dát totéž (L2c-04).
 */
export const FIO_SINGLE_BUY = [
  FIO_HEADER,
  '12.02.2025 10:15;Nákup;AAPL;41,20;15;USD;;;-618,00;-1,95;;;Nákup: AAPL 15 ks',
].join('\n');

/** Mapování symbol → ISIN (Fio ISIN neexportuje, dodává ho uživatel/DB). */
export const FIO_SYMBOL_MAP = { AAPL: { isin: 'US0378331005' } };

/** České znaky ve windows-1250 (jen ty, které fixture potřebuje). */
const CP1250: Record<string, number> = {
  Á: 0xc1, á: 0xe1,
  Č: 0xc8, č: 0xe8,
  Ď: 0xcf, ď: 0xef,
  É: 0xc9, é: 0xe9,
  Ě: 0xcc, ě: 0xec,
  Í: 0xcd, í: 0xed,
  Ň: 0xd2, ň: 0xf2,
  Ó: 0xd3, ó: 0xf3,
  Ř: 0xd8, ř: 0xf8,
  Š: 0x8a, š: 0x9a,
  Ť: 0x8d, ť: 0x9d,
  Ú: 0xda, ú: 0xfa,
  Ů: 0xd9, ů: 0xf9,
  Ý: 0xdd, ý: 0xfd,
  Ž: 0x8e, ž: 0x9e,
};

/** UTF-8 bajty; s `bom` před nimi značka EF BB BF (tak ukládá Excel „CSV UTF-8“). */
export function encodeUtf8(text: string, bom = false): Uint8Array {
  const body = new TextEncoder().encode(text);
  return bom ? Uint8Array.from([0xef, 0xbb, 0xbf, ...body]) : body;
}

/** UTF-16 bajty se značkou pořadí bajtů (FF FE = little endian, FE FF = big endian). */
export function encodeUtf16(text: string, endianness: 'le' | 'be'): Uint8Array {
  const bytes: number[] = endianness === 'le' ? [0xff, 0xfe] : [0xfe, 0xff];
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    const high = unit >> 8;
    const low = unit & 0xff;
    bytes.push(...(endianness === 'le' ? [low, high] : [high, low]));
  }
  return Uint8Array.from(bytes);
}

/** Zakóduje string do windows-1250 bajtů — simulace reálného Fio exportu. */
export function encodeCp1250(text: string): Uint8Array {
  return Uint8Array.from([...text], (ch) => {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) return code;
    const mapped = CP1250[ch];
    if (mapped === undefined) throw new Error(`Znak mimo testovací CP1250 mapu: ${ch}`);
    return mapped;
  });
}
