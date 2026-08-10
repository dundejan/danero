import { describe, expect, it } from 'vitest';
import { signUpVerified } from './auth-helpers';

/**
 * D-3-02: citlivé operace musí mít strop i PER ÚČET, ne jen per IP.
 *
 * Vestavěné limity Better Authu se počítají podle IP adresy, kterou si klient
 * píše sám do `X-Forwarded-For`. Naměřeno při auditu: rotací téhle hlavičky
 * prošlo na `/api/auth/change-password` **25 z 25 pokusů, ani jedna 429**.
 * Z unesené relace tak byl neomezený password oracle — a uhádnuté heslo
 * znamená změnu e-mailu i vypnutí druhého faktoru.
 *
 * Test jde přes `auth.handler` (HTTP router) a KAŽDÝ pokus posílá z jiné
 * adresy, aby ukázal, že limit nestojí na IP.
 */
describe('per-účet strop citlivých operací (D-3-02)', () => {
  it(
    'opakovaná změna hesla z různých IP narazí na limit účtu',
    { timeout: 30_000 },
    async () => {
      process.env.PGLITE_DATA_DIR = ':memory:';
      const { getAuth } = await import('@/lib/auth');
      const auth = await getAuth();

      const email = 'limit-uctu@test.cz';
      const password = 'superbezpecneheslo';
      await signUpVerified(auth, { email, password, name: 'Jan' });
      const signIn = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
      const cookie = (signIn.headers.getSetCookie?.() ?? [])
        .map((c) => c.split(';')[0])
        .join('; ');
      expect(cookie).toContain('session_token');

      const zkusZmenuHesla = (poradi: number): Promise<Response> =>
        auth.handler(
          new Request('http://localhost/api/auth/change-password', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              cookie,
              // pokaždé jiná adresa — kdyby limit stál na IP, projde všechno
              'x-forwarded-for': `203.0.113.${poradi}`,
            },
            body: JSON.stringify({
              currentPassword: `spatne-heslo-${poradi}`,
              newPassword: 'jinesuperbezpecneheslo',
            }),
          }),
        );

      // strop je 5 pokusů v okně 5 minut (stejný jako u server action)
      const stavy: number[] = [];
      for (let i = 1; i <= 7; i += 1) stavy.push((await zkusZmenuHesla(i)).status);

      // prvních pět projde k ověření hesla (a selže na špatném heslu),
      // od šestého musí zasáhnout limit účtu
      expect(stavy.slice(0, 5).every((s) => s !== 429)).toBe(true);
      expect(stavy.slice(5)).toEqual([429, 429]);
    },
  );

  it(
    'cizí účet nejde vyčerpat zvenčí — bez relace se kbelík nezakládá',
    { timeout: 30_000 },
    async () => {
      process.env.PGLITE_DATA_DIR = ':memory:';
      const { getAuth } = await import('@/lib/auth');
      const auth = await getAuth();

      const bezRelace = async (): Promise<number> =>
        (
          await auth.handler(
            new Request('http://localhost/api/auth/change-password', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ currentPassword: 'x', newPassword: 'yyyyyyyyyy' }),
            }),
          )
        ).status;

      for (let i = 0; i < 8; i += 1) {
        // nepřihlášený požadavek končí na 401, ne na vyčerpaném limitu účtu
        expect(await bezRelace()).not.toBe(429);
      }
    },
  );
});
