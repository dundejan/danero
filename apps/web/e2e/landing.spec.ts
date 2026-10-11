import { E2E_OPERATOR } from './operator';
import { expect, test } from '@playwright/test';
import { hydrated } from './helpers';

/**
 * Úvodní stránka: jediný h1 se dvěma sliby („bezpečně a zdarma“) doloženými
 * hned v perexu, živé komponenty počítané demo enginem (přehled s limity,
 * horizont, porovnání variant), pás „Proč je zdarma“ a CTA vedoucí rovnou do
 * dema bez registrace. FAQ a „Kdo za tím stojí“ mají vlastní podstránky.
 * Texty odpovídají deterministickému demo datasetu.
 */

test('landing: hero, živé komponenty a proč je zdarma', async ({ page }) => {
  await page.goto('/');

  // jediný h1 s hlavním sdělením
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toHaveCount(1);
  await expect(h1).toContainText('Hlídač daní z investic.');
  await expect(h1).toContainText('Bezpečně a zdarma.');

  // ověřitelná důvěra: obě slova z titulku perex hned dokládá faktem —
  // „bezpečně“ odkazem na to, jak se k brokerovi připojuje, „zdarma“ tím, že
  // placená verze neexistuje
  const hero = page.getByRole('region', { name: /^Hlídač daní z investic/ });
  await expect(hero.getByRole('link', { name: 'jen pro čtení' })).toHaveAttribute(
    'href',
    '/bezpecnost',
  );
  await expect(hero.getByText('Placenou verzi nemá a kartu po tobě nechce.')).toBeVisible();

  // živé odměrky limitů z demo enginu (50k prolomený, 100k těsně pod limitem):
  // řádek nese jméno limitu, čerpání a slovní stav
  await expect(
    hero.getByRole('button', { name: /^Limit paušální daně \d+\s% .* přes limit$/ }),
  ).toBeVisible();
  await expect(
    hero.getByRole('button', {
      name: /^Osvobození prodejů cenných papírů \d+\s% .* těsně pod limitem$/,
    }),
  ).toBeVisible();
  // detail vybraného limitu (celé znění s částkou) je živý kus aplikace —
  // výběr jiného řádku ho přepne
  await expect(
    hero.getByRole('region', { name: 'Limit paušální daně — 50 000 Kč' }).getByRole('heading'),
  ).toBeVisible();
  const securitiesRow = hero.getByRole('button', { name: /^Osvobození prodejů cenných papírů/ });
  await (await hydrated(securitiesRow)).click();
  await expect(
    hero
      .getByRole('region', { name: 'Osvobození prodejů cenných papírů — 100 000 Kč' })
      .getByRole('heading'),
  ).toBeVisible();

  // živý horizont osvobození (SVG pás s tečkami)
  await expect(page.locator('svg[aria-label="Horizont osvobození"]')).toBeVisible();

  // odkaz v hlavičce (menu: Platformy · Kalkulačka · Proč zdarma · Časté otázky)
  const nav = page.getByRole('banner').getByRole('navigation', { name: 'Hlavní navigace' });
  await expect(nav.getByRole('link', { name: 'Proč zdarma' })).toHaveAttribute('href', '/cenik');

  // proč je zdarma přímo na stránce — jedna odpověď, žádná cena k zaplacení.
  // Hledá se jen v tomhle pásu: zbytek stránky ukazuje živé částky z dema
  // a „12 490 Kč" v odměrce by test shodilo, i když se nic neprodává.
  const pricing = page.getByRole('region', { name: 'Proč je zdarma' });
  await expect(pricing.getByRole('heading', { name: 'Proč je zdarma' })).toBeVisible();
  await expect(pricing.getByText(/nic neprodává/)).toBeVisible();
  await expect(pricing.getByText(/\d\sKč/)).toHaveCount(0);

  // FAQ a autor na landingu nejsou — vedou na ně odkazy: podrobnosti a autor
  // z pásu „Proč je zdarma“, časté otázky z lišty
  await expect(pricing.getByRole('link', { name: 'Podrobněji' })).toHaveAttribute('href', '/cenik');
  await expect(pricing.getByRole('link', { name: 'Kdo za tím stojí' })).toHaveAttribute(
    'href',
    '/o-projektu',
  );
  await expect(nav.getByRole('link', { name: 'Časté otázky' })).toHaveAttribute(
    'href',
    '/caste-otazky',
  );
});

test('podstránka /caste-otazky: akordeon s odpověďmi', async ({ page }) => {
  await page.goto('/caste-otazky');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Časté otázky');

  // FAQ: details/summary se dá rozkliknout
  const faq = page.locator('details', { hasText: 'Pro koho je Danero?' });
  await expect(faq.getByText('OSVČ v paušálním režimu')).toBeHidden();
  await faq.locator('summary').click();
  await expect(faq.getByText('OSVČ v paušálním režimu')).toBeVisible();

  // FAQ: cena — zdarma celé, žádná placená verze
  const cena = page.locator('details', { hasText: 'Kolik Danero stojí?' });
  await cena.locator('summary').click();
  await expect(cena.getByText('Danero je zdarma celé a placená verze neexistuje')).toBeVisible();
});

