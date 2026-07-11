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

  // kotvy v hlavičce (Jak to funguje · Ceník · FAQ)
  await expect(page.locator('header').getByRole('link', { name: 'Ceník' })).toBeVisible();

  // ceník přímo na stránce — beta zdarma + cena po spuštění s měsíční kotvou
  await expect(page.getByRole('heading', { name: 'Teď v betě: všechno zdarma' })).toBeVisible();
  await expect(page.getByText('990 Kč ročně', { exact: true })).toBeVisible();
  await expect(page.getByText(/necelých 83 Kč měsíčně/)).toBeVisible();

  // FAQ: details/summary se dá rozkliknout
  const faq = page.locator('details', { hasText: 'Pro koho Danero je?' });
  await faq.locator('summary').click();
  await expect(faq.getByText(/OSVČ v paušálním režimu/)).toBeVisible();

  // FAQ: konec bety — bez karty se nic nestrhne
  const beta = page.locator('details', { hasText: 'Co se stane, až beta skončí?' });
  await beta.locator('summary').click();
  await expect(beta.getByText(/nic se nestrhne samo/)).toBeVisible();
});

test('podstránka /kalkulacka dává orientační verdikt', async ({ page }) => {
  await page.goto('/kalkulacka');

  // zaměstnanec s prodeji do 100 000 Kč → osvobozeno + zlaté pravidlo
  await page
    .getByRole('group', { name: 'Jsi zaměstnanec, OSVČ v paušálu, nebo jiné?' })
    .getByRole('button', { name: 'Zaměstnanec' })
    .click();
  const prodeje = page.getByRole('group', { name: /za víc než 100 000 Kč celkem/ });
  await prodeje.getByRole('button', { name: 'Ne', exact: true }).click();
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
