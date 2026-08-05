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

/**
 * Otevřený kód je trust signál — musí být z webu poznat, a podmínky musí
 * oddělovat službu na danero.cz od softwaru pod AGPL (self-hoster nemá nárok
 * na to, co slibujeme my).
 */
test('otevřený kód: odkaz v patičce, sekce na /o-projektu i /bezpecnost', async ({ page }) => {
  await page.goto('/');
  const odkaz = page.locator('footer').getByRole('link', { name: 'Zdrojový kód' });
  await expect(odkaz).toHaveAttribute('href', 'https://github.com/dundejan/danero');

  await page.goto('/o-projektu');
  await expect(page.getByText('Danero si můžeš přečíst.')).toBeVisible();

  await page.goto('/bezpecnost');
  await expect(page.getByText('Nemusíš nám věřit — můžeš si to přečíst')).toBeVisible();
});

test('podmínky oddělují službu danero.cz od softwaru pod AGPL', async ({ page }) => {
  await page.goto('/podminky');
  await expect(
    page.getByRole('heading', { name: '2. Na co se tyhle podmínky vztahují' }),
  ).toBeVisible();
  await expect(page.getByText('Služba na danero.cz', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'GNU AGPL-3.0' })).toBeVisible();

  // vlastní instance nesmí spadat pod naše podmínky
  await expect(page.getByText('nevztahují', { exact: true })).toBeVisible();

  await page.goto('/soukromi');
  await expect(page.getByText('Do veřejných issue nikdy nevkládej výpis od brokera')).toBeVisible();
});

test('menu a patička: 4 položky menu, kalkulačka žije v patičce', async ({ page }) => {
  await page.goto('/');
  // menu po zeštíhlení (12. 7.): Platformy · Ceník · Časté otázky · O projektu
  const nav = page.locator('header nav');
  for (const label of ['Platformy', 'Ceník', 'Časté otázky', 'O projektu']) {
    await expect(nav.getByRole('link', { name: label })).toBeVisible();
  }
  await expect(nav.getByRole('link', { name: 'Kalkulačka' })).toHaveCount(0);

  // jediná garantovaná cesta ke kalkulačce je patička
  await page.locator('footer').getByRole('link', { name: 'Kalkulačka' }).click();
  await page.waitForURL('**/kalkulacka');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Musím kvůli investicím podat daňové přiznání?',
  );
});

test('/platformy a /cenik se vykreslí s obsahem', async ({ page }) => {
  await page.goto('/platformy');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('Trading 212').first()).toBeVisible();

  await page.goto('/cenik');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // tři tarify (docs/19): zdarma · jednorázové podklady · celoroční hlídání
  await expect(page.getByText('0 Kč', { exact: true })).toBeVisible();
  await expect(page.getByText('490 Kč', { exact: true })).toBeVisible();
  await expect(page.getByText(/990 Kč/).first()).toBeVisible();
  // free vrstva nesmí být omezená počtem platforem — limity se sčítají přes všechny
  await expect(page.getByText('Import výpisů — neomezeně platforem')).toBeVisible();
});
