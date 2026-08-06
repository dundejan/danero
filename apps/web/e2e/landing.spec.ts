import { expect, test } from '@playwright/test';

/**
 * Marketingová landing page: hero s jediným h1, živé komponenty počítané
 * demo enginem (odměrky, horizont), ceník a CTA vedoucí rovnou do dema
 * bez registrace. FAQ a „Kdo za tím stojí“ mají vlastní podstránky.
 * Texty odpovídají deterministickému demo datasetu.
 */

test('landing: hero, živé komponenty a ceník', async ({ page }) => {
  await page.goto('/');

  // jediný h1 s hlavním sdělením
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toHaveCount(1);
  await expect(h1).toContainText('Daně z investic hlídáme za tebe.');

  // řádek ověřitelné důvěry
  await expect(
    page.getByText('XML podání ověřená zkušební podatelnou EPO'),
  ).toBeVisible();
  await expect(page.getByText('Plné demo bez registrace')).toBeVisible();

  // živé odměrky limitů z demo enginu (50k prolomený, 100k těsně pod limitem)
  await expect(page.getByText('Limit paušální daně — 50 000 Kč')).toBeVisible();
  await expect(page.getByText(/% · přes limit/)).toBeVisible();
  await expect(page.getByText('Osvobození prodejů cenných papírů — 100 000 Kč')).toBeVisible();
  await expect(page.getByText(/% · těsně pod limitem/)).toBeVisible();

  // živý horizont osvobození (SVG pás s tečkami)
  await expect(page.locator('svg[aria-label="Horizont osvobození"]')).toBeVisible();

  // odkaz v hlavičce (menu: Platformy · Ceník · Časté otázky · O projektu)
  await expect(page.locator('header').getByRole('link', { name: 'Ceník' })).toBeVisible();

  // ceník přímo na stránce — free vrstva + obě placené ceny s měsíční kotvou
  await expect(
    page.getByRole('heading', { name: 'Zjistit, jak na tom jsi, je zdarma' }),
  ).toBeVisible();
  await expect(page.getByText('490 Kč', { exact: true })).toBeVisible();
  await expect(page.getByText('990 Kč ročně', { exact: true })).toBeVisible();
  await expect(page.getByText(/necelých 83 Kč měsíčně/)).toBeVisible();

  // FAQ a autor už na landingu nejsou — vedou na ně odkazy u závěrečného CTA
  // (exact: true — jinak se název case-insensitivně sveze i s odkazy v hlavičce a patičce)
  await expect(page.getByRole('link', { name: 'časté otázky', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'kdo za Danerem stojí' })).toBeVisible();
});

test('podstránka /caste-otazky: akordeon s odpověďmi', async ({ page }) => {
  await page.goto('/caste-otazky');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Časté otázky');

  // FAQ: details/summary se dá rozkliknout
  const faq = page.locator('details', { hasText: 'Pro koho je Danero?' });
  await faq.locator('summary').click();
  await expect(faq.getByText(/OSVČ v paušálním režimu/)).toBeVisible();

  // FAQ: přechod na placené — účet je bez karty, ale předplatné se obnovuje
  // samo (E-11: dřív tu stálo „nic se nestrhne samo" hned vedle ceny 990 Kč)
  const cena = page.locator('details', { hasText: 'Co je zdarma a za co se platí?' });
  await cena.locator('summary').click();
  await expect(cena.getByText(/Účet založíš zdarma a bez karty/)).toBeVisible();
  await expect(cena.getByText(/automaticky obnovuje/)).toBeVisible();
});

test('podstránka /o-projektu: příběh, fotka a provozovatel', async ({ page }) => {
  await page.goto('/o-projektu');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Kdo za tím stojí');
  await expect(page.getByRole('img', { name: 'Jan Dunder — autor Danera' })).toBeVisible();
  // mailto je i v patičce — omezit na obsah stránky
  await expect(
    page.getByRole('main').getByRole('link', { name: 'dunder.jan@gmail.com' }),
  ).toBeVisible();
  await expect(page.getByText(/IČO\s*19642661/)).toBeVisible();
});

test('podstránka /kalkulacka dává orientační verdikt', async ({ page }) => {
  await page.goto('/kalkulacka');

  // zaměstnanec s prodeji do 100 000 Kč → osvobozeno + zlaté pravidlo
  await page
    .getByRole('group', { name: 'Jsi zaměstnanec, OSVČ v paušálu, nebo jiné?' })
    .getByRole('button', { name: 'Zaměstnanec' })
    .click();
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
  await expect(
    page.getByText('Vypadá to, že přiznání kvůli investicím řešit nemusíš.'),
  ).toBeVisible();
  await expect(
    page.getByText('Do 100 000 Kč tržeb z prodejů se daň z prodejů neřeší — vůbec.'),
  ).toBeVisible();

  // neosvobozené prodeje (nad 100k, drženo méně než 3 roky) → verdikt se otočí
  await prodeje.getByRole('button', { name: 'Ano', exact: true }).click();
  await page
    .getByRole('group', { name: 'Držel jsi všechny prodané kusy déle než 3 roky?' })
    .getByRole('button', { name: 'Ne', exact: true })
    .click();
  await expect(
    page.getByText('Nejspíš podáš přiznání — Danero ti připraví podklady.'),
  ).toBeVisible();

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
    page.getByText(/kryptoaktiv nad 100 000 Kč ročně bez tří let držení/),
  ).toBeVisible();
  await expect(page.getByText('Orientačně — přesně to spočítá aplikace z tvých dat.')).toBeVisible();
  // CTA přímo ve verdikt-boxu (role=status) — na stránce je víc demo odkazů
  await expect(
    page.getByRole('status').getByRole('link', { name: 'Vyzkoušet demo', exact: true }),
  ).toBeVisible();
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
