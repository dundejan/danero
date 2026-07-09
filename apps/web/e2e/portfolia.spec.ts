import { expect, test } from '@playwright/test';
import { UNIVERSAL_TEMPLATE_CSV } from '../../../packages/importers/src/universal/csv';
import { registerWithProfile } from './helpers';

/**
 * Akceptace G8c: dvě portfolia počítají ODDĚLENĚ — vlastní transakce, profil
 * i limity; přepínač v liště přepíná celou aplikaci.
 */
test('portfolia: druhé portfolio je prázdné a počítá odděleně', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Portfolia', email: 'portfolia@danero.cz' });

  // data do výchozího portfolia
  await page.goto('/import');
  await page.locator('input[name="soubory"]').setInputFiles({
    name: 'moje.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(UNIVERSAL_TEMPLATE_CSV, 'utf8'),
  });
  await page.getByRole('button', { name: 'Nahrát výpisy' }).click();
  await expect(page.getByText('moje.csv')).toBeVisible();
  await page.goto('/prehled');
  await expect(page.getByText('Osvobození prodejů CP — 100 000 Kč')).toBeVisible();
  const usedBefore = await page.getByText(/transakcí/).textContent();
  expect(usedBefore).not.toContain(' 0 transakcí');

  // ── druhé portfolio ──────────────────────────────────────────────────────
  await page.goto('/nastaveni');
  await page.getByLabel('Nové portfolio').fill('Manželka');
  await page.getByRole('button', { name: 'Vytvořit' }).click();
  await expect(page.getByText('Portfolio vytvořeno a přepnuto')).toBeVisible();

  // nové portfolio nemá profil → nastavíme (jiný režim než výchozí)
  await page.getByLabel('Daňový režim').selectOption('ZAMESTNANEC');
  await page.getByRole('button', { name: 'Uložit profil' }).click();
  await page.waitForURL('**/prehled');

  // prázdný přehled — data prvního portfolia se NEsmí propsat
  await expect(page.getByText('Zatím žádná data')).toBeVisible();

  // přepínač zpět na výchozí portfolio → data jsou zase vidět
  await page.selectOption('#portfolio-switch', { label: 'Moje portfolio' });
  await expect(page.getByText('Osvobození prodejů CP — 100 000 Kč')).toBeVisible();
  await expect(page.getByText('Limit paušální daně — 50 000 Kč')).toBeVisible();

  // a v nastavení zůstal každému portfoliu vlastní režim
  await page.goto('/nastaveni');
  await expect(page.getByLabel('Daňový režim')).toHaveValue('PAUSAL');
});
