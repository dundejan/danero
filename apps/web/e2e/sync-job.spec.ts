import { expect, test } from '@playwright/test';
import { registerWithProfile } from './helpers';

/**
 * Akceptace G1: první plný sync běží jako background job s viditelným průběhem.
 * T212 API je lokální mock (playwright.config.ts) — plná historie: 2026 data,
 * 2025 prázdný, 2024 data, 2023+2022 prázdné → konec. Po dokončení se stránka
 * sama překreslí a ukáže výsledek rekonciliace.
 */
test('T212 sync jako job: připojení klíče → průběh po letech → výsledek', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Sync', email: 'sync@danero.cz' });

  // ── připojení T212 klíče (mock přijme cokoli) ───────────────────────────
  await page.goto('/nastaveni');
  await page.getByLabel('ID klíče API').fill('e2e-key-id');
  await page.getByLabel('Tajný klíč').fill('e2e-tajny-klic-12345');
  await page.locator('#trading212').getByRole('button', { name: 'Připojit' }).click();
  await page.waitForURL('**/import');

  // ── spuštění plné synchronizace — akce se vrátí hned, job běží na pozadí ─
  await page.getByRole('button', { name: 'Stáhnout kompletní historii' }).click();

  // průběh: fáze + stavy per rok (polling každé 3 s)
  await expect(
    page.getByText(/Synchronizace čeká ve frontě|Připojuji se k Trading212|Stahuji transakce/),
  ).toBeVisible();
  await expect(page.getByText('2026', { exact: true })).toBeVisible();

  // ── dokončení: stránka se překreslí, rekonciliace sedí ──────────────────
  await expect(page.getByText(/Pozice sedí s Trading212/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('t212-api-2026.csv')).toBeVisible();
  await expect(page.getByText('t212-api-2024.csv')).toBeVisible();

  // dashboard po syncu ukazuje data
  await page.goto('/prehled');
  await expect(page.getByRole('heading', { name: /Přehled \d{4}/ })).toBeVisible();
});
