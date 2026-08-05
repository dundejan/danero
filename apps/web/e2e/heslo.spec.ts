import { expect, test } from '@playwright/test';
import { linkFromEmail, registerWithProfile } from './helpers';

/**
 * Potvrzení e-mailu při registraci a samoobslužná obnova hesla. Testy jdou
 * skutečnou cestou přes odkaz z e-mailu (Playwright ho čte z DANERO_EMAIL_LOG),
 * ne obcházením ověření.
 */

test('nepotvrzený účet se nepřihlásí a umí si nechat poslat nový odkaz', async ({ page }) => {
  const email = 'nepotvrzeny@danero.cz';

  await page.goto('/registrace');
  await page.getByLabel('Jméno').fill('E2E Nepotvrzený');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Heslo').fill('bezpecne-heslo-e2e');
  await page.getByRole('button', { name: 'Vytvořit účet' }).click();

  // registrace nepřihlašuje — rozcestník s výzvou k potvrzení
  await page.waitForURL('**/overeni-emailu**');
  await expect(page.getByRole('heading', { name: 'Potvrď svůj e-mail' })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();

  // aplikace za přihlášením zůstává zavřená
  await page.goto('/prehled');
  await page.waitForURL('**/prihlaseni');

  // přihlášení nepustí, ale pošle nový odkaz
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Heslo').fill('bezpecne-heslo-e2e');
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(page.getByText('Účet ještě není potvrzený.')).toBeVisible();

  // odkaz z e-mailu ověří adresu a rovnou přihlásí
  await page.goto(await linkFromEmail(page, email));
  await page.waitForURL('**/vitejte');
});

test('obnova zapomenutého hesla přes odkaz v e-mailu', async ({ page }) => {
  const email = 'zapomnel@danero.cz';
  const noveHeslo = 'uplne-nove-heslo-2026';
  await registerWithProfile(page, { name: 'E2E Zapomněl', email });

  await page.getByRole('button', { name: 'Odhlásit se' }).click();
  await page.waitForURL('**/prihlaseni');

  await page.getByRole('link', { name: 'Zapomněl jsi heslo?' }).click();
  await page.waitForURL('**/zapomenute-heslo');
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('button', { name: 'Poslat odkaz' }).click();
  await expect(page.getByText('Pokud u nás účet s touhle adresou je')).toBeVisible();

  await page.goto(await linkFromEmail(page, email));
  await page.waitForURL('**/nove-heslo**');
  await page.getByLabel('Nové heslo (min. 10 znaků)').fill(noveHeslo);
  await page.getByLabel('Nové heslo ještě jednou').fill(noveHeslo);
  await page.getByRole('button', { name: 'Nastavit heslo' }).click();
  await expect(page.getByText('Heslo je změněné.')).toBeVisible();

  // nové heslo funguje, staré ne
  await page.goto('/prihlaseni');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Heslo').fill('bezpecne-heslo-e2e');
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(page.getByText('Přihlášení se nepodařilo.')).toBeVisible();

  await page.getByLabel('Heslo').fill(noveHeslo);
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await page.waitForURL('**/prehled');
});

test('formulář obnovy neprozradí, jestli účet existuje', async ({ page }) => {
  await page.goto('/zapomenute-heslo');
  await page.getByLabel('E-mail').fill('takovy-ucet-neexistuje@danero.cz');
  await page.getByRole('button', { name: 'Poslat odkaz' }).click();
  // stejná odpověď jako u existujícího účtu (viz test výše)
  await expect(page.getByText('Pokud u nás účet s touhle adresou je')).toBeVisible();
});

test('vypršelý ověřovací odkaz nabídne poslat nový', async ({ page }) => {
  await page.goto('/overeni-emailu?error=TOKEN_EXPIRED');
  await expect(page.getByRole('heading', { name: 'Odkaz už neplatí' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Poslat odkaz znovu' })).toBeVisible();
});
