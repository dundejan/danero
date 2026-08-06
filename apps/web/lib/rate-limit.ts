import { lt, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { appRateLimits } from '@/db/schema';
import { ts } from '@/lib/sql';

/**
 * Aplikační rate limit (G10a) — fixní okno per klíč (otevírá ho první request,
 * po `resetAt` se čítač počítá od nuly), atomický upsert (souběžné requesty
 * nezdvojí čítač). Klíč = `${operace}:${userId}`. Vrací true = povoleno.
 * Limity jsou záměrně štědré: brání skriptovanému zneužití, ne běžnému používání.
 */
export async function checkRateLimit(
  db: Db,
  key: string,
  { max, windowMs }: { max: number; windowMs: number },
): Promise<boolean> {
  const now = new Date();
  const reset = new Date(now.getTime() + windowMs);
  const [row] = await db
    .insert(appRateLimits)
    .values({ key, count: 1, resetAt: reset })
    .onConflictDoUpdate({
      target: appRateLimits.key,
      set: {
        count: sql`CASE WHEN ${appRateLimits.resetAt} < ${ts(now)} THEN 1 ELSE ${appRateLimits.count} + 1 END`,
        resetAt: sql`CASE WHEN ${appRateLimits.resetAt} < ${ts(now)} THEN ${ts(reset)} ELSE ${appRateLimits.resetAt} END`,
      },
    })
    .returning({ count: appRateLimits.count });
  return (row?.count ?? 1) <= max;
}

/**
 * Úklid prošlých oken. Tabulka nemá cizí klíč na uživatele, takže bez tohohle
 * roste donekonečna a přežije i smazání účtu — a u klíčů z waitlistu drží
 * syrovou IP adresu, kterou po vypršení okna nemáme proč uchovávat.
 */
export async function pruneRateLimits(db: Db, now = new Date()): Promise<number> {
  const deleted = await db
    .delete(appRateLimits)
    .where(lt(appRateLimits.resetAt, now))
    .returning({ key: appRateLimits.key });
  return deleted.length;
}
