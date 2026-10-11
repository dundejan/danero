import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { UNIVERSAL_TEMPLATE_CSV } from '../../../packages/importers/src/universal/csv';
import { hydrated, registerWithProfile, selectLimit, uploadStatement } from './helpers';

/**
 * Šest dalších pozic v univerzální šabloně (kusy, ceny i data smyšlené).
 * Hledání, filtr a řazení se v portfoliu nabízejí až od sedmi pozic — s jedinou
 * pozicí z hlavní fixtury by nebylo co testovat.
 */
const [TEMPLATE_HEADER = ''] = UNIVERSAL_TEMPLATE_CSV.split('\n');
const templateRow = (fields: Record<string, string>): string =>
  TEMPLATE_HEADER.split(',')
    .map((column) => fields[column] ?? '')
    .join(',');
const buy = (
  date: string,
  isin: string,
  ticker: string,
  name: string,
  quantity: string,
  price: string,
  currency: string,
): string => templateRow({ type: 'BUY', date, isin, ticker, name, quantity, price, currency });
const MORE_POSITIONS = [
  TEMPLATE_HEADER,
  buy('2025-01-14', 'US5949181045', 'MSFT', 'Microsoft', '4', '410.00', 'USD'),
  buy('2025-03-20', 'IE00BK5BQT80', 'VWCE', 'Vanguard FTSE All-World', '12', '118.00', 'EUR'),
  buy('2025-06-05', 'CZ0005112300', 'ČEZ', 'ČEZ', '30', '1010.00', 'CZK'),
  buy('2025-09-11', 'US1912161007', 'KO', 'Coca-Cola', '15', '68.00', 'USD'),
  buy('2026-01-08', 'IE00B5BMR087', 'CSPX', 'iShares Core S&P 500', '2', '590.00', 'EUR'),
  buy('2026-02-17', 'US67066G1040', 'NVDA', 'Nvidia', '6', '132.00', 'USD'),
].join('\n');

/**
 * Akceptace G3: portfolio a grafy nad vlastními daty. Fixture: nákup 100 AAPL
 * (2024), prodej 50 (2026) → dashboard kreslí čerpání limitu, /portfolio ukazuje
 * pozice (bez cen — CSV import ceny nemá) a detail pozice nákupy s časovým testem.
 * Součástí jsou screenshoty dashboardu (desktop/mobil, light/dark).
 */
