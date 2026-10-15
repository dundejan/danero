import { expect, test } from '@playwright/test';
import { registerAccount, waitForEmail } from './helpers';

/**
 * Bezpečnostní revize před propagací (15. 10. 2026): přesměrování na cizí
 * doménu, podvržená hlavička s adresou serveru a požadavek z cizího webu.
 * Revize 5 je v oddíle 8.3 nechala „neověřené“.
 *
 * Proč E2E, a ne Vitest: Better Auth kontrolu originu i `callbackURL` ve
 * Vitestu sám vypíná (`skipOriginCheck: isTest()`), takže by tam prošla
 * i děravá konfigurace. Tady jede skutečný dev server s konfigurací jako
 * v provozu. Relace, odkazy na obnovu a 2FA jsou v `test/session-security`
 * a `test/two-factor`, cizí data v `test/cross-tenant`.
 */

const APP = 'http://localhost:3210';

/** Cíle, které vypadají jako cesta v aplikaci, ale prohlížeč je otevře jinde. */
const FOREIGN_TARGETS = [
  'https://zly.example/past',
  '//zly.example/past',
  '/\\zly.example/past',
  'http://localhost:3210.zly.example/past',
  'javascript:alert(1)',
];

test.describe('přesměrování na cizí doménu (open redirect)', () => {
  for (const target of FOREIGN_TARGETS) {
    test(`registrace s callbackURL ${target} neprojde`, async ({ request }) => {
      const response = await request.post('/api/auth/sign-up/email', {
        headers: { origin: APP },
        data: {
          name: 'Přesměrování',
          email: `presmerovani-${FOREIGN_TARGETS.indexOf(target)}@danero.cz`,
          password: 'bezpecne-heslo-e2e',
          callbackURL: target,
        },
      });
      expect(response.status()).toBe(403);
    });
  }

  test('obnova hesla s redirectTo na cizí doménu neprojde', async ({ request }) => {
    for (const target of FOREIGN_TARGETS) {
      const response = await request.post('/api/auth/request-password-reset', {
        headers: { origin: APP },
        data: { email: 'presmerovani-obnova@danero.cz', redirectTo: target },
      });
      expect(response.status(), target).toBe(403);
    }
  });

  test('nový ověřovací odkaz s callbackURL na cizí doménu neprojde', async ({ request }) => {
    for (const target of FOREIGN_TARGETS) {
      const response = await request.post('/api/auth/send-verification-email', {
        headers: { origin: APP },
        data: { email: 'presmerovani-overeni@danero.cz', callbackURL: target },
      });
      expect(response.status(), target).toBe(403);
    }
  });

  test('ověřovací odkaz s podvrženým callbackURL nepřesměruje ven', async ({ request }) => {
    for (const target of FOREIGN_TARGETS) {
      const response = await request.get(
        `/api/auth/verify-email?token=neplatny&callbackURL=${encodeURIComponent(target)}`,
        { maxRedirects: 0 },
      );
      const location = response.headers()['location'] ?? '';
      expect(location, target).not.toContain('zly.example');
      expect(location, target).not.toMatch(/^javascript:/i);
    }
  });
});

/**
 * Kdo podvrhne hlavičku s adresou serveru, nesmí dostat odkaz z e-mailu na
 * svou doménu — oběť by na ni klikla a token z odkazu by přistál u něj.
 */
