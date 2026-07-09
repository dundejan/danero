import { expect, test } from '@playwright/test';

/** G9a: demo režim — plný přehled bez registrace, bez databáze. */
test('demo: přehled s ukázkovými daty bez přihlášení', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.getByText('Demo režim')).toBeVisible();
  await expect(page.getByText('Limit paušální daně — 50 000 Kč')).toBeVisible();
  await expect(page.getByText('Osvobození prodejů CP — 100 000 Kč')).toBeVisible();
  await expect(page.getByText('Osvobození krypta — 100 000 Kč')).toBeVisible();
  await expect(page.getByText('Orientační daň z investic')).toBeVisible();
  await expect(page.getByText('Horizont osvobození').first()).toBeVisible();
  // CTA vede na registraci
  await page.getByRole('link', { name: 'Chci to pro svoje portfolio' }).click();
  await page.waitForURL('**/registrace');
});

/** G9a: onboarding — registrace vede do průvodce, kroky se odvozují z dat. */
test('onboarding: registrace → průvodce → profil → výzva k datům', async ({ page }) => {
  await page.goto('/registrace');
  await page.getByLabel('Jméno').fill('E2E Onboarding');
  await page.getByLabel('E-mail').fill('onboarding@danero.cz');
  await page.getByLabel('Heslo').fill('bezpecne-heslo-e2e');
  await page.getByRole('button', { name: 'Vytvořit účet' }).click();
  await page.waitForURL('**/vitejte');

  await expect(page.getByText('Vítej v Daneru')).toBeVisible();
  await expect(page.getByText('Krok 1: Řekni nám, kdo jsi vůči dani')).toBeVisible();

  // vyplnění profilu → krok 2 (data)
  await page.getByRole('link', { name: 'Vyplnit daňový profil' }).click();
  await page.waitForURL('**/nastaveni');
  await page.getByRole('button', { name: 'Uložit profil' }).click();
  await page.waitForURL('**/prehled');
  await page.goto('/vitejte');
  await expect(page.getByText('Krok 2: Nahraj svoje obchody')).toBeVisible();
  await expect(page.getByText('Trading212 / IBKR API')).toBeVisible();
});
