import {
  dedupeKey,
  dedupeTransactions,
  decodeCp1250,
  decodeFioCsv,
  emptyResult,
  isDegiroCsv,
  loadXlsxWorkbook,
  parseAnycoinCsv,
  parseCoinbaseCsv,
  parseCoinmateCsv,
  parseCsv,
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
  parseRevolutInvestCsv,
  parseSaxoXlsx,
  parseSchwabCsv,
  parseSwissquoteCsv,
  parseTastytradeCsv,
  parseTrading212Csv,
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
  sniffSaxoXlsx,
  sniffSchwabCsv,
  sniffSwissquoteCsv,
  sniffTastytradeCsv,
  sniffXtbXlsx,
  type ImportResult,
  type RowIssue,
} from '@danero/importers';
import type { Transaction } from '@danero/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { importBatches, transactions } from '@/db/schema';
import { loadAliases, type AliasMaps } from '@/lib/instrument-aliases';

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
}

/** Výsledek parsování + případné nenamapované symboly (brokeři bez ISIN). */
interface ParsedFile {
  outcome: ImportResult;
  unmapped: UnmappedSymbol[];
}

const noUnmapped = (outcome: ImportResult): ParsedFile => ({ outcome, unmapped: [] });

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
      const unknown = emptyResult('neznámý formát');
      unknown.errors.push({
        line: 1,
        message:
          'HTML soubor nepoznáváme — podporujeme reporty MetaTrader 4 („Save as Report“) a MetaTrader 5. Zkontroluj návod u své platformy v seznamu na stránce.',
      });
      return noUnmapped(unknown);
    }
    return noUnmapped(parseIbkrFlexXml(text));
  }

  // hlavička se čte jen z prvního řádku — full parse 20MB CSV by tu byl zbytečný
  const newline = text.indexOf('\n');
  const { headers } = parseCsv(newline === -1 ? text : text.slice(0, newline));
  if (headers.includes('Action') && headers.includes('Time')) {
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
  return noUnmapped(parseUniversalCsv(text));
}

/** Zpětně kompatibilní vstup pro T212 sync (text bez číselníku aliasů). */
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
  if (/\.xlsx$/i.test(filename)) {
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
    const unknown = emptyResult('neznámý formát');
    unknown.errors.push({
      line: 1,
      message:
        'XLSX nepoznáváme — podporujeme reporty XTB, eToro, Saxo a MetaTrader 5. Zkontroluj v seznamu platforem níž, který export stáhnout, nebo použij univerzální šablonu.',
    });
    return importParsed(db, userId, filename, unknown);
  }

  const utf8 = new TextDecoder().decode(data);

  // Fio: hlavička „Datum obchodu“ je čitelná i při špatném dekódování (ASCII),
  // samotný obsah se ale musí dekódovat jako windows-1250. Kontroluje se JEN
  // první řádek — poznámka v jiném souboru nesmí import přesměrovat na Fio.
  const firstLine = utf8.slice(0, utf8.indexOf('\n') === -1 ? undefined : utf8.indexOf('\n'));
  if (firstLine.includes('Datum obchodu')) {
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
  const text = firstLine.includes('�') ? decodeCp1250(data) : utf8;
  const aliases = await loadAliases(db, userId);
  const parsed = detectAndParseText(text, aliases);
  return importParsed(db, userId, filename, parsed.outcome, undefined, {
    unmapped: parsed.unmapped,
  });
}

/** Dedupe klíče uživatele — sync po letech si je načte jednou a předává dál. */
export async function loadDedupeKeys(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ key: transactions.dedupeKey })
    .from(transactions)
    .where(eq(transactions.userId, userId));
  return new Set(rows.map((row) => row.key));
}

/**
 * Uložení už naparsovaného výsledku (sdílí ruční upload i API sync).
 * `existingKeys` (volitelné) ušetří opakovaný select při dávkových importech —
 * funkce do předané množiny DOPLŇUJE klíče nově uložených transakcí.
 */
export async function importParsed(
  db: Db,
  userId: string,
  filename: string,
  parsed: ImportResult,
  existingKeys?: Set<string>,
  extras: { unmapped?: UnmappedSymbol[] } = {},
): Promise<ImportSummary> {
  const keys = existingKeys ?? (await loadDedupeKeys(db, userId));
  const { fresh, duplicates } = dedupeTransactions(parsed.broker, parsed.transactions, keys);
  const unmapped = extras.unmapped ?? [];

  const batchId = crypto.randomUUID();

  // onConflictDoNothing: souběžný sync/upload se stejnými klíči nesmí shodit
  // celou dávku na PK violation — duplicitní řádky se tiše přeskočí a reálný
  // počet vložených jde z returning (in-memory dedupe je jen optimalizace)
  let actuallyAdded = 0;
  for (const part of chunk(fresh, 500)) {
    const inserted = await db
      .insert(transactions)
      .values(
        part.map((tx) => {
          const key = dedupeKey(parsed.broker, tx);
          existingKeys?.add(key);
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
    warningCount: parsed.warnings.length,
    issues: {
      errors: parsed.errors,
      skipped: parsed.skipped,
      warnings: parsed.warnings,
      ...(unmapped.length > 0 ? { unmapped } : {}),
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
    warnings: parsed.warnings,
    unmapped,
  };
}
