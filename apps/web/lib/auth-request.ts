/**
 * Požadavek na Better Auth z formuláře: odpověděl server, nebo selhalo spojení?
 *
 * Klient Better Auth vrací chybu serveru jako `{ error }`, ale nedoručený
 * požadavek (výpadek sítě, spadlý server, blokovaný požadavek) skončí
 * ODMÍTNUTÝM slibem. Handler, který na klienta jen čeká, pak za `await` nikdy
 * nedojde: tlačítko zůstane zamčené, hláška žádná a pomůže jen nové načtení
 * stránky (H2-01 u přihlášení, L12-03 u dvoufaktorového ověření).
 *
 * Modul je schválně bez Reactu i bez klienta — rozhodnutí jde ověřit testem
 * v prostředí node (`test/auth-request.test.ts`).
 */

/** Hláška při selhaném spojení — stejná věta ve všech formulářích účtu. */
export const CONNECTION_ERROR_MESSAGE =
  'Nepodařilo se spojit se serverem. Zkontroluj připojení a zkus to znovu.';

export type AuthRequestOutcome<T> =
  /** Server odpověděl — i chybou; tu si formulář vyloží sám z `result.error`. */
  | { connected: true; result: T }
  /** Požadavek se nedoručil; o výsledku nevíme nic. */
  | { connected: false };

/**
 * Počká na požadavek a místo výjimky vrátí stav. Nikdy nevyhodí — ani když
 * `request` spadne dřív, než slib vůbec vznikne.
 */
export async function settleAuthRequest<T>(
  request: () => Promise<T>,
): Promise<AuthRequestOutcome<T>> {
  try {
    return { connected: true, result: await request() };
  } catch {
    return { connected: false };
  }
}