test('podvržená hlavička s adresou serveru nezmění odkazy v e-mailech (host header injection)', async ({
  page,
  request,
}) => {
  const email = 'bezpecnost-host@danero.cz';
  const forgedHeaders = {
    origin: APP,
    'x-forwarded-host': 'zly.example',
    'x-forwarded-proto': 'https',
    forwarded: 'host=zly.example;proto=https',
  };
  const linksIn = (text: string) => text.match(/https?:\/\/\S+/g) ?? [];

  const signUp = await request.post('/api/auth/sign-up/email', {
    headers: forgedHeaders,
    data: {
      name: 'Host',
      email,
      password: 'bezpecne-heslo-e2e',
      callbackURL: '/overeni-emailu/hotovo',
    },
  });
  expect(signUp.status()).toBe(200);
  const verification = await waitForEmail(page, email, (m) => /verify-email/.test(m.text));

  const reset = await request.post('/api/auth/request-password-reset', {
    headers: forgedHeaders,
    data: { email, redirectTo: '/nove-heslo' },
  });
  expect(reset.status()).toBe(200);
  const resetMessage = await waitForEmail(page, email, (m) => /reset-password/.test(m.text));

  for (const message of [verification, resetMessage]) {
    const links = linksIn(message.text);
    expect(links.length, message.subject).toBeGreaterThan(0);
    for (const link of links) {
      expect(link, message.subject).not.toContain('zly.example');
    }
    // odkaz s tokenem vede na instanci, ne kam ukázala hlavička
    const tokenLink = links.find((link) => /verify-email|reset-password/.test(link))!;
    expect(new URL(tokenLink).origin).toBe(APP);
  }
});

test('bezpečnostní hlavičky jsou na stránce i na API a framework se neprozrazuje', async ({
  request,
}) => {
  for (const path of ['/', '/prihlaseni', '/api/health']) {
    const headers = (await request.get(path)).headers();
    expect(headers['x-powered-by'], path).toBeUndefined();
    expect(headers['x-frame-options'], path).toBe('DENY');
    expect(headers['x-content-type-options'], path).toBe('nosniff');
    expect(headers['strict-transport-security'], path).toContain('max-age=');
    expect(headers['content-security-policy'], path).toContain("frame-ancestors 'none'");
  }
});

test.describe('požadavek z cizího webu s cookie přihlášeného (CSRF)', () => {
  test('cizí Origin neodhlásí ani nezmění heslo a relace žije dál', async ({ page }) => {
    const email = 'bezpecnost-csrf@danero.cz';
    await registerAccount(page, { name: 'CSRF', email });

    const signOut = await page.request.post('/api/auth/sign-out', {
      headers: { origin: 'https://zly.example' },
      data: {},
    });
    expect(signOut.status()).toBe(403);

    const changePassword = await page.request.post('/api/auth/change-password', {
      headers: { origin: 'https://zly.example' },
      data: {
        currentPassword: 'bezpecne-heslo-e2e',
        newPassword: 'heslo-od-utocnika-2026',
        revokeOtherSessions: true,
      },
    });
    expect(changePassword.status()).toBe(403);

    const session = await page.request.get('/api/auth/get-session');
    expect((await session.json())?.user?.email).toBe(email);
  });

  test('auto-save nastavení přijme jen požadavek z aplikace', async ({ page }) => {
    await registerAccount(page, { name: 'CSRF nastavení', email: 'bezpecnost-autosave@danero.cz' });

    const attempts: Record<string, string>[] = [
      { 'sec-fetch-site': 'cross-site', origin: 'https://zly.example' },
      { 'sec-fetch-site': 'same-site', origin: 'https://sub.localhost' },
      { origin: 'https://zly.example' },
      {},
    ];
    for (const headers of attempts) {
      const response = await page.request.post('/api/settings/profile', {
        headers,
        multipart: { rezim: 'PAUSAL' },
      });
      expect(response.status(), JSON.stringify(headers)).toBe(403);
    }
  });

  test('cookie relace je HttpOnly a SameSite=Lax', async ({ page, context }) => {
    await registerAccount(page, { name: 'Cookie', email: 'bezpecnost-cookie@danero.cz' });
    const session = (await context.cookies()).find((cookie) =>
      cookie.name.endsWith('session_token'),
    );
    expect(session).toBeDefined();
    expect(session!.httpOnly).toBe(true);
    expect(session!.sameSite).toBe('Lax');
    // Secure se v provozu odvozuje z https:// v BETTER_AUTH_URL (lib/auth.ts);
    // E2E jede na http://localhost, tam ho prohlížeč nastavit nemůže
  });
});
