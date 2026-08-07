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
  // bez čísla článku — viz poznámka u „Placené objednávky a odstoupení“ níž
  await expect(
    page.getByRole('heading', { name: /Na co se tyhle podmínky vztahují/ }),
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

/**
 * Distanční balíček (B-4 z docs/13): poučení o odstoupení, vzorový formulář
 * a povinná výslovná žádost o zahájení plnění u objednávky.
 *
 * E-3: obě věci, které jde koupit, se musí odlišit. Jednorázové podklady jsou
 * digitální obsah dodaný okamžitě (§ 1837 písm. l), roční hlídání je průběžně
 * poskytovaná služba — u ní právo odstoupit trvá a platí se jen poměrná část
 * (§ 1834, § 1837 písm. a). Text, který by ho rušil dopředu, by byl ujednáním,
 * ke kterému se nepřihlíží (§ 1812 odst. 2).
 */
test('poučení o odstoupení rozlišuje jednorázové podklady a roční předplatné', async ({ page }) => {
  await page.goto('/odstoupeni');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Odstoupení od smlouvy');

  // jednorázové podklady: právo zaniká dodáním
  await expect(page.getByRole('heading', { name: /Podklady k přiznání za jeden rok/ })).toBeVisible();
  await expect(page.getByText('§ 1837 písm. l')).toBeVisible();

  // roční hlídání: právo trvá, vrací se vše kromě poměrné části
  await expect(page.getByRole('heading', { name: /Celoroční hlídání/ })).toBeVisible();
  await expect(page.getByText('právo odstoupit do 14 dnů trvá i po zaplacení')).toBeVisible();
  await expect(page.getByText('§ 1834')).toBeVisible();
  await expect(page.getByText('§ 1837 písm. a')).toBeVisible();

  // vzorový formulář musí pokrýt obě situace
  const formular = page.locator('pre');
  await expect(formular).toContainText('Oznamuji, že tímto odstupuji od smlouvy');
  await expect(formular).toContainText('celoroční hlídání');
  await expect(formular).toContainText('podklady k přiznání za daňový rok');

  await page.goto('/podminky');
  // Nadpis se hledá BEZ čísla článku: přečíslování (doplnění nového článku výš)
  // není změna obsahu a nesmí shodit test. Přesně tohle se stalo, když
  // v podmínkách přibyl článek o funkčnosti digitálního obsahu (§ 1820/1 r).
  await expect(
    page.getByRole('heading', { name: /Placené objednávky a odstoupení/ }),
  ).toBeVisible();
  await expect(page.getByText('Ceny jsou konečné')).toBeVisible();
  // podmínky nesmí u předplatného tvrdit zánik práva podle písm. l
  await expect(page.getByText('poměrnou část za dny')).toBeVisible();
  await expect(page.getByText('o právo odstoupit tě nepřipraví')).toBeVisible();
});

/**
 * E-10 + E-13: hlídací e-maily jsou v tarifu 990 Kč — landing je nesmí slibovat
 * jako součást „zdarma navždy" (§ 5a z. 634/1992), a u cen musí zaznít, že jsou
 * konečné (Jan není plátce DPH).
 */
test('landing: hlídací e-maily jsou u placeného tarifu a ceny jsou konečné', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByText(/celoročním hlídáním za 990 Kč ročně ti navíc při 60, 85 a 100 % přijde e-mail/),
  ).toBeVisible();
  await expect(
    page.getByText(/s celoročním hlídáním ti navíc e-mail přijde 30 a 7 dní předem/),
  ).toBeVisible();
  await expect(page.getByText('Ceny jsou konečné.')).toBeVisible();
});

/**
 * C-10: horizont osvobození běží zdarma na /prehled — ceník ho nesmí prodávat
 * jako součást tarifu za 990 Kč.
 */
test('ceník: horizont osvobození je ve zdarma, ne v placeném tarifu', async ({ page }) => {
  await page.goto('/cenik');
  await expect(page.getByText('Horizont osvobození: kdy je co bez daně')).toBeVisible();
  await expect(page.getByText('Simulátor prodeje a horizont osvobození')).toHaveCount(0);
});

/**
 * E-9 + E-11: FAQ nesmí tvrdit, že se u předplatného nic nestrhne samo, ani že
 * zkušební podatelnou proženeme každé vygenerované XML.
 */
test('FAQ: automatická obnova přiznaná, EPO popsané pravdivě', async ({ page }) => {
  await page.goto('/caste-otazky');

  const cena = page.locator('details', { hasText: 'Co je zdarma a za co se platí?' });
  await cena.locator('summary').click();
  await expect(cena.getByText(/automaticky obnovuje/)).toBeVisible();
  await expect(cena.getByText(/Ceny jsou konečné/)).toBeVisible();
  await expect(page.getByText('nic se nestrhne samo')).toHaveCount(0);

  const epo = page.locator('details', { hasText: 'ověřeno zkušební podatelnou EPO' });
  await epo.locator('summary').click();
  await expect(epo.getByText(/Posíláme jí vzorová podání každého typu/)).toBeVisible();
  await expect(page.getByText('Každou vygenerovanou písemnost XML tam ověřujeme')).toHaveCount(0);
});
