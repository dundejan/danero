/**
 * Odhlášení: rozhodnutí, co smí prohlížeč udělat po pokusu o odhlášení (L12-04).
 *
 * Dřív se výsledek volání klienta Better Auth nečetl a rovnou se přesměrovalo
 * na přihlášení. Když server odpověděl chybou (výpadek databáze, strop požadavků),
 * uživatel viděl přihlašovací formulář, a přitom jeho relace platila dál — na
 * sdíleném počítači si pak další člověk otevřel jeho data napsáním adresy.
 * Přihlašovací stránka se proto smí ukázat až po POTVRZENÉM odhlášení.
 *
 * Čistá funkce bez Reactu i bez klienta Better Auth, ať jde otestovat sama.
 */

/** Kam se jde po potvrzeném odhlášení. */
export const SIGNED_OUT_PATH = '/prihlaseni';

/** Hláška, když se odhlásit nepodařilo — musí říct, že přihlášení trvá. */
export const SIGN_OUT_FAILED_MESSAGE =
  'Odhlásit se nepodařilo — tvoje přihlášení dál platí. Zkus to prosím znovu.';

export type SignOutOutcome =
  | { ok: true; redirectTo: typeof SIGNED_OUT_PATH }
  | { ok: false; message: string };

/**
 * Zavolá odhlášení a řekne, jestli se povedlo.
 *
 * Neúspěch je odpověď s chybou (klient Better Auth ji vrací v `error`, třeba
 * u 500 nebo 429), odpověď, která nepřišla vůbec, a vyhozená výjimka (výpadek
 * sítě končí na `TypeError: Failed to fetch`). Ve všech třech případech server
 * odhlášení nepotvrdil, takže cookie relace v prohlížeči zůstala.
 */
export async function attemptSignOut(
  signOut: () => Promise<{ error?: unknown } | null | undefined>,
): Promise<SignOutOutcome> {
  try {
    const result = await signOut();
    if (!result || result.error) return { ok: false, message: SIGN_OUT_FAILED_MESSAGE };
    return { ok: true, redirectTo: SIGNED_OUT_PATH };
  } catch {
    return { ok: false, message: SIGN_OUT_FAILED_MESSAGE };
  }
}
