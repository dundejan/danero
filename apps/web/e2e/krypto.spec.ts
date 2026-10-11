import { expect, test } from '@playwright/test';
import { UNIVERSAL_TEMPLATE_CSV } from '../../../packages/importers/src/universal/csv';
import { registerWithProfile, selectLimit, uploadStatement } from './helpers';

/**
 * Akceptace G6+G7: smíšené portfolio (CP + krypto + deriváty) počítá druhy
 * ODDĚLENĚ — dashboard ukazuje obě odměrky 100k a report rozpad všech druhů.
 * Data = stažitelná univerzální šablona (AAPL, BTC i opce v 2026).
 */
test('krypto + deriváty: oddělené druhy § 10 na dashboardu a v reportu', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Krypto', email: 'krypto@danero.cz' });

  await page.goto('/import');
  await uploadStatement(page, {
    name: 'sablona-vyplnena.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(UNIVERSAL_TEMPLATE_CSV, 'utf8'),
  });

  // ── dashboard: dvě samostatné odměrky 100k ──────────────────────────────
  await page.goto('/prehled');
  const securities = await selectLimit(page, 'Osvobození prodejů cenných papírů');
  await expect(
    securities.getByRole('heading', { name: 'Osvobození prodejů cenných papírů — 100 000 Kč' }),
  ).toBeVisible();
  const crypto = await selectLimit(page, 'Osvobození krypta');
  await expect(
    crypto.getByRole('heading', { name: 'Osvobození krypta — 100 000 Kč' }),
  ).toBeVisible();

  // ── report: § 10 s rozpadem CP + krypto + deriváty (druhy se nekompenzují) ──
  await page.goto('/report');
  const taxBreakdown = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Výpočet daně' }) })
    .getByRole('listitem');
  await expect(taxBreakdown.filter({ hasText: /^Cenné papíry/ })).toBeVisible();
  await expect(taxBreakdown.filter({ hasText: /^Kryptoaktiva/ })).toBeVisible();
  // H-3-03: interní kódy pravidel z UI zmizely — text musí zůstat srozumitelný
  // i bez nich (metodiku nese odkaz „Jak Danero počítá")
  // souhrnný řádek říká přímo u čísla, že je to součet druhů bez kompenzace
  await expect(taxBreakdown.filter({ hasText: /^Základ daně z prodejů/ })).toContainText(
    'součet druhů, nekompenzují se',
  );

  // ── deriváty (R-12): tabulka obchodů a řádek derivátů ve výpočtu daně ────
  await expect(
    page.getByRole('heading', { name: /^Derivátové obchody v roce \d{4} \d+$/ }),
  ).toBeVisible();
  await expect(
    // podle role: na telefonu stojí tentýž text pod názvem instrumentu
    // (skrytý `span`), v širokém okně ve vlastním sloupci
    page
      .getByRole('table', { name: 'Rozpis derivátových obchodů' })
      .getByRole('cell', { name: 'uzavření nakoupené pozice' }),
  ).toBeVisible();
  await expect(taxBreakdown.filter({ hasText: /^Deriváty/ })).toContainText(/plnění [\d\s]+\sKč/);
  // a v Příloze č. 2 mají deriváty vlastní řádek (druh F)
  await expect(
    page
      .getByRole('table', { name: 'Příloha č. 2: příjmy a výdaje podle druhu' })
      .getByRole('row', { name: /^Deriváty/ }),
  ).toBeVisible();
});
