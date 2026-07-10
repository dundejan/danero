import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { registerWithProfile } from './helpers';

/**
 * Akceptace G3: portfolio a grafy nad vlastními daty. Fixture: nákup 100 AAPL
 * (2024), prodej 50 (2026) → dashboard kreslí čerpání limitu, /portfolio ukazuje
 * pozici (bez cen — CSV import ceny nemá) a detail pozice loty s časovým testem.
 * Součástí jsou screenshoty dashboardu (desktop/mobil, light/dark).
 */
test('portfolio: přehled grafů → pozice → detail s loty (+ screenshoty)', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Portfolio', email: 'portfolio@danero.cz' });

  await page.goto('/import');
  await page
    .locator('input[name="soubory"]')
    .setInputFiles(join(__dirname, 'fixtures', 't212-vzorek.csv'));
  await page.getByRole('button', { name: 'Nahrát výpisy' }).click();
  await expect(page.getByText('2 nové · 0 duplicit')).toBeVisible();

  // ── dashboard: graf čerpání limitu + horizont v2 ────────────────────────
  await page.goto('/prehled');
  await expect(page.getByText('Čerpání limitu 100 000 Kč v průběhu roku')).toBeVisible();
  await expect(page.getByText('Horizont osvobození')).toBeVisible();
  await page.getByRole('button', { name: 'vše' }).click();
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

  // ── /portfolio: čestný stav bez cen, 4 KPI karty, grafy vidět rovnou ────
  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: 'Portfolio' })).toBeVisible();
  await expect(page.getByText('Bez cen — ceny bereme jen z připojených brokerů')).toBeVisible();
  await expect(page.getByText('Bez daně už dnes')).toBeVisible();
  await expect(page.getByText('Nejbližší osvobození')).toBeVisible();
  // grafy už nejsou schované v tabu — jsou vidět bez kliku
  await expect(page.getByText('Osvobozování portfolia v čase')).toBeVisible();
  await expect(page.getByText('Realizovaný zisk/ztráta po letech')).toBeVisible();

  // Alokace (koláč) žije v sekci Pozice pod přepínačem Tabulka | Graf —
  // bez cen od brokera ukáže poctivý prázdný stav.
  // Retry-klik: tlačítko je v server-HTML dřív, než React připojí handler —
  // jediný klik by na pomalém CI mohl dopadnout do nehydratovaného DOMu.
  await expect(async () => {
    await page.getByRole('button', { name: 'Graf', exact: true }).click();
    await expect(page.getByText('Bez cen od brokera graf nesestavíme')).toBeVisible({
      timeout: 1500,
    });
  }).toPass();
  await page.screenshot({ path: 'test-results/screenshots/portfolio-desktop.png', fullPage: true });

  // ── detail pozice: loty, časové testy, odkaz do simulátoru ──────────────
  // tabulka pozic je interaktivní (hledání/řazení/stránkování) — s výchozím
  // řazením podle hodnoty nemusí být pozice na první stránce, proto ji najdeme
  // vyhledáváním (a tím se rovnou testuje filtr)
  await expect(async () => {
    await page.getByRole('button', { name: 'Tabulka' }).click();
    await expect(page.getByPlaceholder('Hledat pozici…')).toBeVisible({ timeout: 1500 });
  }).toPass();
  // hledání je bez diakritiky a case-insensitive — „aapl“ najde AAPL
  await page.getByPlaceholder('Hledat pozici…').fill('aapl');
  await expect(page.getByRole('link', { name: 'AAPL' }).first()).toBeVisible();
  // řadicí hlavičky: výchozí je Hodnota sestupně (aria-sort)
  await expect(page.getByRole('columnheader', { name: /Hodnota/ })).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  // hledání nesmyslu ukáže poctivý prázdný stav, smazání dotazu ho vrátí
  await page.getByPlaceholder('Hledat pozici…').fill('neexistujici-pozice');
  await expect(page.getByText('Nic nenalezeno pro „neexistujici-pozice“.')).toBeVisible();
  await page.getByPlaceholder('Hledat pozici…').fill('AAPL');
  await page.getByRole('link', { name: 'AAPL' }).first().click();
  await page.waitForURL('**/portfolio/US0378331005');
  await expect(page.getByText('Nákupy (loty) a časové testy')).toBeVisible();
  await expect(page.getByText('Historie (2)')).toBeVisible();
  await page.getByRole('link', { name: 'Simulovat prodej' }).click();
  await page.waitForURL('**/simulator?isin=US0378331005');
  await expect(page.getByRole('heading', { name: 'Simulátor prodeje' })).toBeVisible();
});
