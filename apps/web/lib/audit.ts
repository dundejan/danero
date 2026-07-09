import { desc, eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { auditLog } from '@/db/schema';

/**
 * Audit události účtu (G8b) — transparentnost pro uživatele v nastavení.
 * Zápis NIKDY nesmí shodit hlavní operaci (přihlášení, import) → chyby se
 * jen zalogují. Detail je krátký český popis bez citlivých dat.
 */
export type AuditType =
  | 'LOGIN'
  | 'IMPORT'
  | 'SYNC'
  | 'PROFILE_CHANGE'
  | 'PASSWORD_CHANGE'
  | 'EMAIL_CHANGE'
  | 'BROKER_CONNECTED'
  | 'BROKER_DISCONNECTED'
  | 'SESSIONS_REVOKED';

export const AUDIT_LABELS: Record<AuditType, string> = {
  LOGIN: 'Přihlášení',
  IMPORT: 'Import výpisu',
  SYNC: 'Synchronizace brokera',
  PROFILE_CHANGE: 'Změna daňového profilu',
  PASSWORD_CHANGE: 'Změna hesla',
  EMAIL_CHANGE: 'Změna e-mailu',
  BROKER_CONNECTED: 'Připojení brokera',
  BROKER_DISCONNECTED: 'Odpojení brokera',
  SESSIONS_REVOKED: 'Odhlášení ostatních zařízení',
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
    console.error('[audit] zápis selhal:', error);
  }
}

export async function recentAuditEvents(db: Db, userId: string, limit = 20) {
  return db
    .select()
    .from(auditLog)
    .where(eq(auditLog.userId, userId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}
