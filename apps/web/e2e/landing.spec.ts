import { expect, test } from '@playwright/test';

/**
 * Marketingová landing page: hero s jediným h1, živé komponenty počítané
 * demo enginem (odměrky, horizont), ceník, FAQ a CTA vedoucí rovnou do dema
 * bez registrace. Texty odpovídají deterministickému demo datasetu.
 */

test('landing: hero, živé komponenty, ceník a FAQ', async ({ page }) => {
  await page.goto('/');

  // jediný h1 s hlavním sdělením
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toHaveCount(1);
  await expect(h1).toContainText('Daně z investic hlídáme za tebe.');

  // řádek ověřitelné důvěry
  await expect(page.getByText('XML ověřené testovací podatelnou EPO')).toBeVisible();
  await expect(page.getByText('Plné demo bez registrace')).toBeVisible();

  // živé odměrky limitů z demo enginu (50k prolomený, 100k těsně pod limitem)
  await expect(page.getByText('Limit paušální daně — 50 000 Kč')).toBeVisible();
  await expect(page.getByText(/% · přes limit/)).toBeVisible();
  await expect(page.getByText('Osvobození prodejů CP — 100 000 Kč')).toBeVisible();
  await expect(page.getByText(/% · těsně pod limitem/)).toBeVisible();

  // živý horizont osvobození (SVG pás s tečkami)
  await expect(page.locator('svg[aria-label="Horizont osvobození"]')).toBeVisible();

  // ceník přímo na stránce — beta zdarma + cena po spuštění
  await expect(page.getByRole('heading', { name: 'Teď v betě: všechno zdarma' })).toBeVisible();
  await expect(page.getByText('990 Kč ročně')).toBeVisible();

  // FAQ: details/summary se dá rozkliknout
  const faq = page.locator('details', { hasText: 'Pro koho Danero je?' });
  await faq.locator('summary').click();
  await expect(faq.getByText(/OSVČ v paušálním režimu/)).toBeVisible();
});

test('landing: CTA vede rovnou do dema bez registrace', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('link', { name: 'Vyzkoušet demo — bez registrace' })
    .first()
    .click();
  await page.waitForURL('**/demo/prehled');
  await expect(page.getByText('Prohlížíš demo s ukázkovými daty')).toBeVisible();
});
