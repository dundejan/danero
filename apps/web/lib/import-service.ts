import {
  brokerIdKey,
  dedupeTransactions,
  decodeCp1250,
  decodeFioCsv,
  emptyResult,
  firstLine,
  isDegiroCsv,
  parseCsv,
  sniffFioCsv,
  sniffDelimiter,
  loadXlsxWorkbook,
  parseAnycoinCsv,
  parseCoinbaseCsv,
  parseCoinmateCsv,
  parseDegiroAccountCsv,
  parseDegiroTransactionsCsv,
  parseEtoroXlsx,
  parseFioCsv,
  parseIbkrFlexXml,
  parseKrakenCsv,
  parseMt4Html,
  parseMt5Html,
  parseMt5Xlsx,
  parsePortuCsv,
  parseRevolutCryptoCsv,
  parseRevolutXlsx,
  parseRevolutInvestCsv,
  parseSaxoXlsx,
  parseSchwabCsv,
  parseSwissquoteCsv,
  parseTastytradeCsv,
  isSpreadsheetMlXml,
  isTruncatedTrading212Export,
  parseTrading212Csv,
  printableSample,
  sniffFileFormat,
  sniffTrading212Csv,
  TRADING212_BROKER,
  unsupportedFormatMessage,
  XlsxTooLargeError,
  XlsxUnreadableError,
  UNIVERSAL_TEMPLATE_CSV,
  parseUniversalCsv,
  parseXtbXlsx,
  sniffAnycoinCsv,
  sniffCoinbaseCsv,
  sniffCoinmateCsv,
  sniffEtoroXlsx,
  sniffKrakenCsv,
  sniffMt4Html,
  sniffMt5Html,
  sniffMt5Xlsx,
  sniffPortuCsv,
  sniffRevolutCryptoCsv,
  sniffRevolutInvestCsv,
  sniffRevolutXlsx,
  sniffSaxoXlsx,
  sniffSchwabCsv,
  sniffSwissquoteCsv,
  sniffTastytradeCsv,
  sniffXtbXlsx,
  type ImportResult,
  type RowIssue,
} from '@danero/importers';
import type { Transaction } from '@danero/shared';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { importBatches, transactions } from '@/db/schema';
import { plural } from '@/lib/format';
import { loadAliases, type AliasMaps } from '@/lib/instrument-aliases';
import { isDatabaseError } from '@/lib/db-errors';
import { errorText, logEvent } from '@/lib/log';

/** Symbol, kterému chybí ISIN/měna (XTB, Fio) — UI nabídne doplnění číselníku. */
export interface UnmappedSymbol {
  broker: string;
  symbol: string;
  needsCurrency: boolean;
}

export interface ImportSummary {
  batchId: string;
  broker: string;
  filename: string;
  added: number;
  duplicates: number;
  errors: RowIssue[];
  skipped: RowIssue[];
  warnings: RowIssue[];
  unmapped: UnmappedSymbol[];
  /** Věty o transakcích shodných s jiným brokerem (B-3-3) — hlásíme, neslučujeme. */
  crossBroker: string[];
  /**
   * Soubor jsme nepřečetli a chyba může být na NAŠÍ straně (nepoznaný formát,
   * přejmenovaný sloupec). Originál si proto necháme k rozboru
   * (`lib/failed-imports.ts`).
   */
  unrecognized?: boolean;
}

/** Výsledek parsování + případné nenamapované symboly (brokeři bez ISIN). */
interface ParsedFile {
  outcome: ImportResult;
  unmapped: UnmappedSymbol[];
  /**
   * Tříhodnotové schválně:
   * - `true` — formát jsme nepoznali, soubor si necháme,
   * - `false` — vada je prokazatelně jinde (prázdný soubor, PDF, useknutý
   *   přenos) a hláška je návodná, schovávat není co,
   * - `undefined` — rozhodne se z výsledku v `importParsed`: parser, který
   *   nevydal jedinou transakci a jen chyby, je podezřelý sám o sobě.
   */
  unrecognized?: boolean;
}

const noUnmapped = (outcome: ImportResult): ParsedFile => ({ outcome, unmapped: [] });

/**
 * Formát jsme nepoznali a **mohla to být naše chyba** — soubor si necháme.
 *
 * Vědomě se tak neoznačuje selhání, kde je vada prokazatelně jinde a hláška
 * je návodná: prázdný soubor, PDF/ZIP/.xls, useknutý přenos, sešit
 * SpreadsheetML. Ty dostanou `NOT_OURS` — schovávat je znamená jen sbírat cizí
 * smetí a topit v něm případy, kde se dá formát opravdu doplnit.
 */
