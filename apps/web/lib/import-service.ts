import {
  dedupeKey,
  dedupeTransactions,
  parseCsv,
  parseTrading212Csv,
  parseUniversalCsv,
  type ImportResult,
  type RowIssue,
} from '@danero/importers';
import type { Transaction } from '@danero/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { importBatches, transactions } from '@/db/schema';

export interface ImportSummary {
  batchId: string;
  broker: string;
  filename: string;
  added: number;
  duplicates: number;
  errors: RowIssue[];
  skipped: RowIssue[];
  warnings: RowIssue[];
}

/** Autodetekce formátu podle hlaviček — T212 export vs. univerzální šablona. */
export function detectAndParse(text: string): ImportResult {
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
  filename: string,
  text: string,
): Promise<ImportSummary> {
  return importParsed(db, userId, filename, detectAndParse(text));
}

/** Uložení už naparsovaného výsledku (sdílí ruční upload i API sync). */
export async function importParsed(
  db: Db,
  userId: string,
  filename: string,
  parsed: ImportResult,
): Promise<ImportSummary> {
  const existing = await db
    .select({ key: transactions.dedupeKey })
    .from(transactions)
    .where(eq(transactions.userId, userId));
  const { fresh, duplicates } = dedupeTransactions(
    parsed.broker,
    parsed.transactions,
    existing.map((row) => row.key),
  );

  const batchId = crypto.randomUUID();
  await db.insert(importBatches).values({
    id: batchId,
    userId,
    broker: parsed.broker,
    filename,
    added: fresh.length,
    duplicates,
    errorCount: parsed.errors.length,
    skippedCount: parsed.skipped.length,
    warningCount: parsed.warnings.length,
    issues: { errors: parsed.errors, skipped: parsed.skipped, warnings: parsed.warnings },
  });

  for (const part of chunk(fresh, 500)) {
    await db.insert(transactions).values(
      part.map((tx) => ({
        userId,
        dedupeKey: dedupeKey(parsed.broker, tx),
        batchId,
        broker: parsed.broker,
        type: tx.type,
        txDate: txDate(tx),
        isin: 'isin' in tx ? (tx.isin ?? null) : null,
        // Decimal má toJSON → serializace na stringy; engine rehydratuje Zodem
        payload: JSON.parse(JSON.stringify(tx)) as unknown,
      })),
    );
  }

  return {
    batchId,
    broker: parsed.broker,
    filename,
    added: fresh.length,
    duplicates,
    errors: parsed.errors,
    skipped: parsed.skipped,
    warnings: parsed.warnings,
  };
}
