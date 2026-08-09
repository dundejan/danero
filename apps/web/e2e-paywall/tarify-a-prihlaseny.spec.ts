import { expect, test } from '@playwright/test';
import { registerWithProfile } from '../e2e/helpers';

/**
 * Placené CTA musí vést tam, kde se dá koupit, a přihlášený uživatel nesmí
 * na veřejných stránkách narazit na nabídku registrace.
 *
 * Nález z 9. 8. 2026: zamčené funkce sice byly označené, ale odkazovaly na
 * veřejný ceník — a ten přihlášenému nabízí jen „Založit účet". Uživatel se
 * tak k nákupu nedostal vůbec.
 */
test.describe('cesta k nákupu a přihlášený na marketingu', () => {
  const registruj = (page: Parameters<typeof registerWithProfile>[0], kdo: string) =>
    registerWithProfile(page, { name: `E2E Tarify ${kdo}`, email: `tarify-${kdo}@danero.cz` });

  test('zamčená funkce vede na /predplatne, ne do slepé uličky ceníku', async ({ page }) => {
    await registruj(page, 'cesta');
    await page.goto('/import');

    await page.getByRole('link', { name: 'Objednat hlídání' }).first().click();
    await page.waitForURL('**/predplatne');
    // a rovnou tu je objednávkový formulář, ne další rozcestník
    await expect(page.getByRole('button', { name: 'Objednat s povinností platby' }).first()).toBeVisible();
  });

  test('/predplatne zrcadlí ceník a značí, co uživatel má', async ({ page }) => {
    await registruj(page, 'tarify');
    await page.goto('/predplatne');

    // tytéž tři tarify jako veřejný ceník
    for (const name of ['Zdarma', 'Podklady za rok', 'Celoroční hlídání']) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    }
    // uživatel bez nákupu má aktivní právě jeden tarif — ten zdarma
    await expect(page.getByText('Máš aktivní')).toHaveCount(1);
    await expect(page.getByLabel('Tarif Zdarma máš aktivní')).toBeVisible();
  });

  test('přihlášenému nabízí ceník aplikaci, ne registraci', async ({ page }) => {
    await registruj(page, 'cenik');
    await page.goto('/cenik');

    await expect(page.getByRole('link', { name: 'Založit účet' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Objednat v aplikaci' }).first()).toBeVisible();
    // hlavička i závěrečné CTA vedou do aplikace
    await expect(page.getByRole('link', { name: 'Přejít do aplikace' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Přihlásit se' })).toHaveCount(0);
  });

  test('přihlášený na landingu vidí vstup do aplikace', async ({ page }) => {
    await registruj(page, 'landing');
    await page.goto('/');

    await expect(page.getByRole('link', { name: 'Založit účet zdarma' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Přejít do aplikace' }).first()).toBeVisible();
  });

  test('nepřihlášený vidí na landingu pořád registraci', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Založit účet zdarma' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Přejít do aplikace' })).toHaveCount(0);
  });
});
