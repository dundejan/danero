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
