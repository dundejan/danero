import { expect, test } from '@playwright/test';
import { UNIVERSAL_TEMPLATE_CSV } from '../../../packages/importers/src/universal/csv';
import { registerWithProfile } from './helpers';

/**
 * Akceptace G6+G7: smíšené portfolio (CP + krypto + deriváty) počítá druhy
 * ODDĚLENĚ — dashboard ukazuje obě odměrky 100k a report rozpad všech druhů.
 * Data = stažitelná univerzální šablona (AAPL, BTC i opce v 2026).
 */
test('krypto + deriváty: oddělené druhy § 10 na dashboardu a v reportu', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Krypto', email: 'krypto@danero.cz' });

  await page.goto('/import');
  await page.locator('input[name="soubory"]').setInputFiles({
    name: 'sablona-vyplnena.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(UNIVERSAL_TEMPLATE_CSV, 'utf8'),
  });
  await page.getByRole('button', { name: 'Nahrát výpisy' }).click();
  await expect(page.getByText('sablona-vyplnena.csv')).toBeVisible();

  // ── dashboard: dvě samostatné odměrky 100k ──────────────────────────────
  await page.goto('/prehled');
  await expect(page.getByText('Osvobození prodejů cenných papírů — 100 000 Kč')).toBeVisible();
  await expect(page.getByText('Osvobození krypta — 100 000 Kč')).toBeVisible();

  // ── report: § 10 s rozpadem CP + krypto + deriváty (druhy se nekompenzují) ──
  await page.goto('/report');
  await expect(page.getByText('Dílčí základ § 10 (součet druhů)')).toBeVisible();
  // H-3-03: interní kódy pravidel z UI zmizely — text musí zůstat srozumitelný
  // i bez nich (metodiku nese odkaz „Jak Danero počítá")
  // pomlčka odliší souhrnný řádek § 10 od vysvětlivek níž na stránce
  await expect(page.getByText(/— druhy se nekompenzují/)).toBeVisible();

  // ── deriváty (R-12): tabulka obchodů a řádek F v průvodci ────────────────
  await expect(page.getByText(/Derivátové obchody v roce \d{4}/)).toBeVisible();
  await expect(page.getByText('uzavření nakoupené pozice')).toBeVisible();
  await expect(page.getByText(/deriváty: plnění/)).toBeVisible();
});
