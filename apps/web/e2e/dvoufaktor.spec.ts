import { expect, test, type Locator, type Page } from '@playwright/test';
import { totp } from '../test/totp-util';
import { hydrated, openDisclosure, registerWithProfile, signOut } from './helpers';

const HESLO = 'bezpecne-heslo-e2e';

/** Řádek „Dvoufaktorové ověření“ v Nastavení → Účet; formulář je až po rozbalení. */
const twoFactorRow = (page: Page): Promise<Locator> =>
  openDisclosure(page, 'Dvoufaktorové ověření');

/**
 * Tajemství pro autentikátor, jak ho uvidí člověk, kterému nejde naskenovat
 * QR kód: klíč pro ruční zadání i celá adresa jsou za „Nejde naskenovat?“.
 */
async function readManualSetup(row: Locator): Promise<{ totpUri: string; secret: string }> {
  await expect(row.getByRole('img', { name: 'QR kód pro autentikátor' })).toBeVisible();
  const manual = await openDisclosure(row, 'Nejde naskenovat?');
  const totpUri = await manual.getByText(/^otpauth:\/\/totp\//).innerText();
  const secret = /[?&]secret=([^&]+)/.exec(totpUri)?.[1];
  expect(secret).toBeTruthy();
  return { totpUri, secret: secret! };
}

/**
 * K2-01: záložní kódy 2FA šlo vygenerovat, ale ne použít.
 *
 * Aplikace při zapínání slibuje „každý funguje jednou, když přijdeš o telefon",
 * jenže přihlašovací krok měl jediné pole na šest číslic a volal výhradně
 * `verifyTotp` — kód tvaru `xxxxx-xxxxx` se do něj ani nevešel. Server přitom
 * `verify-backup-code` uměl celou dobu. Kdo přišel o telefon, přišel o účet
 * s daňovými daty: obnova hesla druhý faktor neobejde.
 */
test('2FA: kdo přišel o telefon, dostane se dovnitř záložním kódem', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Dvoufaktor', email: 'dvoufaktor@danero.cz' });

  // ── zapnutí 2FA ──────────────────────────────────────────────────────────
  await page.goto('/nastaveni/ucet');
  const row = await twoFactorRow(page);
  await expect(page.locator('summary').filter({ hasText: 'Dvoufaktorové ověření' })).toContainText(
    'Vypnuto',
  );
  await row.getByLabel('Heslo (pro potvrzení)').fill(HESLO);
  await (await hydrated(row.getByRole('button', { name: 'Zapnout ověření' }))).click();

  const { secret } = await readManualSetup(row);
  // L6b-03: klíč pro ruční zadání je vidět i zvlášť, ne jen uvnitř celé adresy
  await expect(row.getByText(secret, { exact: true })).toBeVisible();

  // záložní kódy si opíšeme hned — přesně jako uživatel, který poslechne úvodní větu
  const backupCodeSpans = page
    .locator('span')
    .filter({ hasText: /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/ });
  const backupCodes = await backupCodeSpans.allInnerTexts();
  expect(backupCodes.length).toBeGreaterThan(0);

  // L6b-06 a L7-06: kód opsaný tak, jak ho autentikátor ukazuje („123 456“), projde
  const firstCodeField = row.getByLabel('První kód z aplikace');
  await expect(firstCodeField).toHaveAttribute('autocomplete', 'one-time-code');
  const firstCode = totp(secret);
  await firstCodeField.fill(`${firstCode.slice(0, 3)} ${firstCode.slice(3)}`);
  await row.getByRole('button', { name: 'Dokončit zapnutí' }).click();
  await expect(row.getByText('Dvoufaktorové ověření je aktivní')).toBeVisible();

  // L6b-03: kódy po potvrzení nezmizí — kdo si je chtěl uložit až teď, ještě může
  await expect(backupCodeSpans).toHaveText(backupCodes);
  await expect(row.getByRole('button', { name: 'Zkopírovat' })).toBeVisible();

  // K4-04: zapnutí druhého faktoru musí být vidět v auditu účtu
  await page.reload();
  const activity = await openDisclosure(page, /^Poslední aktivita \(\d+\)$/);
  await expect(
    activity.getByRole('listitem').filter({ hasText: /^Zapnutí dvoufaktorového ověření/ }),
  ).toBeVisible();
  // stav je vidět už v zavřeném řádku
  await expect(page.locator('summary').filter({ hasText: 'Dvoufaktorové ověření' })).toContainText(
    'Zapnuto',
  );
  // po odchodu ze stránky už kódy nejsou odkud vzít — řádek řekne, jak získat nové
  const enabledRow = await twoFactorRow(page);
  await expect(backupCodeSpans).toHaveCount(0);
  await expect(enabledRow.getByText(/Záložní kódy už znovu neukážeme/)).toBeVisible();

  // ── ztráta telefonu: přihlášení záložním kódem ───────────────────────────
  await signOut(page);
  await page.getByLabel('E-mail').fill('dvoufaktor@danero.cz');
  await page.getByLabel('Heslo').fill(HESLO);
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(page.getByRole('heading', { name: 'Ověřovací kód' })).toBeVisible();
  await expect(page.getByLabel('Kód z autentikátoru')).toBeVisible();

  await page.getByRole('button', { name: 'Nemáš telefon? Zadej záložní kód' }).click();
  await expect(page.getByRole('heading', { name: 'Záložní kód' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Záložní kód' }).fill(backupCodes[0]!);
  await page.getByRole('button', { name: 'Přihlásit záložním kódem' }).click();
  await page.waitForURL('**/prehled');

  // každý kód funguje jednou — druhý pokus s týmž kódem musí skončit hláškou
  await page.goto('/nastaveni/ucet');
  await signOut(page);
  await page.getByLabel('E-mail').fill('dvoufaktor@danero.cz');
  await page.getByLabel('Heslo').fill(HESLO);
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await page.getByRole('button', { name: 'Nemáš telefon? Zadej záložní kód' }).click();
  await page.getByRole('textbox', { name: 'Záložní kód' }).fill(backupCodes[0]!);
  await page.getByRole('button', { name: 'Přihlásit záložním kódem' }).click();
  await expect(page.getByText(/Záložní kód nesedí/)).toBeVisible();
});

/**
 * L12-03: výpadek sítě nesmí formulář 2FA zamknout a mlčet.
 *
 * Tři handlery sekce na klienta jen čekaly — při nedoručeném požadavku zůstalo
 * tlačítko v „Připravuji…“ / „Ověřuji…“ / „Vypínám…“ bez hlášky a pomohlo jen
 * nové načtení stránky. U potvrzení prvním kódem to bylo nejhorší: po načtení
 * se vydá nové tajemství a už naskenovaný záznam v autentikátoru přestane platit.
 * Stejný vzor jako H2-01 u přihlášení (`heslo.spec.ts`).
 */
test('2FA: výpadek sítě formulář odemkne, řekne, co se stalo, a nastavení nezahodí', async ({
  page,
}) => {
  await registerWithProfile(page, {
    name: 'E2E Dvoufaktor Výpadek',
    email: 'dvoufaktor-vypadek@danero.cz',
  });
  const TWO_FACTOR_API = '**/api/auth/two-factor/**';
  // simulace výpadku: požadavek na 2FA se vůbec nedoručí
  const dropConnection = () => page.route(TWO_FACTOR_API, (route) => route.abort('failed'));
  const restoreConnection = () => page.unroute(TWO_FACTOR_API);

  // ── zapnutí ──────────────────────────────────────────────────────────────
  await page.goto('/nastaveni/ucet');
  const row = await twoFactorRow(page);
  const enable = await hydrated(row.getByRole('button', { name: 'Zapnout ověření' }));
  await dropConnection();
  await row.getByLabel('Heslo (pro potvrzení)').fill(HESLO);
  await enable.click();
  await expect(page.locator('#heslo-2fa-error')).toContainText('spojit se serverem');
  await expect(enable).toBeEnabled();

  // síť je zpět — tentýž formulář jde odeslat znovu, bez načítání stránky
  await restoreConnection();
  await row.getByLabel('Heslo (pro potvrzení)').fill(HESLO);
  await enable.click();
  const { totpUri, secret } = await readManualSetup(row);

  // ── potvrzení prvním kódem ───────────────────────────────────────────────
  await dropConnection();
  await row.getByLabel('První kód z aplikace').fill(totp(secret));
  await row.getByRole('button', { name: 'Dokončit zapnutí' }).click();
  await expect(page.locator('#kod-2fa-error')).toContainText('spojit se serverem');
  await expect(row.getByRole('button', { name: 'Dokončit zapnutí' })).toBeEnabled();
  // rozdělané nastavení zůstalo na obrazovce: totéž tajemství, které už je naskenované
  await expect(row.getByText(/^otpauth:\/\/totp\//)).toHaveText(totpUri);

  await restoreConnection();
  await row.getByLabel('První kód z aplikace').fill(totp(secret));
  await row.getByRole('button', { name: 'Dokončit zapnutí' }).click();
  await expect(row.getByText('Dvoufaktorové ověření je aktivní')).toBeVisible();

  // ── vypnutí ──────────────────────────────────────────────────────────────
  await page.reload();
  const enabledRow = await twoFactorRow(page);
  const disable = await hydrated(enabledRow.getByRole('button', { name: 'Vypnout ověření' }));
  await dropConnection();
  await enabledRow.getByLabel('Heslo (pro vypnutí)').fill(HESLO);
  await disable.click();
  await expect(page.locator('#heslo-2fa-off-error')).toContainText('spojit se serverem');
  await expect(disable).toBeEnabled();
});
