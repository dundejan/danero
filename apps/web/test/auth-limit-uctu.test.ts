import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_LIMITED_PATHS } from '@/lib/auth-hooks';
import { DISABLED_AUTH_PATHS } from '@/lib/auth';
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

/**
 * Nález revize R6 (č. 3): tři cesty Better Authu ověřovaly heslo a strop na
 * účet neměly — `/verify-password`, `/two-factor/get-totp-uri`
 * a `/two-factor/generate-backup-codes`. Naměřeno: 12 z 12 špatných hesel
 * skončilo na 400, žádná 429; druhá se správným heslem vydá tajemství TOTP,
 * třetí přegeneruje záložní kódy. Z unesené relace tedy tentýž neomezený
 * password oracle, kvůli kterému strop na účet vznikl.
 *
 * Aplikace žádnou z nich nevolá (zapnutí 2FA vrací adresu i záložní kódy
 * samo), takže jsou zavřené — HTTP router na ně odpovídá 404.
 */
describe('cesty ověřující heslo, které aplikace nepoužívá, jsou zavřené (R6)', () => {
  const CLOSED = ['/verify-password', '/two-factor/get-totp-uri', '/two-factor/generate-backup-codes'];

  it('s platnou relací odpovídají 404 — na ověření hesla vůbec nedojde', { timeout: 60_000 }, async () => {
    process.env.PGLITE_DATA_DIR = ':memory:';
    const { getAuth } = await import('@/lib/auth');
    const auth = await getAuth();

    const email = 'zavrene-cesty@test.cz';
    const password = 'superbezpecneheslo';
    await signUpVerified(auth, { email, password, name: 'Jan' });
    const signIn = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    const cookie = (signIn.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    expect(cookie).toContain('session_token');

    const attempt = (path: string, body: object, order: number): Promise<Response> =>
      auth.handler(
        new Request(`http://localhost/api/auth${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie,
            'x-forwarded-for': `203.0.113.${order}`,
          },
          body: JSON.stringify(body),
        }),
      );

    for (const path of CLOSED) {
      const statuses: number[] = [];
      for (let order = 1; order <= 12; order += 1) {
        statuses.push((await attempt(path, { password: `spatne-heslo-${order}` }, order)).status);
      }
      // ani jeden pokus se nedostal k heslu (400 INVALID_PASSWORD by byl oracle)
      expect(statuses, path).toEqual(Array(12).fill(404));
      // a nepomůže ani správné heslo
      expect((await attempt(path, { password }, 99)).status, path).toBe(404);
    }

    // srovnání: cesta, kterou aplikace používá, heslo ověřuje, ale se stropem na účet
    const limited: number[] = [];
    for (let order = 1; order <= 7; order += 1) {
      limited.push((await attempt('/two-factor/enable', { password: `spatne-${order}` }, order)).status);
    }
    expect(limited.slice(0, 5).every((status) => status !== 429 && status !== 404)).toBe(true);
    expect(limited.slice(5)).toEqual([429, 429]);
  });

  it('seznam zavřených cest je v nastavení Better Authu', () => {
    for (const path of CLOSED) expect(DISABLED_AUTH_PATHS).toContain(path);
  });
});

/**
 * Hlídač pro příští povýšení Better Authu: každá cesta, která v nainstalované
 * verzi ověřuje heslo přihlášeného uživatele, musí být zavřená, nebo mít strop
 * na účet. Čte se zdroják knihovny — nová cesta s ověřením hesla tak shodí
 * tenhle test dřív, než se dostane ven jako další oracle.
 */
describe('každá cesta Better Authu, která ověřuje heslo, má strop nebo je zavřená (R6)', () => {
  const require = createRequire(import.meta.url);
  /** Soubory s cestami jádra a pluginu dvoufázového ověření (jiné pluginy nepoužíváme). */
  const routeFiles = (): string[] => {
    const root = dirname(require.resolve('better-auth'));
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(join(dir, entry.name))
          : entry.name.endsWith('.mjs')
            ? [join(dir, entry.name)]
            : [],
      );
    return [...walk(join(root, 'api', 'routes')), ...walk(join(root, 'plugins', 'two-factor'))];
  };
  const VERIFIES_PASSWORD = /validatePassword\(|checkPassword\(|password\.verify\(/;

  /** Cesty, jejichž obsluha ověřuje heslo: úsek zdrojáku od jedné definice cesty k další. */
  const passwordPaths = (): string[] => {
    const found = new Set<string>();
    for (const file of routeFiles()) {
      const source = readFileSync(file, 'utf8');
      const starts = [...source.matchAll(/createAuthEndpoint\("(\/[^"]+)"/g)];
      starts.forEach((match, index) => {
        const body = source.slice(match.index, starts[index + 1]?.index ?? source.length);
        if (VERIFIES_PASSWORD.test(body)) found.add(match[1]!);
      });
    }
    return [...found].sort();
  };

  it('výčet z nainstalované verze je celý pokrytý', () => {
    const paths = passwordPaths();
    // sonda čte správné soubory: známé cesty v ní nesmí chybět
    expect(paths).toEqual(expect.arrayContaining(['/change-password', '/verify-password', '/sign-in/email']));

    /** Přihlášení má vlastní strop na adresu (`limitSignInAttempts`). */
    const OWN_LIMIT = new Set(['/sign-in/email']);
    const uncovered = paths.filter(
      (path) =>
        !OWN_LIMIT.has(path) &&
        !DISABLED_AUTH_PATHS.includes(path) &&
        !ACCOUNT_LIMITED_PATHS.includes(path),
    );
    expect(uncovered, `cesty ověřující heslo bez stropu: ${uncovered.join(', ')}`).toEqual([]);
  });
});
