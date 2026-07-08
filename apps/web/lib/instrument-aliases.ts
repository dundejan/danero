import { eq } from 'drizzle-orm';
import type { XtbInstrumentMap } from '@danero/importers';
import type { Db } from '@/db';
import { instrumentAliases } from '@/db/schema';

/**
 * Číselník instrumentů pro brokery bez ISIN/měny v exportu (XTB, Fio).
 * Plní ho uživatel formulářem při importu; další importy ho použijí samy.
 */

export interface AliasMaps {
  xtb: XtbInstrumentMap;
  fio: Record<string, { isin: string }>;
}

export async function loadAliases(db: Db, userId: string): Promise<AliasMaps> {
  const rows = await db
    .select()
    .from(instrumentAliases)
    .where(eq(instrumentAliases.userId, userId));
  const maps: AliasMaps = { xtb: {}, fio: {} };
  for (const row of rows) {
    if (row.broker === 'xtb' && row.currency) {
      maps.xtb[row.symbol] = { isin: row.isin, currency: row.currency };
    }
    if (row.broker === 'fio') {
      maps.fio[row.symbol] = { isin: row.isin };
    }
  }
  return maps;
}

export interface AliasInput {
  broker: string;
  symbol: string;
  isin: string;
  currency?: string;
}

export async function saveAliases(db: Db, userId: string, rows: AliasInput[]): Promise<void> {
  for (const row of rows) {
    await db
      .insert(instrumentAliases)
      .values({
        userId,
        broker: row.broker,
        symbol: row.symbol,
        isin: row.isin,
        currency: row.currency ?? null,
      })
      .onConflictDoUpdate({
        target: [instrumentAliases.userId, instrumentAliases.broker, instrumentAliases.symbol],
        set: { isin: row.isin, currency: row.currency ?? null },
      });
  }
}
