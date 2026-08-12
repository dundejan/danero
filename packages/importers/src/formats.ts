/**
 * Rozpoznání formátu nahraného souboru podle OBSAHU, ne podle přípony.
 *
 * Přípona lže pravidelně: tlačítko v bankovním portálu se jmenuje „XLS“,
 * ale doručí XLSX; prohlížeč připíše `.csv` k něčemu jinému; uživatel soubor
 * přejmenuje. Do 12. 8. 2026 se cesta k XLSX parserům vybírala výhradně podle
 * `/\.xlsx$/i`, takže sešit uložený jako `vypis.xls` propadl do textové větve
 * a skončil hláškou „Formát souboru nepoznáváme“ s binárním smetím v textu.
 *
 * Zároveň tu odchytáváme formáty, které NEUMÍME a uživatel je typicky nahraje
 * omylem (PDF výpis, starý binární XLS, zabalený archiv) — každý si zaslouží
 * vlastní větu s tím, co má stáhnout místo toho.
 */
export type FileFormat = 'xlsx' | 'zip' | 'pdf' | 'xls-legacy' | 'odf';

const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean =>
  bytes.length >= signature.length && signature.every((byte, i) => bytes[i] === byte);

/** `%PDF` */
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46] as const;
/** `PK\x03\x04` — lokální hlavička zipu (XLSX je zip). */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04] as const;
/** OLE2 („Compound File Binary“) — starý .xls, .doc, .msg. */
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;

/** Názvy položek, kterými začíná sešit OOXML (na rozdíl od obyčejného zipu). */
const OOXML_ENTRY_PREFIXES = ['[Content_Types].xml', '_rels/', 'xl/', 'docProps/'];
/** ODF (LibreOffice) začíná položkou `mimetype` — taky zip, ale jiný sešit. */
const ODF_ENTRY = 'mimetype';

/** Jméno první položky zipu z lokální hlavičky (offset 30, délka na offsetu 26). */
function firstZipEntryName(bytes: Uint8Array): string | null {
  if (bytes.length < 30) return null;
  const nameLength = bytes[26]! | (bytes[27]! << 8);
  if (nameLength === 0 || bytes.length < 30 + nameLength) return null;
  return new TextDecoder('utf-8').decode(bytes.subarray(30, 30 + nameLength));
}

/**
 * Formát souboru podle magických bajtů. `null` = není to žádný ze známých
 * binárních formátů, čte se tedy jako text (CSV/XML/HTML).
 */
export function sniffFileFormat(data: ArrayBuffer | Uint8Array): FileFormat | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (startsWith(bytes, PDF_SIGNATURE)) return 'pdf';
  if (startsWith(bytes, OLE2_SIGNATURE)) return 'xls-legacy';
  if (!startsWith(bytes, ZIP_SIGNATURE)) return null;
  const entry = firstZipEntryName(bytes);
  if (entry === null) return 'zip';
  if (OOXML_ENTRY_PREFIXES.some((prefix) => entry.startsWith(prefix))) return 'xlsx';
  // sešit z LibreOffice je taky zip — radit „rozbal archiv“ by bylo k ničemu
  if (entry === ODF_ENTRY) return 'odf';
  return 'zip';
}

/**
 * Hláška pro formát, který číst neumíme — vždy říká, co stáhnout místo toho.
 * `null` pro 'xlsx' (ten umíme) drží typovou kontrolu nad úplností výčtu.
 */
export function unsupportedFormatMessage(format: FileFormat): string | null {
  switch (format) {
    case 'xlsx':
      return null;
    case 'pdf':
      return (
        'Tohle je PDF. Z PDF výpisu čísla nečteme — u své platformy v seznamu níž najdeš, ' +
        'kde stáhnout tabulkový výpis (CSV nebo XLSX). Když platforma jiný než PDF výpis nenabízí, ' +
        'přepiš data do univerzální šablony.'
      );
    case 'xls-legacy':
      return (
        'Tohle je starý excelový formát .xls, který číst neumíme. Otevři soubor v Excelu ' +
        '(nebo v Google Tabulkách) a ulož ho znovu jako .xlsx nebo CSV — pak ho nahraj.'
      );
    case 'odf':
      return (
        'Tohle je sešit z LibreOffice (.ods), který číst neumíme. Otevři ho a ulož znovu ' +
        'jako .xlsx nebo CSV — pak ho nahraj.'
      );
    case 'zip':
      return (
        'Tohle je zabalený archiv (ZIP). Rozbal ho a nahraj samotné výpisy — klidně několik ' +
        'souborů najednou, duplicity odfiltrujeme.'
      );
  }
}

/**
 * Sešit ve starším XML formátu (SpreadsheetML 2003) — vypadá jako XML, takže
 * by jinak spadl do IBKR Flex parseru a uživatel by dostal hlášku o brokerovi,
 * se kterým jeho soubor nemá nic společného. Nabízí ho hlavně MetaTrader 5
 * („Report → XML“) a starší exporty bank.
 */
export function isSpreadsheetMlXml(text: string): boolean {
  const head = text.slice(0, 1024);
  return (
    /progid\s*=\s*"Excel\.Sheet"/i.test(head) ||
    /<(?:\w+:)?Workbook[\s>][^>]*urn:schemas-microsoft-com:office:spreadsheet/i.test(head)
  );
}

/** Netisknutelné znaky z binárního souboru nesmí do hlášky (rozsype terminál i UI). */
export function printableSample(value: string, max: number): string {
  // řídicí znaky a náhradní znak z binárního obsahu → mezera
  // eslint-disable-next-line no-control-regex -- právě je chceme odfiltrovat
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f\ufffd]+/gu, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