test('portfolio: přehled grafů → pozice → detail s nákupy (+ screenshoty)', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Portfolio', email: 'portfolio@danero.cz' });

  await page.goto('/import');
  const imported = await uploadStatement(page, join(__dirname, 'fixtures', 't212-vzorek.csv'));
  await expect(imported).toContainText('2 nové · 0 duplicit');
  const more = await uploadStatement(page, {
    name: 'dalsi-pozice.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(MORE_POSITIONS, 'utf8'),
  });
  await expect(more).toContainText('6 nových · 0 duplicit');

  // ── dashboard: graf čerpání limitu + horizont v2 ────────────────────────
  await page.goto('/prehled');
  // graf čerpání limitu 100 000 Kč patří k detailu limitu — ukáže ho výběr řádku
  const securities = await selectLimit(page, 'Osvobození prodejů cenných papírů');
  await expect(
    securities.getByRole('application', { name: /^Čerpání limitu 100 000 Kč v roce \d{4}/ }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Horizont osvobození' })).toBeVisible();
  // přepínač období: „1 rok“ přiblíží, „3 roky“ (výchozí) je zároveň úplný pohled
  const range = page.getByRole('group', { name: 'Období horizontu' });
  const oneYear = await hydrated(range.getByRole('button', { name: '1 rok' }));
  const threeYears = range.getByRole('button', { name: '3 roky' });
  await expect(threeYears).toHaveAttribute('aria-pressed', 'true');
  await oneYear.click();
  await expect(oneYear).toHaveAttribute('aria-pressed', 'true');
  await threeYears.click();
  await expect(threeYears).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({
    path: 'test-results/screenshots/prehled-desktop-light.png',
    fullPage: true,
  });

  // dark mode (next-themes: system) — emulace prefers-color-scheme
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({
    path: 'test-results/screenshots/prehled-desktop-dark.png',
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: 'light' });

  // mobil: obsah se vejde bez horizontálního scrollu stránky
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: 'test-results/screenshots/prehled-mobil.png', fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1280, height: 800 });

  // ── /portfolio: čestný stav bez cen, klíčová čísla, grafy vidět rovnou ──
  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: 'Portfolio' })).toBeVisible();
  await expect(page.getByText('Hodnotu zatím neznáme')).toBeVisible();
  await expect(
    page.getByText('Ceny bereme jen od připojeného brokera, z výpisů je nepoznáme.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Připojit brokera' })).toHaveAttribute(
    'href',
    '/import',
  );
  // bez cen se kusy různých titulů sčítat nedají: místo podílu portfolia stojí
  // počet pozic a výhrada, a křivka osvobozování se nekreslí vůbec (s cenami
  // ji hlídá demo.spec.ts)
  const exemptToday = page
    .getByRole('term')
    .filter({ hasText: 'Bez daně už dnes' })
    .locator('xpath=..');
  await expect(exemptToday.getByRole('definition').first()).toHaveText('0 z 7 pozic');
  await expect(exemptToday).toContainText('podíl bez cen neznáme');
  await expect(page.getByRole('heading', { name: 'Horizont osvobození' })).toHaveCount(0);
  await expect(page.getByText('Nejbližší osvobození')).toBeVisible();
  // Grafy nejsou schované v tabu — jsou vidět bez kliku.
  // Přes roli, ne přes text: graf má stejný název i jako přístupné jméno
  // v <title> uvnitř <svg>, takže `getByText` by našel dva prvky.
  await expect(page.getByRole('heading', { name: 'Realizovaný zisk a ztráta' })).toBeVisible();
  await expect(
    page.getByRole('application', { name: 'Realizovaný zisk a ztráta po letech' }),
  ).toBeVisible();

  // Koláč alokace zanikl; podíl na portfoliu nese řádek pozice, a bez cen od
  // brokera ho poctivě neukazuje vůbec — stejně jako sloupec Hodnota.
  await expect(page.getByRole('heading', { name: /^Pozice 7$/ })).toBeVisible();
  const table = page.getByRole('table', { name: 'Tabulka pozic' });
  await expect(table.locator('tbody tr')).toHaveCount(7);
  await expect(table.getByRole('columnheader', { name: /Hodnota/ })).toHaveCount(0);
  await expect(table.getByText(/\d\s%/)).toHaveCount(0);
  // řadicí hlavičky: bez cen je výchozí Další osvobození vzestupně (aria-sort),
  // takže nahoře je pozice, které test doběhne nejdřív
  await expect(table.getByRole('columnheader', { name: 'Další osvobození' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await expect(table.locator('tbody tr').first()).toContainText('AAPL');
  await page.screenshot({ path: 'test-results/screenshots/portfolio-desktop.png', fullPage: true });

  // ── detail pozice: nákupy, časové testy, odkaz do simulátoru ────────────
  // tabulka pozic je interaktivní (hledání/řazení) — pozici najdeme
  // vyhledáváním (a tím se rovnou testuje filtr)
  const search = await hydrated(page.getByPlaceholder('Hledat pozici…'));
  // hledání je bez diakritiky a case-insensitive — „aapl“ najde AAPL, „cez“ ČEZ
  await search.fill('aapl');
  await expect(table.getByRole('link', { name: 'AAPL' })).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await search.fill('cez');
  await expect(table.getByRole('link', { name: 'ČEZ' })).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  // hledání nesmyslu ukáže poctivý prázdný stav, smazání dotazu ho vrátí
  await search.fill('neexistujici-pozice');
  await expect(page.getByText('Nic nenalezeno pro „neexistujici-pozice“.')).toBeVisible();
  await search.fill('AAPL');
  // v širokém okně klepnutí řádek vybere a na detail vede inspektor vedle tabulky
  await table.getByRole('link', { name: 'AAPL' }).click();
  await page
    .getByRole('region', { name: 'Vybraná pozice: AAPL' })
    .getByRole('link', { name: 'Detail pozice' })
    .click();
  await page.waitForURL('**/portfolio/US0378331005');
  await expect(page.getByRole('heading', { name: /^Nákupy 1$/ })).toBeVisible();
  await expect(
    page.getByRole('table', { name: 'Nákupy a jejich časové testy' }).locator('tbody tr'),
  ).toHaveCount(1);
  await expect(page.getByRole('heading', { name: /^Historie 2$/ })).toBeVisible();
  const history = page.getByRole('list', { name: 'Historie transakcí' });
  await expect(history.getByText('Nákup 100 ks po 185,50 USD')).toBeVisible();
  await expect(history.getByText('Prodej 50 ks po 210,00 USD')).toBeVisible();
  await page.getByRole('link', { name: 'Simulovat prodej' }).click();
  await page.waitForURL('**/simulator?isin=US0378331005');
  await expect(page.getByRole('heading', { name: /^Simulátor \d{4}$/ })).toBeVisible();
  // pozice je předvybraná; cenu výpis nenese, takže ji simulátor chce doplnit
  await expect(page.getByRole('combobox', { name: 'Pozice' })).toHaveValue('US0378331005');
  await expect(page.getByRole('heading', { name: 'Zadej cenu za kus' })).toBeVisible();
});
