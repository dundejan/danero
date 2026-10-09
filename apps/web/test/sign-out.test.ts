import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { attemptSignOut, SIGN_OUT_FAILED_MESSAGE, SIGNED_OUT_PATH } from '@/lib/sign-out';

/**
 * L12-04: přihlašovací stránka se smí ukázat až po potvrzeném odhlášení.
 * Odpověď s chybou i výpadek sítě znamenají, že relace v prohlížeči trvá —
 * uživatel to musí vidět, jinak od sdíleného počítače odejde přihlášený.
 */
describe('odhlášení: přesměrovat až po potvrzení', () => {
  it('úspěšné odhlášení vede na přihlášení', async () => {
    const outcome = await attemptSignOut(() => Promise.resolve({ data: { success: true }, error: null }));
    expect(outcome).toEqual({ ok: true, redirectTo: '/prihlaseni' });
    expect(SIGNED_OUT_PATH).toBe('/prihlaseni');
  });

  it('odpověď 500 (výpadek databáze) nepřesměruje a ukáže hlášku', async () => {
    const outcome = await attemptSignOut(() =>
      Promise.resolve({ data: null, error: { status: 500, statusText: 'Internal Server Error' } }),
    );
    expect(outcome).toEqual({ ok: false, message: SIGN_OUT_FAILED_MESSAGE });
  });

  it('odpověď 429 (strop požadavků) nepřesměruje a ukáže hlášku', async () => {
    const outcome = await attemptSignOut(() =>
      Promise.resolve({ data: null, error: { status: 429, message: 'Too many requests.' } }),
    );
    expect(outcome).toEqual({ ok: false, message: SIGN_OUT_FAILED_MESSAGE });
  });

  it('výpadek sítě (výjimka) nepřesměruje, ukáže hlášku a výjimku nepustí dál', async () => {
    const outcome = await attemptSignOut(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(outcome).toEqual({ ok: false, message: SIGN_OUT_FAILED_MESSAGE });
  });

  it('odpověď, která nepřišla vůbec, není potvrzené odhlášení', async () => {
    expect(await attemptSignOut(() => Promise.resolve(undefined))).toEqual({
      ok: false,
      message: SIGN_OUT_FAILED_MESSAGE,
    });
    expect(await attemptSignOut(() => Promise.resolve(null))).toEqual({
      ok: false,
      message: SIGN_OUT_FAILED_MESSAGE,
    });
  });

  it('hláška říká, že přihlášení trvá', () => {
    expect(SIGN_OUT_FAILED_MESSAGE).toMatch(/nepodařilo/);
    expect(SIGN_OUT_FAILED_MESSAGE).toMatch(/přihlášení dál platí/);
  });
});

/**
 * Čistá funkce sama nic nezaručí, dokud ji tlačítko nepoužije. Strážce proto
 * čte zdrojáky: každé volání `authClient.signOut` v aplikaci musí jít přes
 * `attemptSignOut`, takže vedle něj nejde napsat přesměrování naslepo.
 */
describe('odhlášení: žádné volání mimo attemptSignOut', () => {
  const WEB_ROOT = resolve(import.meta.dirname, '..');
  const SOURCE_DIRS = ['app', 'components', 'lib'];
  const GUARDED_CALL = 'attemptSignOut(() => authClient.signOut())';

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(entry.name) ? [path] : [];
    });
  }

  it('authClient.signOut se volá jen uvnitř attemptSignOut', () => {
    const calls: Array<{ file: string; guarded: boolean }> = [];
    for (const dir of SOURCE_DIRS) {
      for (const file of sourceFiles(join(WEB_ROOT, dir))) {
        const source = readFileSync(file, 'utf8');
        const total = source.split('authClient.signOut').length - 1;
        if (total === 0) continue;
        const guarded = source.split(GUARDED_CALL).length - 1;
        calls.push({ file: relative(WEB_ROOT, file), guarded: guarded === total });
      }
    }
    // aspoň jedno volání existovat musí — jinak strážce hlídá prázdno
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((call) => !call.guarded).map((call) => call.file)).toEqual([]);
  });
});
