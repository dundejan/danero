import { desc, eq, lt } from 'drizzle-orm';
import type { Db } from '@/db';
import { auditLog } from '@/db/schema';
import { errorText, logEvent } from '@/lib/log';

/** Doba držení audit logu — musí sedět na to, co slibuje /soukromi. */
export const AUDIT_RETENTION_DAYS = 90;

/**
 * Audit události účtu (G8b) — transparentnost pro uživatele v nastavení.
 * Zápis NIKDY nesmí shodit hlavní operaci (přihlášení, import) → chyby se
 * jen zalogují. Detail je krátký český popis bez citlivých dat.
 */
export type AuditType =
  | 'LOGIN'
  | 'IMPORT'
  | 'IMPORT_UNDONE'
  | 'SYNC'
  | 'PROFILE_CHANGE'
  | 'PASSWORD_CHANGE'
  | 'EMAIL_CHANGE'
  | 'BROKER_CONNECTED'
  | 'BROKER_DISCONNECTED'
  | 'SESSIONS_REVOKED'
  | 'TWO_FACTOR_ENABLED'
  | 'TWO_FACTOR_DISABLED';

export const AUDIT_LABELS: Record<AuditType, string> = {
  LOGIN: 'Přihlášení',
  IMPORT: 'Import výpisu',
  IMPORT_UNDONE: 'Vrácení importu',
  SYNC: 'Synchronizace brokera',
  PROFILE_CHANGE: 'Změna daňového profilu',
  PASSWORD_CHANGE: 'Změna hesla',
  EMAIL_CHANGE: 'Změna e-mailu',
  BROKER_CONNECTED: 'Připojení brokera',
  BROKER_DISCONNECTED: 'Odpojení brokera',
  SESSIONS_REVOKED: 'Odhlášení ostatních zařízení',
  TWO_FACTOR_ENABLED: 'Zapnutí dvoufaktorového ověření',
  TWO_FACTOR_DISABLED: 'Vypnutí dvoufaktorového ověření',
};

export async function logAudit(
  db: Db,
  userId: string,
  type: AuditType,
  detail?: string,
): Promise<void> {
  try {
    await db.insert(auditLog).values({ userId, type, detail });
  } catch (error) {
    // D-3-05: syrový objekt chyby sem nepatří. `DrizzleQueryError.message`
    // nese celý dotaz včetně `params:`, tedy e-maily i obsah transakcí —
    // a `console.error` s objektem navíc nevyjde jako JSON, takže by to
    // v logu ani nešlo odfiltrovat. Stejný filtr jako zbytek `lib/`.
    logEvent('error', 'audit.write_failed', { userId, type, error: errorText(error) });
  }
}

/**
 * Smaže audit záznamy starší než AUDIT_RETENTION_DAYS. Bez tohohle úklidu by
 * /soukromi lhalo — slibuje 90 dní, ale nic je nemazalo. Vrací počet smazaných.
 */
export async function pruneAuditLog(db: Db, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const deleted = await db.delete(auditLog).where(lt(auditLog.createdAt, cutoff)).returning({
    id: auditLog.id,
  });
  return deleted.length;
}

export async function recentAuditEvents(db: Db, userId: string, limit = 20) {
  return db
    .select()
    .from(auditLog)
    .where(eq(auditLog.userId, userId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}
