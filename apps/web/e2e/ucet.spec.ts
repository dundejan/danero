import { expect, test } from '@playwright/test';
import { UNIVERSAL_TEMPLATE_CSV } from '../../../packages/importers/src/universal/csv';
import { registerWithProfile } from './helpers';

const HESLO = 'bezpecne-heslo-e2e';
const NOVE_HESLO = 'jeste-bezpecnejsi-heslo';

/**
 * Akceptace G8a: změna hesla (ověřená přihlášením), export dat obsahuje
 * transakce, smazání účtu = data pryč a přihlášení nejde (GDPR /soukromi).
 */
test('účet: změna hesla → export dat → nevratné smazání', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Účet', email: 'ucet@danero.cz' });

  // data k exportu: univerzální šablona
  await page.goto('/import');
  await page.locator('input[name="soubory"]').setInputFiles({
    name: 'sablona.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(UNIVERSAL_TEMPLATE_CSV, 'utf8'),
  });
  await page.getByRole('button', { name: 'Nahrát výpisy' }).click();
  await expect(page.getByText('sablona.csv')).toBeVisible();

  // ── zabezpečení: sessions + audit (G8b) ──────────────────────────────────
  await page.goto('/nastaveni/ucet');
  await expect(page.getByText(/Aktivní přihlášení \(\d+\)/)).toBeVisible();
  await expect(page.getByText('toto zařízení')).toBeVisible();
  await expect(page.getByText('Přihlášení').first()).toBeVisible(); // audit LOGIN
  await expect(page.getByText('Import výpisu').first()).toBeVisible(); // audit IMPORT

  // ── změna hesla ──────────────────────────────────────────────────────────
  await page.getByLabel('Současné heslo').fill(HESLO);
  await page.getByLabel('Nové heslo (min. 10 znaků)').fill(NOVE_HESLO);
  await page.getByRole('button', { name: 'Změnit heslo' }).click();
  await expect(page.getByText('Heslo změněno')).toBeVisible();

  await expect(page.getByText('Změna hesla').first()).toBeVisible();

  // nové heslo funguje (odhlásit → přihlásit)
  await page.getByRole('button', { name: 'Odhlásit se' }).click();
  await page.waitForURL('**/prihlaseni');
  await page.getByLabel('E-mail').fill('ucet@danero.cz');
  await page.getByLabel('Heslo').fill(NOVE_HESLO);
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await page.waitForURL('**/prehled');

  // ── změna e-mailu (proti mrtvé konfiguraci — dřív padala vždy) ──────────
  await page.goto('/nastaveni/ucet');
  await page.getByLabel('Nový e-mail').fill('ucet-novy@danero.cz');
  await page.getByLabel('Heslo (potvrzení)').fill(NOVE_HESLO);
  await page.getByRole('button', { name: 'Změnit e-mail' }).click();
  await expect(page.getByText('E-mail změněn.')).toBeVisible();
  await expect(page.getByText('ucet-novy@danero.cz').first()).toBeVisible();

  // surový endpoint Better Auth je vypnutý — bez něj by session cookie stačila
  // k přepsání identity účtu bez hesla; jediná cesta je akce s re-autentizací
  const rawChange = await page.request.post('/api/auth/change-email', {
    data: { newEmail: 'utocnik@danero.cz' },
  });
  expect(rawChange.status()).toBe(403);

  // ── export dat: JSON s transakcemi ───────────────────────────────────────
  const exportResponse = await page.request.get('/api/export');
  expect(exportResponse.ok()).toBe(true);
  const exported = (await exportResponse.json()) as {
    format: string;
    user: { email: string };
    transactions: unknown[];
    brokerAccounts: Array<Record<string, unknown>>;
  };
  expect(exported.format).toBe('danero-export-v1');
  expect(exported.user.email).toBe('ucet-novy@danero.cz');
  expect(exported.transactions.length).toBeGreaterThanOrEqual(8);
  // API klíče se nikdy neexportují
  expect(JSON.stringify(exported.brokerAccounts)).not.toContain('encrypted');

  // ── smazání účtu ─────────────────────────────────────────────────────────
  await page.goto('/nastaveni/ucet');
  await page.getByLabel('Heslo', { exact: true }).fill(NOVE_HESLO);
  await page.getByLabel('Napiš SMAZAT').fill('SMAZAT');
  await page.getByRole('button', { name: 'Nevratně smazat účet' }).click();
  await page.waitForURL(/smazano=1/);
  await expect(page.getByText('Účet byl smazán.')).toBeVisible();

  // přihlášení už nejde — účet neexistuje
  await page.goto('/prihlaseni');
  await page.getByLabel('E-mail').fill('ucet-novy@danero.cz');
  await page.getByLabel('Heslo').fill(NOVE_HESLO);
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(page.getByText('Přihlášení se nepodařilo. Zkontroluj e-mail a heslo.')).toBeVisible();
  // export bez session vrací 401
  const after = await page.request.get('/api/export');
  expect(after.status()).toBe(401);
});

