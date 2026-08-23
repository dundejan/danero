import { and, eq, inArray, like } from 'drizzle-orm';
import type { Db } from '@/db';
import { notifications, taxpayerProfiles } from '@/db/schema';
import { invalidateUserCache } from '@/lib/engine-cache';
import { loadPinnedTaxYears } from '@/lib/portfolio';

type ProfileRow = typeof taxpayerProfiles.$inferSelect;

/**
 * Změnilo se v profilu něco, co hýbe výpočtem?
 *
 * Formulář se ukládá sám (auto-save), takže bez tohohle porovnání by se
 * upozornění mazala a znovu rozesílala i po uložení, které nic nezměnilo.
 * Porovnávají se všechna uložená pole kromě `updatedAt` — každé z nich do
 * výpočtu vstupuje.
 */
export function profileAffectsCalculations(
  previous: ProfileRow | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!previous) return false; // první uložení: co by se mazalo, ještě nevzniklo
  return Object.entries(values).some(
    ([key, value]) =>
      key !== 'updatedAt' &&
      String((previous as unknown as Record<string, unknown>)[key]) !== String(value),
  );
}

/**
 * K2-02: po změně daňového profilu přestala platit uložená upozornění hlídače.
 *
 * `undoImportAction` je maže a píše si proč; `saveProfileAction` se tabulky
 * nedotýkal vůbec — a to nebylo jen o nepravdě na přehledu. V řádku zůstal
 * i dedupe klíč `limit|…|<rok>` s vyplněným `emailedAt`, takže až limit padne
 * doopravdy, e-mail už nikdy nepřijde: v rámci téhož kalendářního roku hlídač
 * pro ten limit utichl. A hlídač je placená funkce.
 *
 * Maže se jen `limit|%` — kalendářní (`termin|…`, `rocni|…`) ani souhrnné
 * (`souhrn|…`) události na profilu nezávisí. A jen u roků, které NEJSOU
 * zafixované: u zafixovaného roku se čísla nemění, takže by se upozornění jen
 * znovu založilo a znovu odeslalo. Co pořád platí, založí příští běh cronu.
 *
 * Vrací počet smazaných řádků.
 */
export async function dropStaleLimitNotifications(db: Db, userId: string): Promise<number> {
  invalidateUserCache(userId);
  const pinned = new Set(Object.keys(await loadPinnedTaxYears(db, userId)));
  const stale = await db
    .select({ dedupeKey: notifications.dedupeKey })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), like(notifications.dedupeKey, 'limit|%')));
  const toDelete = stale
    .map((row) => row.dedupeKey)
    .filter((key) => !pinned.has(key.slice(key.lastIndexOf('|') + 1)));
  if (toDelete.length === 0) return 0;
  await db
    .delete(notifications)
    .where(and(eq(notifications.userId, userId), inArray(notifications.dedupeKey, toDelete)));
  return toDelete.length;
}
