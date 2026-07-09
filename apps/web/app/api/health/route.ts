import { sql } from 'drizzle-orm';
import { getDb } from '@/db';

export const dynamic = 'force-dynamic';

/**
 * Health endpoint pro monitoring (G10c) — ověří dostupnost DB. Bez auth
 * (monitorovací služby), ale bez jakýchkoli dat: jen stav a latence.
 */
export async function GET(): Promise<Response> {
  const startedAt = performance.now();
  try {
    const db = await getDb();
    await db.execute(sql`SELECT 1`);
    return Response.json({
      status: 'ok',
      db: 'ok',
      dbLatencyMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'health.db_failed', error: String(error) }));
    return Response.json({ status: 'error', db: 'unreachable' }, { status: 503 });
  }
}
