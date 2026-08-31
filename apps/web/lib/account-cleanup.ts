import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { waitlist } from '@/db/schema';
import { revokePasswordResetTokens } from '@/lib/auth-hooks';

/**
 * Úklid po zrušení účtu — to, co cizí klíče nesmažou.
 *
 * Hard delete v Better Authu shodí `user` a s ním kaskádou profil, transakce,
 * šifrované broker klíče, joby i audit log. Dvě tabulky ale na `user_id`
 * navázané nejsou, takže je kaskáda nevidí:
 *
 * - **`verification`** (K4-07): nevyzvednutý odkaz na obnovu hesla si nese id
 *   smazaného uživatele a leží tam do vypršení (hodina) plus do nejbližšího
 *   úklidového cronu, tedy až 24 h navíc. Změřeno: po registraci je tabulka
 *   prázdná, řádek zakládá teprve žádost o reset — takže se maže právě ta
 *   jedna třída řádků (`reset-password:%` s hodnotou `userId`), 2FA ani nic
 *   jiného se to netýká.
 * - **`waitlist`** (K4-08): klíčem je e-mail. Zapsat se do listiny už nedá
 *   (je ze zavírací fáze) a /soukromi ji popisuje s vlastním právním základem,
 *   ale zároveň slibuje, že zrušení účtu smaže „všechna tvoje data“ — tak ať
 *   to platí bez výjimky, kterou by uživatel musel řešit e-mailem.
 *
 * Volat AŽ po úspěšném smazání účtu: dokud neprojde `deleteUser`, není ověřené
 * heslo, a špatné heslo nesmí nikomu shodit obnovu hesla ani adresu.
 */
export async function purgeAfterAccountDeletion(
  db: Db,
  account: { userId: string; email: string },
): Promise<void> {
  await revokePasswordResetTokens(db, account.userId);
  await db.delete(waitlist).where(eq(waitlist.email, account.email.toLowerCase()));
}
