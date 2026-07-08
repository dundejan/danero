import { expect, test } from '@playwright/test';
import { UNIVERSAL_TEMPLATE_CSV } from '../../../packages/importers/src/universal/csv';
import { registerWithProfile } from './helpers';

/**
 * Akceptace G6: smíšené portfolio (CP + krypto) počítá oba limity 100k
 * ODDĚLENĚ a dashboard ukazuje obě sady odměrek. Data = stažitelná univerzální
 * šablona (obsahuje AAPL prodej i BTC prodej v 2026).
 */
test('krypto: oddělené limity CP × krypto na dashboardu a v reportu', async ({ page }) => {
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
  await expect(page.getByText('Osvobození prodejů CP — 100 000 Kč')).toBeVisible();
  await expect(page.getByText('Osvobození krypta — 100 000 Kč')).toBeVisible();

  // ── report: § 10 s rozpadem CP + krypto (druhy se nekompenzují) ─────────
  await page.goto('/report');
  await expect(page.getByText('Dílčí základ § 10 (prodeje CP + krypto)')).toBeVisible();
  await expect(page.getByText(/druhy se nekompenzují \(R-10c\)/)).toBeVisible();
});
