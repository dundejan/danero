import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { registerWithProfile } from './helpers';

/**
 * Hlavní scénář (docs/09, G1): registrace → daňový profil → ruční import
 * fixtury → dashboard ukazuje limity → simulátor → report.
 * Fixture: nákup 100 AAPL (2024), prodej 50 (2026) → tržby ~230k CZK
 * přes limit 100k, zbývající pozice 50 ks.
 */
test('registrace → profil → import → přehled → simulátor → report', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Tester', email: 'zaklad@danero.cz' });

  // ── ruční import fixtury ────────────────────────────────────────────────
  await page.goto('/import');
  await page
    .locator('input[name="soubory"]')
    .setInputFiles(join(__dirname, 'fixtures', 't212-vzorek.csv'));
  await page.getByRole('button', { name: 'Nahrát výpisy' }).click();
  await expect(page.getByText('t212-vzorek.csv').first()).toBeVisible();
  await expect(page.getByText('2 nové · 0 duplicit')).toBeVisible();

  // ── dashboard: limity z reálných dat ────────────────────────────────────
  await page.goto('/prehled');
  await expect(page.getByRole('heading', { name: /Přehled \d{4}/ })).toBeVisible();
  await expect(page.getByText('Limit paušální daně — 50 000 Kč')).toBeVisible();
  await expect(page.getByText('Osvobození prodejů cenných papírů — 100 000 Kč')).toBeVisible();

  // ── simulátor: prodej 10 ks zbývajících AAPL ────────────────────────────
  await page.goto('/simulator');
  await page.locator('select[name="isin"]').selectOption({ index: 1 });
  await page.locator('input[name="kusy"]').fill('10');
  await page.locator('input[name="cena"]').fill('200');
  await page.getByRole('button', { name: 'Spočítat dopad' }).click();
  await expect(page.getByText('Verdikt')).toBeVisible();

  // ── report ──────────────────────────────────────────────────────────────
  await page.goto('/report');
  await expect(page.getByRole('heading', { name: /Daňový report \d{4}/ })).toBeVisible();
  await expect(page.getByText('Dílčí základ § 10 (součet druhů)')).toBeVisible();
  // G5: průvodce, tisk a EPO export (rok 2026 → poctivá hláška o struktuře)
  await expect(page.getByText('Průvodce: co kam zapsat v přiznání')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vytisknout / uložit PDF' })).toBeVisible();
  await expect(page.getByText('Export pro mojedane.cz')).toBeVisible();

  // ── auto-save nastavení: změny se ukládají bez tlačítek Uložit ──────────
  await page.goto('/nastaveni');
  // s existujícím profilem žádná tlačítka Uložit u profilu/metod/upozornění
  await expect(page.getByRole('button', { name: 'Uložit profil' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Uložit upozornění' })).toHaveCount(0);
  // změna selectu metody → uloží se hned, potvrzení toastem
  await page.getByLabel('Párování prodejů').selectOption('LIFO');
  await expect(page.getByText('Uloženo. Výpočty se přepočítají podle nového profilu.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Párování prodejů')).toHaveValue('LIFO');

  // přepnutí switche upozornění → taky auto-save
  await page.getByText('Posílat e-maily').click();
  await expect(page.getByText('Uloženo. E-maily se řídí novým nastavením.')).toBeVisible();
  await page.reload();
  await expect(page.locator('input[name="emailEnabled"]')).not.toBeChecked();
});
