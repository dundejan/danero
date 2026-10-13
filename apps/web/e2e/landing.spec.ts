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
  // odpovědi jsou přepínače pojmenované zněním otázky
  const question = (name: string | RegExp) => page.getByRole('group', { name });
  const answer = (name: string | RegExp, option: string) =>
    question(name).getByRole('button', { name: option, exact: true });
  const verdict = page.getByRole('status');
  const SALES = /akcie nebo ETF za víc než 100 000 Kč/;
  const SALES_HELD = 'Držel jsi všechny prodané kusy déle než 3 roky?';
  const CRYPTO = /kryptoměny za víc než 100 000 Kč/;
  const FLAT_TAX = 'Jsi v paušálním režimu?';

  // zaměstnanec s prodeji do 100 000 Kč → osvobozeno + zlaté pravidlo
  // (klepnutí před hydratací by propadlo)
  await (await hydrated(answer('Jsi zaměstnanec, nebo OSVČ?', 'Zaměstnanec'))).click();
  // na paušální režim se ptáme jen OSVČ
  await expect(question(FLAT_TAX)).toHaveCount(0);
  await answer(SALES, 'Ne').click();
  // krypto má vlastní limit — samostatná otázka
  await answer(CRYPTO, 'Ne').click();
  // zaměstnanec má navíc otázku na vedlejší příjmy — bez ní verdikt nepadá
  await answer(/vedle zaměstnání zdanitelné příjmy/, 'Ne').click();
  await expect(
    verdict.getByText('Vypadá to, že přiznání kvůli investicím řešit nemusíš.'),
  ).toBeVisible();
  await expect(
    verdict.getByText('Do 100 000 Kč tržeb z prodejů se daň z prodejů neřeší — vůbec.'),
  ).toBeVisible();

  // prodeje nad 100 000 Kč: dokud chybí odpověď na držení, verdikt není
  // a pozdější otázky čekají
  await answer(SALES, 'Ano').click();
  await expect(verdict).toContainText('Ukáže se tady, jakmile odpovíš na všechny otázky.');
  await expect(question(CRYPTO)).toHaveCount(0);
  // nic z toho tři roky nevydrželo → verdikt je jistý a dál se neptáme
  await answer(SALES_HELD, 'Žádné').click();
  await expect(verdict.getByText('Nejspíš podáš přiznání.')).toBeVisible();
  await expect(verdict.getByText('celá tržba, ne jen zisk')).toBeVisible();
  await expect(question(CRYPTO)).toHaveCount(0);

  // vydržela jen část → zbytek se přičítá až v otázce na ostatní příjmy;
  // dřívější odpověď na krypto zůstala
  await answer(SALES_HELD, 'Jen část').click();
  await expect(answer(CRYPTO, 'Ne')).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByText('Započítej celou tržbu (ne zisk) za akcie a ETF, které jsi nedržel déle než 3 roky.'),
  ).toBeVisible();
  await answer(/vedle zaměstnání zdanitelné příjmy/, 'Ano').click();
  await expect(verdict.getByText('Nejspíš podáš přiznání.')).toBeVisible();
  // část prodejů byla osvobozená tříletým testem → oznámení nad 5 milionů Kč
  await expect(verdict.getByText('ve lhůtě pro přiznání')).toBeVisible();

  // OSVČ mimo paušál podává přiznání tak jako tak — verdikt mluví o investicích v něm
  await answer('Jsi zaměstnanec, nebo OSVČ?', 'OSVČ').click();
  await expect(verdict).toContainText('Ukáže se tady, jakmile odpovíš na všechny otázky.');
  await answer(FLAT_TAX, 'Ne').click();
  await expect(verdict.getByText('Investice nejspíš patří do tvého přiznání.')).toBeVisible();
  await expect(
    verdict.getByText('Vycházíme z toho, že přiznání kvůli podnikání podáváš.'),
  ).toBeVisible();

  // paušalista: krypto nad 100 000 Kč má od 15. 2. 2025 vlastní tříletý test
  // (nález 2 daňového auditu) a prolomení limitu znamená i přehledy
  await answer(FLAT_TAX, 'Ano').click();
  await answer(CRYPTO, 'Ano').click();
  await answer('Držel jsi všechno prodané krypto déle než 3 roky?', 'Nic').click();
  await expect(verdict.getByText('Krypto jsi prodal nebo směnil za víc než 100 000 Kč')).toBeVisible();
  await expect(verdict.getByText('v paušálním režimu ale zůstáváš')).toBeVisible();
  await expect(
    verdict.getByText('Orientačně — přesně to spočítá aplikace z tvých dat.'),
  ).toBeVisible();
  // CTA přímo ve verdiktu (role=status) — akci nese verdikt, stránka závěr nemá
  await expect(verdict.getByRole('link', { name: 'Vyzkoušet demo', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Začít znovu' }).click();
  await expect(question(SALES)).toHaveCount(0);
  await expect(verdict).toContainText('Ukáže se tady, jakmile odpovíš na všechny otázky.');
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
