import { eq, lt, sql } from 'drizzle-orm';
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
 * Vrátí klíč zabraný přes `checkRateLimit` s `max: 1` do nezabraného stavu.
 *
 * Limit s jedním povoleným průchodem se dá číst jako „claim": kdo dostane
 * `true`, ten jediný smí akci udělat. Když ta akce selže (typicky se
 * neodeslal e-mail), musí se claim vrátit — jinak by se práce nezopakovala
 * nikdy, protože okno je dlouhé. Je to tentýž vzor jako u digestu
 * v `lib/notifications.ts`, jen nad tabulkou limitů místo nad notifikacemi.
 *
 * Používej VÝHRADNĚ na klíče s `max: 1`. U skutečného rate limitu by smazání
 * řádku vynulovalo čítač celého okna, tedy přesně to, čemu limit brání.
 */
export async function releaseRateLimit(db: Db, key: string): Promise<void> {
  await db.delete(appRateLimits).where(eq(appRateLimits.key, key));
}

/**
 * Úklid prošlých oken. Tabulka nemá cizí klíč na uživatele, takže bez tohohle
 * roste donekonečna a řádky přežijou i smazání účtu.
 *
 * Dokud existoval waitlist, držely jeho klíče navíc syrovou IP adresu; ta je
 * po jeho zrušení (9. 8. 2026) pryč a všechny klíče jsou dnes odvozené od
 * userId. Kdyby sem někdy přibyl anonymní limit klíčovaný IP adresou, tenhle
 * úklid je jediné, co ji zase přestane uchovávat — počítej s tím.
 */
export async function pruneRateLimits(db: Db, now = new Date()): Promise<number> {
  const deleted = await db
    .delete(appRateLimits)
    .where(lt(appRateLimits.resetAt, now))
    .returning({ key: appRateLimits.key });
  return deleted.length;
}
