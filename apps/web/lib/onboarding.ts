import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { transactions } from '@/db/schema';

/**
 * Cesta nového uživatele má dva kroky: daňový profil a data. Žádný stav
 * průvodce se neukládá — krok se odvozuje z toho, co v účtu je, takže jde
 * kdykoli odejít a vrátit se.
 */

/** Adresa kroku 2: Zdroje dat s potvrzením, že profil je uložený. */
export const ONBOARDING_DATA_URL = '/import?ulozeno=profil';

/** Má uživatel v Daneru aspoň jednu transakci? (Jeden řádek, ne celá historie.) */
export async function hasAnyTransaction(db: Db, userId: string): Promise<boolean> {
  const rows = await db
    .select({ dedupeKey: transactions.dedupeKey })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .limit(1);
  return rows.length > 0;
}

/**
 * Kam vede uložení daňového profilu.
 *
 * - Další uložení (profil už existoval) zůstává u formuláře s potvrzením —
 *   nastavení se ukládá samo při každé změně.
 * - První uložení bez dat pokračuje rovnou ke kroku 2. Dřív končilo na
 *   prázdném přehledu a k nahrání výpisu se šlo přes dvě mezistránky, které
 *   jen říkaly „pokračuj“ (R1B-05).
 * - První uložení účtu, který už data má (výpis nahrál dřív než profil),
 *   vede na přehled — ten už má co ukázat.
 */
export function afterProfileSaveUrl({
  firstSave,
  hasData,
}: {
  firstSave: boolean;
  hasData: boolean;
}): string {
  if (!firstSave) return '/nastaveni?ok=profil#dan';
  return hasData ? '/prehled' : ONBOARDING_DATA_URL;
}