const unrecognizedFile = (message: string): ParsedFile => ({
  outcome: unknownFormat(message),
  unmapped: [],
  unrecognized: true,
});

/** `extras` pro `importParsed` u selhání, za které nemůžeme (viz `ParsedFile`). */
const NOT_OURS = { unrecognized: false } as const;

/**
 * Prázdný nahraný soubor — včetně toho, co nese jen BOM, mezery nebo jediný
 * nový řádek. Kontrola na nulovou délku nestačí: neúspěšné stahování často
 * uloží pár bajtů, ty propadnou do textové větve a univerzální šablona je
 * vyhodnotí jako „prázdné období“, tedy 0 transakcí a 0 chyb.
 *
 * Strop 64 B je schválně: větší soubor už nějaký obsah má a dekódovat ho tady
 * podruhé je zbytečné.
 */
function isBlankUpload(data: ArrayBuffer): boolean {
  if (data.byteLength === 0) return true;
  if (data.byteLength > 64) return false;
  return new TextDecoder().decode(data).replace(/\uFEFF/g, '').trim() === '';
}

/** Nepoznaný (nebo nepodporovaný) soubor → dávka s jedinou srozumitelnou chybou. */
function unknownFormat(message: string): ImportResult {
  const outcome = emptyResult('neznámý formát');
  outcome.errors.push({ line: 1, message });
  return outcome;
}

const withUnmapped = (
  broker: string,
  outcome: ImportResult & { unmappedSymbols: string[] },
): ParsedFile => ({
  outcome,
  unmapped: outcome.unmappedSymbols.map((symbol) => ({ broker, symbol, needsCurrency: false })),
});

/**
 * Autodetekce TEXTOVÝCH formátů (CSV/XML/HTML) — řetěz snifferů v ZÁVAZNÉM
 * pořadí od specifických k obecným (univerzální šablona je poslední záchrana);
 * pořadí hlídá routingový test v test/import-detect.test.ts. XLSX řeší
 * `importFile` (jedno načtení workbooku pro všechny sniffy).
 */
function detectAndParseText(text: string, aliases?: AliasMaps): ParsedFile {
  // HTML reporty MetaTraderu dřív než obecný XML test — taky začínají „<“
  if (sniffMt4Html(text)) return noUnmapped(parseMt4Html(text));
  if (sniffMt5Html(text)) return noUnmapped(parseMt5Html(text));
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<')) {
    // HTML, které není MT report, nesmí spadnout do XML parseru — matoucí
    // chyba by se v historii připsala brokeru ibkr. Fragment bez atributů
    // (`<tr>`, `<div>`, `<table>`) je pořád HTML — hranice slova odliší značku
    // od XML elementu (`<Trade …>`, `<TransferOut …>`).
    if (
      /^<(?:!doctype\s+html|\/?(?:html|head|body|table|thead|tbody|tfoot|tr|td|th|caption|col|colgroup|div|span|p|pre|br|hr|img|a|b|i|u|em|strong|small|font|center|ul|ol|li|dl|dt|dd|h[1-6]|meta|title|link|style|script|form|section|article|main|header|footer|nav|blockquote)\b)/i.test(
        trimmed,
      )
    ) {
      return unrecognizedFile(
        'HTML soubor nepoznáváme — podporujeme reporty MetaTrader 4 („Save as Report“) a MetaTrader 5. Zkontroluj návod u své platformy v seznamu na stránce.',
      );
    }
    // Sešit SpreadsheetML je taky XML — bez téhle odbočky by uživatel dostal
    // hlášku IBKR parseru o brokerovi, se kterým jeho soubor nemá nic společného.
    if (isSpreadsheetMlXml(text)) {
      return {
        outcome: unknownFormat(
          'Tohle je excelový sešit uložený jako XML (starší formát „XML tabulka 2003“), který číst neumíme. ' +
            'V MetaTraderu ulož report jako XLSX („Open XML“) nebo HTML; z jiné platformy ho otevři v Excelu ' +
            'a ulož znovu jako .xlsx nebo CSV.',
        ),
        unmapped: [],
        unrecognized: false,
      };
    }
    return noUnmapped(parseIbkrFlexXml(text));
  }

  // hlavičku posuzuje sniffer v parseru (jedna definice pro detekci i parsování)
  if (sniffTrading212Csv(text)) {
    // Useknutý přenos poznáme z obsahu (B-3-1) — do 9. 8. 2026 se na to koukal
    // jen API sync, takže ručně nahraný nedostažený soubor se naimportoval
    // z části a tvářil se jako celý.
    if (isTruncatedTrading212Export(text)) {
      const useknuty = emptyResult(TRADING212_BROKER);
      // vada je v přenosu, ne v našem parseru — soubor si neschováváme
      useknuty.errors.push({
        line: 1,
        message:
          'Soubor vypadá poškozený — končí rozepsaným řádkem nebo v něm zůstala neuzavřená ' +
          'uvozovka (typicky nedokončené stahování). Stáhni export z Trading212 znovu a nahraj ' +
          'ho celý; kdybychom ho vzali takhle, chyběla by ti část obchodů a limity by vyšly ' +
          'nižší, než jsou.',
      });
      return { outcome: useknuty, unmapped: [], unrecognized: false };
    }
    return noUnmapped(parseTrading212Csv(text));
  }
  const degiroKind = isDegiroCsv(text);
  if (degiroKind === 'transactions') return noUnmapped(parseDegiroTransactionsCsv(text));
  if (degiroKind === 'account') return noUnmapped(parseDegiroAccountCsv(text));
  if (sniffPortuCsv(text)) return noUnmapped(parsePortuCsv(text));
  if (sniffCoinmateCsv(text)) return noUnmapped(parseCoinmateCsv(text));
  if (sniffSwissquoteCsv(text)) return noUnmapped(parseSwissquoteCsv(text));
  if (sniffKrakenCsv(text)) return noUnmapped(parseKrakenCsv(text));
  if (sniffCoinbaseCsv(text)) return noUnmapped(parseCoinbaseCsv(text));
  if (sniffAnycoinCsv(text)) return noUnmapped(parseAnycoinCsv(text));
  if (sniffRevolutInvestCsv(text)) {
    return withUnmapped('revolut', parseRevolutInvestCsv(text, aliases?.isinOnly.revolut));
  }
  if (sniffRevolutCryptoCsv(text)) return noUnmapped(parseRevolutCryptoCsv(text));
  if (sniffSchwabCsv(text)) {
    return withUnmapped('schwab', parseSchwabCsv(text, aliases?.isinOnly.schwab));
  }
  if (sniffTastytradeCsv(text)) {
    return withUnmapped('tastytrade', parseTastytradeCsv(text, aliases?.isinOnly.tastytrade));
  }
  return universalOrUnknown(text);
}

