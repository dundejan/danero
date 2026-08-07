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

/**
 * H2-01: výpadek sítě nesmí zamknout formulář navždy a mlčet.
 *
 * `await authClient.signIn.email()` bez `try/catch` znamenalo, že při odmítnutém
 * požadavku promise rejectla, `setPending(false)` se nikdy neprovedlo a tlačítko
 * zůstalo v „Přihlašuji…“ bez jediné hlášky. Jediné východisko byl reload —
 * a uživatel nevěděl proč.
 */
test('výpadek sítě při přihlášení odemkne formulář a řekne, co se stalo', async ({ page }) => {
  await page.goto('/prihlaseni');
  // simulace výpadku: požadavek na auth se vůbec nedoručí
  await page.route('**/api/auth/**', (route) => route.abort('failed'));

  await page.getByLabel('E-mail').fill('kdokoli@danero.cz');
  await page.getByLabel('Heslo').fill('nejake-heslo-e2e');
  await page.getByRole('button', { name: 'Přihlásit se' }).click();

  // Chybová hláška formuláře, ne jakýkoli role="alert" — Next.js má vlastní
  // oznamovač routy (#__next-route-announcer__) se stejnou rolí a selektor by
  // byl dvojznačný.
  await expect(page.locator('#prihlaseni-error')).toContainText('spojit se serverem');
  // a formulář jde použít znovu
  await expect(page.getByRole('button', { name: 'Přihlásit se' })).toBeEnabled();
});
