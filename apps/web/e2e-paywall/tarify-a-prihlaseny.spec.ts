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
    // odsud vede k objednávce jediné kliknutí, ne další rozcestník
    await page.getByRole('link', { name: 'Objednat hlídání' }).click();
    await page.waitForURL('**/predplatne/hlidani');
    await expect(page.getByRole('button', { name: 'Objednat s povinností platby' })).toBeVisible();
  });

  /**
   * Objednávka má od 10. 8. 2026 vlastní stránku (dřív to byla kotva na
   * formulář pod kartami). Co musí být vidět PŘED odesláním, hlídá tenhle
   * test — v hlavní sadě běžet nemůže, tam se bez `DANERO_BILLING=stripe`
   * neprodává vůbec nic.
   */
  test('objednávka hlídání: podmínky vidět a bez souhlasu se nekupuje', async ({ page }) => {
    await registruj(page, 'objednavka');
    await page.goto('/predplatne');

    await page.getByRole('link', { name: 'Objednat hlídání' }).click();
    await page.waitForURL('**/predplatne/hlidani');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Celoroční hlídání');
    await expect(page.getByText(/990 Kč\s*\/ rok/)).toBeVisible();

    // § 1811/2 a § 1820/1 OZ: doba trvání a automatická obnova musí být vidět
    // PŘED objednávkou, ne až ve stavu „mám zaplaceno"
    await expect(page.getByText(/Předplatné trvá/)).toBeVisible();
    await expect(page.getByText(/automaticky obnovuje za 990 Kč/)).toBeVisible();
    await expect(page.getByText(/14 dní před obnovou/)).toBeVisible();
    await expect(page.getByText(/zrušit ji můžeš kdykoli v zákaznickém portálu/)).toBeVisible();
    await expect(page.getByText(/Ceny jsou konečné/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'poučení o odstoupení' })).toBeVisible();

    // § 1837 l OZ: souhlas se zahájením plnění je podmínka, ne kosmetika
    const souhlas = page.locator('#souhlas-predplatne');
    await expect(souhlas).not.toBeChecked();
    await expect(souhlas).toHaveAttribute('required', '');

    const objednat = page.getByRole('button', { name: 'Objednat s povinností platby' });
    // Tailwind v4 zrušil `cursor: pointer` v preflightu (v3 ho dával), takže nad
    // KAŽDÝM tlačítkem v aplikaci stála obyčejná šipka. Vrací to `globals.css`.
    await expect(objednat).toHaveCSS('cursor', 'pointer');
    // odeslání bez zaškrtnutí prohlížeč nepustí — zůstáváme na stránce
    await objednat.click();
    await expect(page).toHaveURL(/\/predplatne\/hlidani/);

    await page.getByRole('link', { name: 'Zpět na předplatné' }).click();
    await page.waitForURL('**/predplatne');
  });

  test('objednávka podkladů nabízí rok a hlásí meze XML', async ({ page }) => {
    await registruj(page, 'podklady');
    await page.goto('/predplatne');

    await page.getByRole('link', { name: 'Koupit podklady' }).click();
    await page.waitForURL('**/predplatne/podklady');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Podklady za rok');
    await expect(page.getByLabel('Daňový rok')).toBeVisible();
    // E-3-04: omezení plnění musí padnout před platbou
    await expect(page.getByText(/XML pro elektronické podání umíme/)).toBeVisible();
    await expect(page.locator('#souhlas-podklady')).toHaveAttribute('required', '');
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