/** Kolik nalezených sloupců vypsat do hlášky, ať zůstane čitelná. */
const MAX_LISTED_COLUMNS = 12;

/** Slovník sloupců univerzální šablony — odvozený z ní samotné. */
const TEMPLATE_COLUMNS = new Set(
  UNIVERSAL_TEMPLATE_CSV.split('\n')[0]!.split(',').map((column) => column.trim().toLowerCase()),
);

/**
 * Sloupce, které má JEN univerzální šablona — snake_case hlavičku nepoužívá
 * žádný podporovaný export brokera. Odvozeno ze šablony, takže nový sloupec
 * se do seznamu přidá sám (K7b-01).
 */
const TEMPLATE_MARKERS = [...TEMPLATE_COLUMNS].filter((column) => column.includes('_'));

/**
 * Vypadá hlavička jako NAŠE šablona?
 *
 * Dvě cesty, protože šablonu lidé používají dvěma způsoby:
 *  1. **Celá hlavička je z našeho slovníku** — tak vypadá ručně sestavená
 *     šablona jen s potřebnými sloupci (`type,date,isin,quantity,price,currency`).
 *  2. **Je v ní aspoň jeden snake_case sloupec šablony** — tak vypadá stažená
 *     šablona, do které si uživatel přidal vlastní sloupec navíc.
 */
