import { expect, test } from '@playwright/test';

/** Veřejné obsahové stránky: Jak počítáme, Průvodce a Bezpečnost. */

test('/jak-pocitame a průvodce se vykreslí s obsahem', async ({ page }) => {
  await page.goto('/jak-pocitame');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Každé pravidlo má svůj paragraf',
  );
  await expect(page.getByText('Sporné výklady přiznáváme')).toBeVisible();

  await page.goto('/pruvodce');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('link', { name: /objem prodejů, ne zisk|Limit 100 000/ }).first().click();
  await page.waitForURL('**/pruvodce/limit-100-000-kc');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('100 000');
});

test('/bezpecnost je dostupná', async ({ page }) => {
  await page.goto('/bezpecnost');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Bereme to vážně');
  await expect(page.getByText('API klíče jen pro čtení', { exact: true })).toBeVisible();
});
