import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONNECTION_ERROR_MESSAGE, settleAuthRequest } from '@/lib/auth-request';

/**
 * L12-03: formulář 2FA se při výpadku sítě zamkl navždy a nic neřekl.
 *
 * Klient Better Auth při nedoručeném požadavku NEvrací `{ error }`, ale odmítne
 * slib („TypeError: Failed to fetch“). Handlery v `two-factor-section.tsx` na to
 * neměly `try/catch/finally`, takže `setPending(false)` se neprovedlo a tlačítko
 * zůstalo v „Připravuji…“ bez hlášky. Rozhodnutí „server odpověděl × spojení
 * selhalo“ proto dělá čistá funkce, kterou jde ověřit i bez DOM.
 */
describe('settleAuthRequest — odpověď serveru × chyba spojení (L12-03)', () => {
  it('odmítnutý slib dá stav „chyba spojení“ a nic nevyhodí', async () => {
    const outcome = await settleAuthRequest(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(outcome).toEqual({ connected: false });
  });

  it('výjimku vyhozenou ještě před vznikem slibu bere stejně jako výpadek', async () => {
    const outcome = await settleAuthRequest<never>(() => {
      throw new Error('klient se nepodařilo sestavit');
    });
    expect(outcome).toEqual({ connected: false });
  });

  it('chybovou odpověď serveru předá beze změny — to není chyba spojení', async () => {
    const response = { data: null, error: { code: 'INVALID_PASSWORD', status: 400 } };
    const outcome = await settleAuthRequest(() => Promise.resolve(response));
    expect(outcome).toEqual({ connected: true, result: response });
  });

  it('úspěšnou odpověď předá beze změny', async () => {
    const response = { data: { totpURI: 'otpauth://totp/priklad', backupCodes: ['aaaaa-bbbbb'] }, error: null };
    const outcome = await settleAuthRequest(() => Promise.resolve(response));
    expect(outcome).toEqual({ connected: true, result: response });
  });

  it('hláška o spojení je táž věta, kterou říkají přihlašovací formuláře', () => {
    expect(CONNECTION_ERROR_MESSAGE).toBe(
      'Nepodařilo se spojit se serverem. Zkontroluj připojení a zkus to znovu.',
    );
    const authForm = readFileSync(join(import.meta.dirname, '..', 'components', 'auth-form.tsx'), 'utf8');
    expect(authForm).toContain(CONNECTION_ERROR_MESSAGE);
  });
});

/**
 * Strážce nad zdrojákem: webové testy nemají DOM, takže chování formuláře při
 * výpadku hlídá až E2E (`e2e/dvoufaktor.spec.ts`). Tady se chytá návrat vzoru,
 * který L12-03 způsobil — holé `await authClient…` v handleru bez záchytu.
 */
describe('two-factor-section.tsx — žádné volání klienta mimo settleAuthRequest (L12-03)', () => {
  const source = readFileSync(
    join(import.meta.dirname, '..', 'components', 'two-factor-section.tsx'),
    'utf8',
  );

  it('všechna tři volání 2FA jdou přes settleAuthRequest a tlačítko se odemyká ve finally', () => {
    const clientCalls = source.match(/authClient\.twoFactor\.\w+\(/g) ?? [];
    expect(clientCalls.sort()).toEqual([
      'authClient.twoFactor.disable(',
      'authClient.twoFactor.enable(',
      'authClient.twoFactor.verifyTotp(',
    ]);
    // holé čekání na klienta = odmítnutý slib proletí handlerem a formulář zamkne
    expect(source.match(/await\s+authClient\.[\w.]+/g) ?? []).toEqual([]);
    expect(/await settleAuthRequest\(/.test(source), 'čeká se přes settleAuthRequest').toBe(true);
    expect(
      /finally\s*\{\s*setPending\(false\);/.test(source),
      'tlačítko se odemyká ve finally',
    ).toBe(true);
    expect(
      source.includes('setError(CONNECTION_ERROR_MESSAGE)'),
      'výpadek spojení má vlastní hlášku',
    ).toBe(true);
  });
});
