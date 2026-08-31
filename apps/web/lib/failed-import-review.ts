import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { auditLog, importBatches } from '@/db/schema';
import { caseOverview, deleteCase, loadOpenCase, resolveCase } from '@/lib/failed-imports';
import { importFile, type ImportSummary } from '@/lib/import-service';

/**
 * Akce provozovatele nad nepřečteným výpisem: doimportovat, uzavřít jako
 * nečitelný, smazat na žádost uživatele.
 *
 * Vlastní modul, ne součást `lib/failed-imports.ts`: `retryCase` potřebuje
 * `lib/import-service.ts` a ten si naopak sahá pro `keepFailedUpload` — v jednom
 * souboru by z toho byl kruh. Druhý důvod je testovatelnost: dokud tohle bydlelo
 * ve `scripts/failed-imports.ts`, nemohl na to sáhnout jediný test.
 *
 * Každá funkce vrací výsledek, ne text — hlášky skládá CLI.
 */

export type RetryResult =
  | { outcome: 'missing' }
  | { outcome: 'closed'; status: string }
  /** Soubor pořád nepřečteme (nebo z něj nic nevypadlo) — případ zůstává otevřený. */
  | { outcome: 'unresolved'; unrecognized: boolean; reason: string | null }
  | { outcome: 'fixed'; email: string; summary: ImportSummary };

export type RejectResult =
  | { outcome: 'missing' }
  | { outcome: 'closed'; status: string }
  | { outcome: 'rejected'; email: string };

export type DeleteResult =
  | { outcome: 'missing' }
  | { outcome: 'deleted'; filename: string; email: string };

/** Detail, který k importu zapisuje `importParsed` — musí sedět DOSLOVA. */
const auditDetail = (filename: string, summary: ImportSummary): string =>
  `${filename} (${summary.broker}): ${summary.added} nových`;

/**
 * Po neúspěšném pokusu uklidí stopu, kterou v uživatelově auditu nechal
 * provozovatel — a jenom ji.
 *
 * Maže se JEDEN, ten nejnovější řádek. Původní podmínka brala všechny řádky
 * s týmž detailem, a ten detail (`vypis.csv (fio): 0 nových`) má i uživatelovo
 * VLASTNÍ nahrání téhož souboru: naměřeno ve 4. auditu, že po jednom `retry`
 * zmizely dva záznamy a uživateli se ztratila stopa z jeho vlastního auditu
 * (K6a-13). Čas jako filtr nepomůže — `retry-all` běží dlouho a okno by sebralo
 * import, který si uživatel mezitím nahrál sám.
 */
async function removeRetryAuditEntry(
  db: Db,
  userId: string,
  detail: string,
): Promise<void> {
  const [latest] = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(eq(auditLog.userId, userId), eq(auditLog.type, 'IMPORT'), eq(auditLog.detail, detail)))
    // shodné `created_at` na milisekundu není v praxi k rozeznání, takže
    // druhotné řazení podle id drží výběr aspoň deterministický
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(1);
  if (!latest) return;
  await db.delete(auditLog).where(eq(auditLog.id, latest.id));
}

/**
 * Zkusí případ naimportovat znovu (typicky po opravě parseru).
 *
 * Jde přes `importFile`, ne `importFileIsolated`: to druhé při neúspěchu
 * schová soubor ZNOVU a případ přepíše na právě vzniklou dávku — panel by
 * uživateli přeskočil na záznam, který sám nenahrál. Neúspěšný pokus tady po
 * sobě uklidí i tu prázdnou dávku, takže v historii uživatele nezůstane nic.
 */
export async function retryCase(db: Db, caseId: string): Promise<RetryResult> {
  const item = await loadOpenCase(db, caseId);
  if (!item) return closedOrMissing(db, caseId);

  const summary = await importFile(db, item.userId, item.filename, item.data);
  const nothingImported = summary.added === 0 && summary.duplicates === 0;
  if (summary.unrecognized || nothingImported) {
    await db.delete(importBatches).where(eq(importBatches.id, summary.batchId));
    // `importParsed` zapíše audit ještě před dávkou, takže po neúspěchu zbývá
    // uživateli v Nastavení „Import výpisu“ souboru, který sám nenahrál.
    await removeRetryAuditEntry(db, item.userId, auditDetail(item.filename, summary));
    return {
      outcome: 'unresolved',
      unrecognized: summary.unrecognized === true,
      reason: summary.errors[0]?.message ?? null,
    };
  }
  await resolveCase(db, caseId, {
    status: 'fixed',
    batchId: summary.batchId,
    added: summary.added,
  });
  return { outcome: 'fixed', email: item.email, summary };
}

/** Uzavře případ jako nečitelný — uživateli o tom odejde e-mail s vysvětlením. */
export async function rejectCase(db: Db, caseId: string, note: string): Promise<RejectResult> {
  const item = await loadOpenCase(db, caseId);
  if (!item) return closedOrMissing(db, caseId);
  await resolveCase(db, caseId, { status: 'rejected', note });
  return { outcome: 'rejected', email: item.email };
}

/** Výmaz na žádost uživatele. E-mail se neposílá — uživatel o to sám požádal. */
export async function eraseCase(db: Db, caseId: string): Promise<DeleteResult> {
  const overview = await caseOverview(db, caseId);
  if (!overview) return { outcome: 'missing' };
  await deleteCase(db, caseId);
  return { outcome: 'deleted', filename: overview.filename, email: overview.email };
}

/** Rozliší „takový případ není" od „je zavřený" — bez toho je hláška k ničemu. */
async function closedOrMissing(
  db: Db,
  caseId: string,
): Promise<{ outcome: 'missing' } | { outcome: 'closed'; status: string }> {
  const overview = await caseOverview(db, caseId);
  return overview ? { outcome: 'closed', status: overview.status } : { outcome: 'missing' };
}