test('podstránka /o-projektu: příběh, fotka a provozovatel', async ({ page }) => {
  await page.goto('/o-projektu');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Kdo za tím stojí');
  await expect(page.getByRole('img', { name: 'Jan Dunder — autor Danera' })).toBeVisible();
  // mailto je i v patičce — omezit na obsah stránky
  await expect(
    page.getByRole('main').getByRole('link', { name: E2E_OPERATOR.email }),
  ).toBeVisible();
  // údaje se berou z prostředí, takže se tu zároveň ověřuje, že tudy projdou
  await expect(page.getByText(new RegExp(`IČO\\s*${E2E_OPERATOR.ico}`))).toBeVisible();
});

test('podstránka /kalkulacka dává orientační verdikt', async ({ page }) => {
  await page.goto('/kalkulacka');

  // zaměstnanec s prodeji do 100 000 Kč → osvobozeno + zlaté pravidlo
  // (odpovědi jsou přepínače — klepnutí před hydratací by propadlo)
  const employee = page
    .getByRole('group', { name: 'Jsi zaměstnanec, OSVČ v paušálu, nebo jiné?' })
    .getByRole('button', { name: 'Zaměstnanec' });
  await (await hydrated(employee)).click();
  const prodeje = page.getByRole('group', { name: /akcie nebo ETF za víc než 100 000 Kč/ });
  await prodeje.getByRole('button', { name: 'Ne', exact: true }).click();
  // krypto má vlastní limit (a žádný časový test) — samostatná otázka
  await page
    .getByRole('group', { name: /kryptoměny za víc než 100 000 Kč/ })
    .getByRole('button', { name: 'Ne', exact: true })
    .click();
  // zaměstnanec má navíc otázku na vedlejší příjmy (20k) — bez ní verdikt nepadá
  await page
    .getByRole('group', { name: /vedle zaměstnání jiné zdanitelné příjmy/ })
    .getByRole('button', { name: 'Ne', exact: true })
    .click();
  const verdict = page.getByRole('status');
  await expect(
    verdict.getByText('Vypadá to, že přiznání kvůli investicím řešit nemusíš.'),
  ).toBeVisible();
  await expect(
    verdict.getByText('Do 100 000 Kč tržeb z prodejů se daň z prodejů neřeší — vůbec.'),
  ).toBeVisible();

  // neosvobozené prodeje (nad 100k, drženo méně než 3 roky) → verdikt se otočí
  await prodeje.getByRole('button', { name: 'Ano', exact: true }).click();
  await page
    .getByRole('group', { name: 'Držel jsi všechny prodané kusy déle než 3 roky?' })
    .getByRole('button', { name: 'Ne', exact: true })
    .click();
  await expect(verdict.getByText('Nejspíš podáš přiznání.')).toBeVisible();

  // krypto nad 100k má od 15. 2. 2025 vlastní tříletý test (nález 2 daňového auditu)
  await page
    .getByRole('group', { name: /kryptoměny za víc než 100 000 Kč/ })
    .getByRole('button', { name: 'Ano', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Držel jsi všechno prodané krypto déle než 3 roky?' })
    .getByRole('button', { name: 'Ne', exact: true })
    .click();
  await expect(
    verdict.getByText('kryptoaktiv nad 100 000 Kč ročně bez tří let držení'),
  ).toBeVisible();
  await expect(
    verdict.getByText('Orientačně — přesně to spočítá aplikace z tvých dat.'),
  ).toBeVisible();
  // CTA přímo ve verdiktu (role=status) — akci nese verdikt, stránka závěr nemá
  await expect(verdict.getByRole('link', { name: 'Vyzkoušet demo', exact: true })).toBeVisible();
});

test('landing: CTA vede rovnou do dema bez registrace', async ({ page }) => {
  await page.goto('/');
  // hlavní výzva první obrazovky; tutéž nese lišta a závěr stránky
  await page
    .getByRole('region', { name: /^Hlídač daní z investic/ })
    .getByRole('link', { name: 'Vyzkoušet demo', exact: true })
    .click();
  await page.waitForURL('**/demo/prehled');
  await expect(page.getByText('Prohlížíš demo s ukázkovými daty')).toBeVisible();

  // závěr stránky vede tamtéž a založení účtu nabízí bez přípony „zdarma“
  await page.goto('/');
  const closing = page.getByRole('region', { name: 'Vyzkoušet Danero' });
  await expect(closing.getByRole('link', { name: 'Vyzkoušet demo', exact: true })).toHaveAttribute(
    'href',
    '/demo/prehled',
  );
  await expect(closing.getByRole('link', { name: 'Založit účet', exact: true })).toHaveAttribute(
    'href',
    '/registrace',
  );
});
