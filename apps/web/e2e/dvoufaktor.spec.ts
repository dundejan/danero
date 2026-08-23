import { expect, test } from '@playwright/test';
import { totp } from '../test/totp-util';
import { registerWithProfile } from './helpers';

const HESLO = 'bezpecne-heslo-e2e';

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
  await page.getByLabel('Heslo (pro potvrzení)').fill(HESLO);
  await page.getByRole('button', { name: 'Zapnout 2FA' }).click();

  const totpUri = await page.getByText(/^otpauth:\/\/totp\//).innerText();
  const secret = /[?&]secret=([^&]+)/.exec(totpUri)?.[1];
  expect(secret).toBeTruthy();

  // záložní kódy si opíšeme dřív, než obrazovka zmizí — přesně jako uživatel
  const backupCodes = await page
    .locator('span')
    .filter({ hasText: /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/ })
    .allInnerTexts();
  expect(backupCodes.length).toBeGreaterThan(0);

  await page.getByLabel('První kód z aplikace').fill(totp(secret!));
  await page.getByRole('button', { name: 'Dokončit zapnutí' }).click();
  await expect(page.getByText('Dvoufaktorové ověření je aktivní')).toBeVisible();

  // K4-04: zapnutí druhého faktoru musí být vidět v auditu účtu
  await page.reload();
  await expect(page.getByText('Zapnutí dvoufaktorového ověření').first()).toBeVisible();

  // ── ztráta telefonu: přihlášení záložním kódem ───────────────────────────
  await page.getByRole('button', { name: 'Odhlásit se' }).click();
  await page.waitForURL('**/prihlaseni');
  await page.getByLabel('E-mail').fill('dvoufaktor@danero.cz');
  await page.getByLabel('Heslo').fill(HESLO);
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(page.getByLabel('Kód z autentikátoru')).toBeVisible();

  await page.getByRole('button', { name: 'Nemáš telefon? Zadej záložní kód' }).click();
  await page.getByLabel('Záložní kód').fill(backupCodes[0]!);
  await page.getByRole('button', { name: 'Přihlásit záložním kódem' }).click();
  await page.waitForURL('**/prehled');

  // každý kód funguje jednou — druhý pokus s týmž kódem musí skončit hláškou
  await page.goto('/nastaveni/ucet');
  await page.getByRole('button', { name: 'Odhlásit se' }).click();
  await page.waitForURL('**/prihlaseni');
  await page.getByLabel('E-mail').fill('dvoufaktor@danero.cz');
  await page.getByLabel('Heslo').fill(HESLO);
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await page.getByRole('button', { name: 'Nemáš telefon? Zadej záložní kód' }).click();
  await page.getByLabel('Záložní kód').fill(backupCodes[0]!);
  await page.getByRole('button', { name: 'Přihlásit záložním kódem' }).click();
  await expect(page.getByText('Záložní kód nesedí')).toBeVisible();
});
