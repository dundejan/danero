import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth';

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