function looksLikeTemplate(columns: string[]): boolean {
  const lower = columns.map((column) => column.trim().toLowerCase()).filter(Boolean);
  if (!lower.includes('type')) return false;
  if (lower.every((column) => TEMPLATE_COLUMNS.has(column))) return true;
  return TEMPLATE_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Poslední krok autodetekce: univerzální šablona, nebo poctivé „nepoznáváme“.
 *
 * Šablona bývala fallback pro VŠECHNO, co neprošlo sniffery, takže každý
 * nepoznaný soubor skončil u její hlášky „Chybí povinný sloupec type“ — a ta
 * je pro uživatele s exportem od známého brokera nesmysl: žádný „type“ v něm
 * není a mít nemá. Přesně tak se 9. 8. 2026 projevil přejmenovaný sloupec
 * v T212 exportu: skutečná příčina (hlavičku nepoznáváme) byla z hlášky
 * neuhodnutelná. Teď se vypíšou nalezené sloupce, takže je vidět, co dorazilo.
 */
function universalOrUnknown(text: string): ParsedFile {
  // Šablona je NAŠE formát a její hlášky jsou přesné („Chybí povinný sloupec
  // date“, „Neznámý typ …“), takže špatně vyplněná šablona není vada na naší
  // straně — schovávat ji a slibovat „pracujeme na tom“ by byla lež a zabralo
  // by to místo skutečnému nečitelnému výpisu (strop pěti případů).
  if (text.trim() === '') {
    return { outcome: parseUniversalCsv(text), unmapped: [], unrecognized: false };
  }

  const header = firstLine(text);
  const columns = parseCsv(header, sniffDelimiter(header)).headers;
  // Poznávacím znamením je `type` a k tomu důkaz, že hlavička je NAŠE
  // (`looksLikeTemplate`) — K7b-01.
  //
  // ⚠️ Samotný `type` nestačí: sloupec doslova toho jména má sedm cizích
  // formátů (Anycoin, Coinmate, Kraken, Revolut Invest, obě generace Revolut
  // Crypto, Schwab, Tastytrade). Když se u kteréhokoli z nich minul sniffer,
  // prohlásili jsme cizí výpis za NAŠI šablonu — uživatel četl „Chybí povinný
  // sloupec date“ o sloupci, který jeho broker nikdy nemá, a `unrecognized:
  // false` navíc přebilo záchrannou síť, takže se originál neuložil a
  // provozovateli nepřišlo upozornění. Přesně kvůli téhle třídě se ta síť
  // stavěla.
  //
  // ⚠️ A dvojice `type` + `date` taky nestačí, i když ji nález navrhoval:
  // změřeno na fixturách, že `date` má vedle `type` i Revolut (obě rodiny),
  // Schwab Bank a Tastytrade. Rozhoduje proto celý slovník hlavičky, ne
  // jednotlivý sloupec — detail v `looksLikeTemplate`.
  if (looksLikeTemplate(columns)) {
    return { outcome: parseUniversalCsv(text), unmapped: [], unrecognized: false };
  }

  // binární smetí (přejmenovaný .xls, obrázek) se do hlášky nesmí obtisknout
  // syrové — řídicí znaky rozsypou UI i mail, ze kterého to řešíme
  const listed = printableSample(columns.slice(0, MAX_LISTED_COLUMNS).join(', '), 200);
  return unrecognizedFile(
    `Formát souboru nepoznáváme${
      listed ? ` — v hlavičce jsme našli: ${listed}${columns.length > MAX_LISTED_COLUMNS ? ' …' : ''}` : ''
    }. Zkontroluj v seznamu platforem níž, který export od své platformy stáhnout. ` +
      'Pokud ji nečteme automaticky, přepiš data do univerzální šablony.',
  );
}

/**
 * Autodetekce nad textem staženým z API brokera — vrací i příznak „nepoznali
 * jsme to“. U ručního nahrání ho řeší `importFileIsolated`, jenže sync jde
 * jinudy: přejmenovaný sloupec u brokera by u napojených účtů zůstal němý.
 */
export function detectAndParseExport(text: string): {
  outcome: ImportResult;
  unrecognized: boolean | undefined;
} {
  const parsed = detectAndParseText(text);
  return { outcome: parsed.outcome, unrecognized: parsed.unrecognized };
}

/** Prostý výsledek autodetekce (text bez číselníku aliasů). */
export function detectAndParse(text: string): ImportResult {
  return detectAndParseText(text).outcome;
}

const txDate = (tx: Transaction): string =>
  tx.type === 'BUY' || tx.type === 'SELL' ? tx.tradeDate : tx.date;

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/**
 * Import CSV: parse → dedupe proti existujícím klíčům uživatele → uložení.
 * Idempotentní — opakované nahrání téhož (či překrývajícího se) souboru nic nezdvojí.
 */
export async function importCsvText(
  db: Db,
  userId: string,
  filename: string,
  text: string,
): Promise<ImportSummary> {
  return importParsed(db, userId, filename, detectAndParse(text));
}

/**
 * Import nahraného souboru s autodetekcí formátu: XLSX podle obsahu listů
 * (XTB / eToro / Saxo / MT5 — jedno načtení workbooku pro všechny sniffy),
 * Fio podle CZ hlavičky (windows-1250!), jinak textová cesta
 * (`detectAndParseText`). Brokeři bez ISIN v exportu dostávají uživatelský
 * číselník; nenamapované symboly se vrací v `unmapped`, ať UI nabídne doplnění.
 */
export async function importFile(
  db: Db,
  userId: string,
  filename: string,
  data: ArrayBuffer,
): Promise<ImportSummary> {
  // Prázdný NAHRANÝ soubor je vždycky vada stahování — na rozdíl od prázdného
  // těla z API T212, které legitimně znamená rok bez obchodů (a tudy nechodí).
  // Dřív ho odchytila kontrola XLSX; po přechodu na detekci podle obsahu by
  // propadl do textové větve a skončil jako „0 transakcí, 0 chyb“.
  if (isBlankUpload(data)) {
    return importParsed(
      db,
      userId,
      filename,
      unknownFormat(
        'Soubor je prázdný — stahování nejspíš selhalo. Stáhni výpis od své platformy znovu.',
      ),
      undefined,
      NOT_OURS,
    );
  }

  // Formát určuje OBSAH, ne přípona: portály nabízejí „XLS“ a doručí XLSX,
  // prohlížeč připíše .csv k sešitu a uživatel soubory přejmenovává.
  const format = sniffFileFormat(data);
  if (format !== null && format !== 'xlsx') {
    return importParsed(
      db,
      userId,
      filename,
      unknownFormat(unsupportedFormatMessage(format)!),
      undefined,
      NOT_OURS,
    );
  }

  if (format === 'xlsx') {
    try {
      return await importXlsxUpload(db, userId, filename, data);
    } catch (error) {
      // Konkrétní diagnózu XLSX (zip bomba, uříznutý archiv) jinak spolkne
      // importFileIsolated a uživatel dostane generické „soubor je poškozený“ —
      // rada „rozděl export na kratší období“ je přitom úplně jiná.
      if (error instanceof XlsxTooLargeError || error instanceof XlsxUnreadableError) {
        return importParsed(
          db,
          userId,
          filename,
          unknownFormat(error.message),
          undefined,
          NOT_OURS,
        );
      }
      throw error;
    }
  }

  const utf8 = new TextDecoder().decode(data);

  // Fio: hlavička je čitelná i při špatném dekódování, samotný obsah se ale
  // musí dekódovat jako windows-1250 (proč právě takhle vysvětluje sniffFioCsv).
  // Kontroluje se JEN první řádek — poznámka v jiném souboru nesmí import
  // přesměrovat na Fio.
  const header = firstLine(utf8);
  if (sniffFioCsv(header)) {
    const aliases = await loadAliases(db, userId);
    const outcome = parseFioCsv(decodeFioCsv(data), { symbolMap: aliases.isinOnly.fio });
    return importParsed(db, userId, filename, outcome, undefined, {
      unmapped: outcome.unmappedSymbols.map((symbol) => ({
        broker: 'fio',
        symbol,
        needsCurrency: false,
      })),
    });
  }

  // rozbitá diakritika V HLAVIČCE = soubor není UTF-8 → české/německé exporty
  // bývají windows-1250 (Coinmate, Swissquote DE aj.). Kontroluje se JEN první
  // řádek: legitimní UTF-8 soubor s ojedinělým U+FFFD hlouběji v datech se
  // nesmí celý předekódovat (rozsypaly by se správné české názvy).
  const text = header.includes('�') ? decodeCp1250(data) : utf8;
  const aliases = await loadAliases(db, userId);
  const parsed = detectAndParseText(text, aliases);
  return importParsed(db, userId, filename, parsed.outcome, undefined, {
    unmapped: parsed.unmapped,
    unrecognized: parsed.unrecognized,
  });
}

/**
 * Parser se rozeběhl, ale nevydal jedinou transakci a jen chyby.
 *
 * Sniffer tedy formát POZNAL a parser mu pak nerozuměl — přesně takhle vypadá
 * broker, který přejmenoval sloupec (9. 8. 2026: T212 `Time` → `Time (UTC)`).
 * Takový soubor je pro opravu ještě cennější než úplně neznámý formát, protože
 * jde o platformu, kterou už podporujeme.
 */
const producedNothing = (parsed: ImportResult): boolean =>
  parsed.transactions.length === 0 && parsed.errors.length > 0;

/** XLSX větev importu: jedno načtení workbooku pro všechny sniffy. */
async function importXlsxUpload(
  db: Db,
  userId: string,
  filename: string,
  data: ArrayBuffer,
): Promise<ImportSummary> {
  const workbook = await loadXlsxWorkbook(data);
  if (sniffXtbXlsx(workbook)) {
    const aliases = await loadAliases(db, userId);
    const outcome = await parseXtbXlsx(data, aliases.xtb);
    return importParsed(db, userId, filename, outcome, undefined, {
      unmapped: outcome.unmappedSymbols.map((symbol) => ({
        broker: 'xtb',
        symbol,
        needsCurrency: true,
      })),
    });
  }
  if (sniffEtoroXlsx(workbook)) {
    const aliases = await loadAliases(db, userId);
    const parsed = withUnmapped('etoro', await parseEtoroXlsx(data, aliases.isinOnly.etoro));
    return importParsed(db, userId, filename, parsed.outcome, undefined, {
      unmapped: parsed.unmapped,
    });
  }
  if (sniffSaxoXlsx(workbook)) {
    return importParsed(db, userId, filename, await parseSaxoXlsx(data));
  }
  if (sniffMt5Xlsx(workbook)) {
    return importParsed(db, userId, filename, await parseMt5Xlsx(data));
  }
  // Revolut nabízí „Account statement“ jako Excel a podle účtu z něj chodí
  // jednou CSV a jindy opravdový sešit — obojí vede na tentýž parser
  if (sniffRevolutXlsx(workbook)) {
    const aliases = await loadAliases(db, userId);
    const parsed = withUnmapped('revolut', await parseRevolutXlsx(data, aliases.isinOnly.revolut));
    return importParsed(db, userId, filename, parsed.outcome, undefined, {
      unmapped: parsed.unmapped,
    });
  }
  return importParsed(
    db,
    userId,
    filename,
    unknownFormat(
      'XLSX nepoznáváme — podporujeme reporty XTB, eToro, Saxo, Revolut a MetaTrader 5. Zkontroluj v seznamu platforem níž, který export stáhnout, nebo použij univerzální šablonu.',
    ),
    undefined,
    { unrecognized: true },
  );
}

/**
 * Co už uživatel má — obsahové klíče i id přidělená brokerem.
 *
 * Obojí se čte JEDNÍM dotazem: obsahový klíč je primární dedupe (B-3-2),
 * id brokera je druhá síť pod ním pro události, které tentýž výpis popisuje
 * dvakrát s jinak zaokrouhlenými čísly (viz `dedupeTransactions`). Sync po
 * letech si stav načte jednou a předává ho dál.
 */
export interface ImportState {
  keys: Set<string>;
  brokerIds: Set<string>;
}

export async function loadImportState(db: Db, userId: string): Promise<ImportState> {
  const rows = await db
    .select({
      key: transactions.dedupeKey,
      broker: transactions.broker,
      // id přiděluje parser a je uložené v payloadu; sloupec navíc kvůli němu
      // nezavádíme — tenhle select stejně čte všechny řádky uživatele
      id: sql<string | null>`${transactions.payload} ->> 'id'`,
    })
    .from(transactions)
    .where(eq(transactions.userId, userId));
  return {
    keys: new Set(rows.map((row) => row.key)),
    brokerIds: new Set(
      rows.filter((row) => row.id !== null).map((row) => brokerIdKey(row.broker, row.id!)),
    ),
  };
}

/** Jen dedupe klíče (zpětně kompatibilní vstup pro starší volající). */
export async function loadDedupeKeys(db: Db, userId: string): Promise<Set<string>> {
  return (await loadImportState(db, userId)).keys;
}

/** Broker z dedupe klíče a zbytek klíče (otisk obsahu + pořadí výskytu). */
const splitDedupeKey = (key: string): { broker: string; content: string } => {
  const at = key.indexOf('|');
  return { broker: key.slice(0, at), content: key.slice(at + 1) };
};

/**
 * Tatáž událost od DVOU zdrojů (B-3-3).
 *
 * Dedupe klíč je jmenný prostor per broker, takže obchod zadaný ručně přes
 * univerzální šablonu — dokumentovaný postup, UI k němu navádí — a později
 * stažený z brokera se uloží dvakrát a engine mlčí. Doloženo reálným splitem
 * BYDDY: pozice 5,8565544 → 35,1393264 (6×) a nabývací cena 15,61 → 2,60 USD.
 *
 * Slučovat je ale NESMÍME: dvě obsahově shodné transakce od dvou brokerů jsou
 * legitimní stav (týž obchod na dvou účtech) a falešné sloučení je horší než
 * duplikát — proto se to jen hlásí a rozhodnutí zůstává na uživateli.
 *
 * Hlásí se výhradně události s instrumentem. Hotovostní řádky (vklad, výběr,
 * poplatek, úrok, směna) nesou jen typ, datum, částku a měnu, takže vklad
 * 5 000 Kč k dvěma brokerům v jeden den je běžná shoda náhodou — a hláška
 * „vypadá to na duplicitu, smaž jednu dávku“ by u nich radila zahodit poctivá
 * data.
 */
const CROSS_BROKER_TYPES = new Set<Transaction['type']>([
  'BUY',
  'SELL',
  'DIVIDEND',
  'CORPORATE_ACTION',
  'TRANSFER_IN',
  'TRANSFER_OUT',
]);

function crossBrokerMatches(
  broker: string,
  fresh: Array<{ tx: Transaction; key: string }>,
  existingKeys: Iterable<string>,
): string[] {
  const foreign = new Map<string, string>();
  for (const key of existingKeys) {
    const { broker: other, content } = splitDedupeKey(key);
    if (other !== broker) foreign.set(content, other);
  }
  if (foreign.size === 0) return [];

  const byBroker = new Map<string, number>();
  for (const { tx, key } of fresh) {
    if (!CROSS_BROKER_TYPES.has(tx.type)) continue;
    const other = foreign.get(splitDedupeKey(key).content);
    if (other) byBroker.set(other, (byBroker.get(other) ?? 0) + 1);
  }

  return [...byBroker.entries()].map(
    ([other, count]) =>
      `${count} ${plural(count, 'transakce vypadá', 'transakce vypadají', 'transakcí vypadá')} ` +
      `úplně stejně jako to, co už máš od „${other}“ (stejný typ, datum, instrument, počet kusů i cena). ` +
      'Sloučit je automaticky nemůžeme — týž obchod může být opravdu na dvou účtech. Jestli jde o duplicitu ' +
      '(typicky obchod zadaný ručně a později stažený i od brokera), vrať jeden z těch importů zpět ' +
      'tlačítkem v historii níž — smaže se i s transakcemi.',
  );
}

/**
 * Táž událost brokera podruhé, jen s jinými čísly (viz `dedupeTransactions`).
 *
 * Neukládá se — dvě verze téhož nákupu by zdvojily držbu i nabývací cenu
 * a pozdější prodej by se FIFO spároval s lotem, který nikdy neexistoval.
 * Uživatel se to ale musí dozvědět: čísla se liší a my si necháváme ta dřív
 * uložená.
 */
const restatedWarnings = (restated: Transaction[]): RowIssue[] =>
  restated.map((tx) => ({
    line: 1,
    message:
      `Událost „${tx.id}“ už máš uloženou z dřívějšího výpisu, jen s jinými čísly — ` +
      'necháváme tu původní a tuhle neukládáme (jinak by ses o ni v přehledu počítal dvakrát). ' +
      'Typicky jde o zaokrouhlení: tentýž obchod uvádí broker v jedné sekci výpisu přesně ' +
      'a v jiné zaokrouhleně. Když si myslíš, že jde o opravu obchodu, vrať starší import zpět ' +
      'tlačítkem v historii níž (smaže se i s transakcemi) a nahraj výpis znovu.',
  }));

/**
 * Uložení už naparsovaného výsledku (sdílí ruční upload i API sync).
 * `existing` (volitelné) ušetří opakovaný select při dávkových importech —
 * funkce do předaného stavu DOPLŇUJE klíče i id nově uložených transakcí.
 */
export async function importParsed(
  db: Db,
  userId: string,
  filename: string,
  parsed: ImportResult,
  existing?: ImportState,
  extras: { unmapped?: UnmappedSymbol[]; unrecognized?: boolean } = {},
): Promise<ImportSummary> {
  const state = existing ?? (await loadImportState(db, userId));
  const { fresh, duplicates, restated } = dedupeTransactions(
    parsed.broker,
    parsed.transactions,
    state.keys,
    state.brokerIds,
  );
  const unmapped = extras.unmapped ?? [];
  // Volající má poslední slovo (`false` u selhání, za které nemůžeme); jinak
  // rozhoduje výsledek — parser bez jediné transakce a jen s chybami.
  const unrecognized = extras.unrecognized ?? producedNothing(parsed);
  const crossBroker = crossBrokerMatches(parsed.broker, fresh, state.keys);
  const warnings = [...parsed.warnings, ...restatedWarnings(restated)];

  const batchId = crypto.randomUUID();

  // onConflictDoNothing: souběžný sync/upload se stejnými klíči nesmí shodit
  // celou dávku na PK violation — duplicitní řádky se tiše přeskočí a reálný
  // počet vložených jde z returning (in-memory dedupe je jen optimalizace)
  let actuallyAdded = 0;
  for (const part of chunk(fresh, 500)) {
    const inserted = await db
      .insert(transactions)
      .values(
        part.map(({ tx, key }) => {
          state.keys.add(key);
          state.brokerIds.add(brokerIdKey(parsed.broker, tx.id));
          return {
            userId,
            dedupeKey: key,
            batchId,
            broker: parsed.broker,
            type: tx.type,
            txDate: txDate(tx),
            isin: 'isin' in tx ? (tx.isin ?? null) : null,
            // Decimal má toJSON → serializace na stringy; engine rehydratuje Zodem
            payload: JSON.parse(JSON.stringify(tx)) as unknown,
          };
        }),
      )
      .onConflictDoNothing()
      .returning({ dedupeKey: transactions.dedupeKey });
    actuallyAdded += inserted.length;
  }

  // audit až PO úspěšném insertu a se skutečně přidaným počtem — dřívější zápis
  // před insertem lhal při pádu i při souběhu (in-memory dedupe vs. DB)
  const { logAudit } = await import('@/lib/audit');
  await logAudit(db, userId, 'IMPORT', `${filename} (${parsed.broker}): ${actuallyAdded} nových`);

  await db.insert(importBatches).values({
    id: batchId,
    userId,
    broker: parsed.broker,
    filename,
    added: actuallyAdded,
    duplicates: duplicates + (fresh.length - actuallyAdded),
    errorCount: parsed.errors.length,
    skippedCount: parsed.skipped.length,
    warningCount: warnings.length,
    issues: {
      errors: parsed.errors,
      skipped: parsed.skipped,
      warnings,
      ...(unmapped.length > 0 ? { unmapped } : {}),
      ...(crossBroker.length > 0 ? { crossBroker } : {}),
    },
  });

  return {
    batchId,
    broker: parsed.broker,
    filename,
    added: actuallyAdded,
    duplicates: duplicates + (fresh.length - actuallyAdded),
    errors: parsed.errors,
    skipped: parsed.skipped,
    warnings,
    unmapped,
    crossBroker,
    ...(unrecognized ? { unrecognized: true } : {}),
  };
}

/**
 * Import jednoho souboru z dávky, který NESMÍ shodit ostatní (F-3-7).
 *
 * Nahrání víc souborů najednou jelo v prostém `for … await importFile(…)` bez
 * try/catch: poškozený druhý soubor tak zabil celou akci — první zůstal uložený,
 * třetí se vůbec nezpracoval a uživatel dostal generický error boundary bez
 * jediné informace o tom, co se stalo a s čím.
 *
 * Selhání se proto zapíše jako dávka s chybou (UI ji vypíše u seznamu importů)
 * a zbytek souborů pokračuje. Když selže i zápis té dávky, chyba propadne dál —
 * to už je výpadek databáze, ne vada jednoho souboru.
 *
 * Je to zároveň JEDINÁ cesta ručního nahrání, takže tady se schovává originál
 * nepřečteného výpisu (`lib/failed-imports.ts`) — bez toho se soubor, na kterém
 * jsme si vylámali zuby, zahodí a formát se nemá podle čeho doplnit.
 */
export async function importFileIsolated(
  db: Db,
  userId: string,
  filename: string,
  data: ArrayBuffer,
): Promise<ImportSummary> {
  const summary = await runIsolated(db, userId, filename, data);
  if (summary.unrecognized) {
    const { keepFailedUpload } = await import('@/lib/failed-imports');
    await keepFailedUpload(db, {
      userId,
      batchId: summary.batchId,
      filename,
      data,
      reason: summary.errors[0]?.message ?? 'Formát souboru nepoznáváme.',
    });
  }
  return summary;
}

async function runIsolated(
  db: Db,
  userId: string,
  filename: string,
  data: ArrayBuffer,
): Promise<ImportSummary> {
  try {
    return await importFile(db, userId, filename, data);
  } catch (error) {
    logEvent('error', 'import.file_failed', { filename, error: errorText(error) });
    const fromDb = isDatabaseError(error);
    const failed = emptyResult('neznámý formát');
    failed.errors.push({
      line: 1,
      // O tom, že si soubor necháváme, mluví JEN panel v historii — ten se
      // ukáže, jen když se opravdu uložil. Slíbit to tady natvrdo by lhalo
      // uživateli, kterému úschovu odmítl strop případů nebo velikost souboru.
      // A radit „stáhni ho od brokera znovu“ u výpadku databáze je taky lež:
      // se souborem není nic v nepořádku a nové stažení nepomůže (K5-08).
      message: fromDb
        ? 'Soubor se nepodařilo uložit — na naší straně selhala databáze. ' +
          'Se souborem nic není, zkus ho nahrát znovu za chvíli.'
        : 'Soubor se nepodařilo zpracovat — nejspíš je poškozený nebo neúplně stažený. ' +
          'Stáhni ho od brokera znovu.',
    });
    // Výjimka v PARSERU je podezřelá vždycky: buď je soubor rozbitý, nebo se
    // parser dusí na něčem, co v něm dřív nebylo. Výpadek DATABÁZE ale o formátu
    // neříká nic (K5-08) — schovat kvůli němu originál by znamenalo falešný
    // poplach provozovateli, zbytečně uschovaný cizí výpis (a tedy i osobní
    // údaje navíc) a uživateli hlášku „soubor je nejspíš poškozený“ o souboru,
    // který umíme přečíst.
    return importParsed(db, userId, filename, failed, undefined, { unrecognized: !fromDb });
  }
}
