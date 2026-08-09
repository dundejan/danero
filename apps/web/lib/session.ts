import { getSessionCookie } from 'better-auth/cookies';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { errorText, logEvent } from '@/lib/log';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  twoFactorEnabled: boolean;
}

/** Ochrana aplikačních stránek — bez session přesměruje na přihlášení. */
export async function requireUser(): Promise<SessionUser> {
  // headers() PŘED getAuth(): při prerenderu vyhodí dynamic bail-out dřív, než se sáhne na DB
  const requestHeaders = await headers();
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect('/prihlaseni');
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    twoFactorEnabled: Boolean(session.user.twoFactorEnabled),
  };
}

/**
 * Kdo je přihlášený, BEZ přesměrování — pro marketingové stránky, které mají
 * zůstat přístupné oběma (hlavička pak nabídne vstup do aplikace místo
 * registrace).
 *
 * Dvě opatrnosti, obě kvůli tomu, že tohle běží na veřejných stránkách:
 *
 *  1. Nejdřív se kouká POUZE na cookie (`getSessionCookie` nesahá na databázi).
 *     Nepřihlášený návštěvník — tedy naprostá většina provozu na ceníku
 *     a platformách — tak nevyvolá jediný dotaz do DB.
 *  2. Selhání se polyká. Marketingový web nesmí spadnout na 500 kvůli tomu,
 *     že zrovna nejde databáze; v nejhorším se návštěvník tváří jako
 *     nepřihlášený a uvidí registrační CTA.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const requestHeaders = await headers();
  if (!getSessionCookie(requestHeaders)) return null;
  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (!session) return null;
    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      twoFactorEnabled: Boolean(session.user.twoFactorEnabled),
    };
  } catch (error) {
    logEvent('warn', 'session.optional_failed', { error: errorText(error) });
    return null;
  }
}

/**
 * Better Auth API + hlavičky requestu pro server actions. headers() PŘED
 * getAuth() — při prerenderu vyhodí dynamic bail-out dřív, než se sáhne na DB
 * (stejný invariant jako requireUser výše).
 */
export async function authApi() {
  const requestHeaders = await headers();
  const auth = await getAuth();
  return { api: auth.api, requestHeaders };
}
