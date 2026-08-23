import { and, eq, like } from 'drizzle-orm';
import type { Db } from '@/db';
import { brokerAccounts, importBatches, notifications, transactions } from '@/db/schema';
import { isSyncBatchFilename } from '@/lib/broker-sync';
import { forgetSyncProgressYears } from '@/lib/jobs';

/**
 * Vrácení jedné importní dávky — transakční část, bez autentizace.
 *
 * Žije mimo server action schválně: do 23. 8. 2026 měl test vlastní KOPII téhle
 * logiky a sám si u ní psal, že změnu v akci nechytí. Přesně takhle v tomhle
 * projektu propadl přejmenovaný sloupec T212 (zkopírovaná podmínka v detekci),
 * takže obojí teď volá tuhle jedinou funkci.
 *
 * Vrací `null`, když dávka uživateli nepatří nebo neexistuje.
 */
export async function undoImportBatch(
  db: Db,
  userId: string,
  batchId: string,
): Promise<{ filename: string; count: number } | null> {
  // jedna transakce: pád mezi mazáním transakcí a dávky by nechal osiřelé
  // řádky bez záznamu v historii, tedy data, ke kterým se uživatel nedostane
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .select({
        id: importBatches.id,
        filename: importBatches.filename,
        broker: importBatches.broker,
      })
      .from(importBatches)
      .where(and(eq(importBatches.id, batchId), eq(importBatches.userId, userId)));
    if (!batch) return null;
    const deleted = await tx
      .delete(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.batchId, batchId)))
      .returning({ dedupeKey: transactions.dedupeKey, txDate: transactions.txDate });
    // Upozornění hlídače na roky, kterých se to týkalo, přestala platit —
    // „limit překročen" by na přehledu viselo za obchody, které už neexistují,
    // a dedupe klíč by jeho přepočet napořád zablokoval. Smazané se založí
    // znovu při dalším běhu cronu, pokud pořád platí.
    const years = [...new Set(deleted.map((row) => row.txDate.slice(0, 4)))];
    for (const year of years) {
      await tx
        .delete(notifications)
        .where(and(eq(notifications.userId, userId), like(notifications.dedupeKey, `%|${year}`)));
    }
    await tx.delete(importBatches).where(eq(importBatches.id, batch.id));
    // Jen u dávky ze SYNCU: ať se smazaná historie dá zase stáhnout. U ručně
    // nahraného výpisu by to znamenalo zbytečné stahování celé historie
    // a účet by v UI vypadal jako nesynchronizovaný.
    if (isSyncBatchFilename(batch.filename)) {
      await tx
        .update(brokerAccounts)
        .set({ lastSyncedAt: null })
        .where(and(eq(brokerAccounts.userId, userId), eq(brokerAccounts.broker, batch.broker)));
      // ⚠️ Reset lastSyncedAt sám NESTAČÍ (K6a-01): plný sync si z posledního
      // spadlého jobu přečte, že vrácený rok už je „complete", a přeskočí ho.
      // Průběh se proto musí zneplatnit spolu s daty.
      await forgetSyncProgressYears(tx, userId, years.map(Number));
    }
    return { filename: batch.filename, count: deleted.length };
  });
}
