import {
  dedupeKey,
  dedupeTransactions,
  decodeFioCsv,
  isDegiroCsv,
  parseCsv,
  parseDegiroAccountCsv,
  parseDegiroTransactionsCsv,
  parseFioCsv,
  parseIbkrFlexXml,
  parseTrading212Csv,
  parseUniversalCsv,
  parseXtbXlsx,
  type ImportResult,
  type RowIssue,
} from '@danero/importers';
import type { Transaction } from '@danero/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { importBatches, transactions } from '@/db/schema';
import { loadAliases } from '@/lib/instrument-aliases';

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

/** Autodetekce formátu: IBKR Flex XML vs. T212 CSV vs. univerzální šablona. */
export function detectAndParse(text: string): ImportResult {
  if (text.trimStart().startsWith('<')) return parseIbkrFlexXml(text);
  const { headers } = parseCsv(text);
  const isT212 = headers.includes('Action') && headers.includes('Time');
  return isT212 ? parseTrading212Csv(text) : parseUniversalCsv(text);
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
  portfolioId: string,
  filename: string,
  text: string,
): Promise<ImportSummary> {
  return importParsed(db, userId, portfolioId, filename, detectAndParse(text));
}

/**
 * Import nahraného souboru s autodetekcí formátu (G4): XLSX → XTB, Degiro
 * podle hlaviček (Transactions/Account), Fio podle CZ hlaviček (windows-1250!),
 * jinak stávající textová cesta (IBKR XML / T212 CSV / univerzální šablona).
 * XTB a Fio dostávají uživatelský číselník instrumentů; nenamapované symboly
 * se vrací v `unmapped`, ať UI nabídne doplnění.
 */
export async function importFile(
  db: Db,
  userId: string,
  portfolioId: string,
  filename: string,
  data: ArrayBuffer,
): Promise<ImportSummary> {
  if (/\.xlsx$/i.test(filename)) {
    const aliases = await loadAliases(db, userId, portfolioId);
    const outcome = await parseXtbXlsx(data, aliases.xtb);
    return importParsed(db, userId, portfolioId, filename, outcome, undefined, {
      unmapped: outcome.unmappedSymbols.map((symbol) => ({
        broker: 'xtb',
        symbol,
        needsCurrency: true,
      })),
    });
  }

  const utf8 = new TextDecoder().decode(data);

  const degiroKind = isDegiroCsv(utf8);
  if (degiroKind === 'transactions') {
    return importParsed(db, userId, portfolioId, filename, parseDegiroTransactionsCsv(utf8));
  }
  if (degiroKind === 'account') {
    return importParsed(db, userId, portfolioId, filename, parseDegiroAccountCsv(utf8));
  }

  // Fio: hlavička „Datum obchodu" je čitelná i při špatném dekódování (ASCII),
  // samotný obsah se ale musí dekódovat jako windows-1250. Kontroluje se JEN
  // první řádek — poznámka v jiném souboru nesmí import přesměrovat na Fio.
  const firstLine = utf8.slice(0, utf8.indexOf('\n') === -1 ? undefined : utf8.indexOf('\n'));
  if (firstLine.includes('Datum obchodu')) {
    const aliases = await loadAliases(db, userId, portfolioId);
    const outcome = parseFioCsv(decodeFioCsv(data), { symbolMap: aliases.fio });
    return importParsed(db, userId, portfolioId, filename, outcome, undefined, {
      unmapped: outcome.unmappedSymbols.map((symbol) => ({
        broker: 'fio',
        symbol,
        needsCurrency: false,
      })),
    });
  }

  return importParsed(db, userId, portfolioId, filename, detectAndParse(utf8));
}

/** Dedupe klíče uživatele — sync po letech si je načte jednou a předává dál. */
export async function loadDedupeKeys(
  db: Db,
  userId: string,
  portfolioId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ key: transactions.dedupeKey })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.portfolioId, portfolioId)));
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
  portfolioId: string,
  filename: string,
  parsed: ImportResult,
  existingKeys?: Set<string>,
  extras: { unmapped?: UnmappedSymbol[] } = {},
): Promise<ImportSummary> {
  const keys = existingKeys ?? (await loadDedupeKeys(db, userId, portfolioId));
  const { fresh, duplicates } = dedupeTransactions(parsed.broker, parsed.transactions, keys);
  const unmapped = extras.unmapped ?? [];

  const { logAudit } = await import('@/lib/audit');
  await logAudit(db, userId, 'IMPORT', `${filename} (${parsed.broker}): ${fresh.length} nových`);

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
            portfolioId,
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

  await db.insert(importBatches).values({
    id: batchId,
    userId,
    portfolioId,
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
