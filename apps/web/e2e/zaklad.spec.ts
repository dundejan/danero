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
  await expect(page.getByText('2 nových · 0 duplicit')).toBeVisible();

  // ── dashboard: limity z reálných dat ────────────────────────────────────
  await page.goto('/prehled');
  await expect(page.getByRole('heading', { name: /Přehled \d{4}/ })).toBeVisible();
  await expect(page.getByText('Limit paušální daně — 50 000 Kč')).toBeVisible();
  await expect(page.getByText('Osvobození prodejů CP — 100 000 Kč')).toBeVisible();

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
  await expect(page.getByText('Dílčí základ § 10 (prodeje CP)')).toBeVisible();
  // G5: průvodce, tisk a EPO export (rok 2026 → poctivá hláška o struktuře)
  await expect(page.getByText('Průvodce: co kam zapsat v přiznání')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vytisknout / uložit PDF' })).toBeVisible();
  await expect(page.getByText('Export pro mojedane.cz')).toBeVisible();
});