/**
 * L12-04: odhlášení, které server nepotvrdil, nesmí ukázat přihlašovací
 * stránku. Dřív se po chybě 500 (výpadek databáze, strop požadavků) rovnou
 * přesměrovalo na /prihlaseni, ač relace platila dál — na sdíleném počítači
 * by si další člověk otevřel cizí data napsáním adresy.
 */
test('odhlášení: po chybě serveru i výpadku sítě zůstane na stránce s hláškou', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Odhlášení', email: 'odhlaseni@danero.cz' });
  const failureMessage = page.getByText('Odhlásit se nepodařilo — tvoje přihlášení dál platí.');

  // ── server odpoví 500 ────────────────────────────────────────────────────
  await page.route('**/api/auth/sign-out', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }),
  );
  await page.getByRole('button', { name: 'Odhlásit se' }).click();
  await expect(failureMessage).toBeVisible();
  await expect(page).toHaveURL(/\/prehled$/);
  // relace opravdu trvá — chráněný export ji pořád pustí
  expect((await page.request.get('/api/export')).status()).toBe(200);
  await page.unroute('**/api/auth/sign-out');

  // ── požadavek se vůbec nedoručí ──────────────────────────────────────────
  await page.reload();
  await expect(failureMessage).toHaveCount(0);
  await page.route('**/api/auth/sign-out', (route) => route.abort('failed'));
  await page.getByRole('button', { name: 'Odhlásit se' }).click();
  await expect(failureMessage).toBeVisible();
  await expect(page).toHaveURL(/\/prehled$/);
  await page.unroute('**/api/auth/sign-out');

  // ── další pokus už projde: hláška zmizí a relace končí ───────────────────
  await page.getByRole('button', { name: 'Odhlásit se' }).click();
  await page.waitForURL('**/prihlaseni');
  expect((await page.request.get('/api/export')).status()).toBe(401);
});

/**
 * Danero je celé zdarma (podmínky 3.0): přihlášený uživatel má všechno
 * odemčené a nikde v aplikaci po něm nikdo nechce peníze. Do 8. 10. 2026 tu
 * stál test stránky Předplatné na instanci bez plateb.
 */
test('zdarma: nic není zamčené a staré stránky tarifů přesměrují', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Zdarma', email: 'zdarma@danero.cz' });

  // v navigaci aplikace už položka Předplatné není
  await expect(page.getByRole('link', { name: 'Předplatné' })).toHaveCount(0);

  // napojení brokera nabízí rovnou formulář na klíč, ne výzvu k objednání
  await page.goto('/import');
  await expect(page.getByRole('heading', { name: /Trading 212 — automatická synchronizace/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Objednat hlídání' })).toHaveCount(0);

  // hlídací e-maily jdou nastavit
  await page.goto('/nastaveni/upozorneni');
  await expect(page.getByText('Co ti teď chodí')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Objednat hlídání' })).toHaveCount(0);

  // odkazy ze starých e-mailů (potvrzení objednávky, upomínka) nekončí na 404
  await page.goto('/predplatne');
  await expect(page).toHaveURL(/\/cenik$/);
  await page.goto('/predplatne/podklady');
  await expect(page).toHaveURL(/\/cenik$/);
  await page.goto('/odstoupeni');
  await expect(page).toHaveURL(/\/podminky$/);
});
