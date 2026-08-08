import { describe, expect, it } from 'vitest';
import { signUpVerified } from './auth-helpers';

/**
 * D-3-01 a D-3-04: dvě výchozí HTTP cesty Better Authu, které Danero
 * nepoužívá a které z jedné ukradené session cookie dělají mnohem větší škodu.
 *
 * `/delete-user` — heslo je v Better Authu volitelné, stačí relace mladší
 * 24 h. Ověřeno naostro na danero.cz: prázdné tělo `{}` vrátilo
 * `200 {"success":true,"message":"User deleted"}` a účet zmizel včetně FK
 * kaskád, bez hesla i bez opsaného „SMAZAT“ a bez zrušení předplatného.
 *
 * `/list-sessions` — vrací syrové `token` všech relací uživatele, tedy přímo
 * hodnoty session cookies ostatních zařízení.
 *
 * Test jde přes `auth.handler` (HTTP router), protože právě tam `disabledPaths`
 * působí — a zároveň kontroluje, že serverová cesta `auth.api.*`, na které
 * stojí `deleteAccountAction`, funguje dál.
 */
describe('zavřené HTTP cesty Better Authu', () => {
  it(
    'mazání účtu a výpis relací přes /api/auth/* nejsou dostupné, serverové API ano',
    { timeout: 30_000 },
    async () => {
      process.env.PGLITE_DATA_DIR = ':memory:';
      const { getAuth } = await import('@/lib/auth');
      const auth = await getAuth();

      const email = 'zavrene-cesty@test.cz';
      const password = 'superbezpecneheslo';
      await signUpVerified(auth, { email, password, name: 'Jan' });
      const signIn = await auth.api.signInEmail({
        body: { email, password },
        asResponse: true,
      });
      const cookie = (signIn.headers.getSetCookie?.() ?? [])
        .map((c) => c.split(';')[0])
        .join('; ');
      expect(cookie).toContain('session_token');

      const volej = (path: string, init: RequestInit = {}) =>
        auth.handler(
          new Request(`http://localhost:3000/api/auth${path}`, {
            headers: { 'Content-Type': 'application/json', cookie, ...(init.headers ?? {}) },
            ...init,
          }),
        );

      // relace platí — kontrolní dotaz na cestu, která zavřená není
      expect((await volej('/get-session')).status).toBe(200);

      // ukradená cookie nesmí smazat účet ani vydat tokeny ostatních relací
      expect((await volej('/delete-user', { method: 'POST', body: '{}' })).status).toBe(404);
      expect((await volej('/list-sessions')).status).toBe(404);

      // účet po pokusu o smazání pořád existuje
      const { getDb } = await import('@/db');
      const { user } = await import('@/db/schema');
      const db = await getDb();
      expect((await db.select().from(user)).length).toBe(1);

      // serverová cesta, kterou používá deleteAccountAction, funguje dál —
      // jinak by oprava rozbila mazání účtu podle GDPR
      await auth.api.deleteUser({
        headers: new Headers({ cookie }),
        body: { password },
      });
      expect((await db.select().from(user)).length).toBe(0);
    },
  );
});
