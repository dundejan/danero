import { describe, expect, it } from 'vitest';
import { createPgliteDb } from '@/db';
import { auditLog, user } from '@/db/schema';
import { AUDIT_RETENTION_DAYS, pruneAuditLog, recentAuditEvents } from '@/lib/audit';

/**
 * /soukromi slibuje, že audit log držíme 90 dní. Do 5. 8. 2026 ho nic nemazalo —
 * tenhle test hlídá, že slib odpovídá skutečnosti.
 */
describe('úklid audit logu', () => {
  it('smaže záznamy starší než retenční lhůta, novější nechá', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u1', name: 'Test', email: 'test@danero.cz' });

    const now = new Date('2026-08-05T12:00:00Z');
    const dayMs = 24 * 60 * 60 * 1000;
    const expired = new Date(now.getTime() - (AUDIT_RETENTION_DAYS + 1) * dayMs);
    const justInside = new Date(now.getTime() - (AUDIT_RETENTION_DAYS - 1) * dayMs);

    await db.insert(auditLog).values([
      { userId: 'u1', type: 'LOGIN', detail: 'starý', createdAt: expired },
      { userId: 'u1', type: 'LOGIN', detail: 'na hraně', createdAt: justInside },
      { userId: 'u1', type: 'IMPORT', detail: 'čerstvý', createdAt: now },
    ]);

    expect(await pruneAuditLog(db, now)).toBe(1);

    const remaining = await recentAuditEvents(db, 'u1');
    expect(remaining.map((event) => event.detail).sort()).toEqual(['na hraně', 'čerstvý']);
  });

  it('na prázdné tabulce nic nerozbije', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    expect(await pruneAuditLog(db)).toBe(0);
  });
});
