import { expect, test, type Page } from '@playwright/test';
import { hydrated, linkFromEmail, simulateSale } from './helpers';

/**
 * Demo prohlídka: návštěvník bez registrace vidí vizuálně totéž co přihlášený
 * uživatel — přehled, portfolio, detail pozice, simulátor i report nad
 * bohatými ukázkovými daty. Všude banner + CTA na registraci, nic se neukládá.
 */

/** Banner dema s CTA je na každé demo stránce. */
async function expectDemoBanner(page: Page) {
  const banner = page.getByRole('banner');
  await expect(banner.getByText('Prohlížíš demo s ukázkovými daty')).toBeVisible();
  await expect(banner.getByRole('link', { name: 'Založit účet' })).toBeVisible();
}

/** Sekce stránky podle jejího nadpisu (nadpis nese i tichý počet položek). */
const section = (page: Page, heading: string | RegExp) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: heading }) });

test('demo přehled: verdikt, odměrky, horizont, upozornění; rok-switcher', async ({ page }) => {
  // /demo (odkaz z landing page) → redirect na vstupní stránku prohlídky
  await page.goto('/demo');
  await page.waitForURL('**/demo/prehled');
  await expectDemoBanner(page);

  // mini patička s právními odkazy; pruh „Vyzkoušej si“ pod bannerem je pryč
  await expect(page.getByRole('navigation', { name: 'Prohlídka dema' })).toHaveCount(0);
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByRole('link', { name: 'Podmínky užití' })).toBeVisible();
  // výhrada je jeden krátký odkaz na článek podmínek, kde je závazné znění
  await expect(footer.getByRole('link', { name: 'Není daňové poradenství' })).toHaveAttribute(
    'href',
    '/podminky#co-danero-je',
  );

  // verdikt: prolomený limit 50k → „podáš přiznání“ a vedle něj číslo daně.
  // Demo platí paušální zálohy, takže hlavní číslo je doplatek; orientační daň
  // z investic je řádek rozpadu, ze kterého doplatek vzniká.
  await expect(page.getByRole('heading', { name: /podáš daňové přiznání/ })).toBeVisible();
  await expect(page.getByRole('term').filter({ hasText: 'Doplatek daně' })).toBeVisible();
  const breakdown = page.getByRole('list', { name: 'Z čeho se orientační daň z investic počítá' });
  await expect(
    breakdown.getByRole('listitem').filter({ hasText: /^Orientační daň z investic/ }),
  ).toHaveText(/\d\sKč$/);
  await expect(breakdown.getByRole('listitem').filter({ hasText: /^Doplatek daně/ })).toHaveText(
    /\d\sKč$/,
  );

  // odměrky limitů (50k prolomený, 100k CRITICAL, krypto OK): v seznamu jméno,
  // čerpání a slovní stav, celé znění s částkou v detailu vybraného řádku
  await expect(
    page.getByRole('button', { name: /^Limit paušální daně \d+\s% .* přes limit$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: /^Osvobození prodejů cenných papírů \d+\s% .* těsně pod limitem$/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Osvobození krypta \d+\s% .* v pořádku$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Limit paušální daně — 50 000 Kč' }).getByRole('heading'),
  ).toBeVisible();
  const cryptoRow = await hydrated(page.getByRole('button', { name: /^Osvobození krypta/ }));
  await cryptoRow.click();
  await expect(
    page.getByRole('region', { name: 'Osvobození krypta — 100 000 Kč' }).getByRole('heading'),
  ).toBeVisible();

  // horizont osvobození s tečkami (SVG pás)
  await expect(page.getByRole('heading', { name: 'Horizont osvobození' })).toBeVisible();
  await expect(page.locator('svg[aria-label="Horizont osvobození"]')).toBeVisible();

  // demo upozornění z hlídače (prolomený limit) — jen v sekci upozornění: týž
  // titulek nese i varování enginu v „Kontrolách výpočtu“. Limit se jmenuje
  // stejně jako v seznamu limitů (`lib/limit-names.ts`).
  await expect(
    section(page, 'Poslední upozornění').getByText(
      /Prolomen limit paušální daně \(50\s000\sKč\)/,
    ),
  ).toBeVisible();

  // rok-switcher: přepnutí na loňsko přes query param
  const heading = await page.getByRole('heading', { level: 1 }).textContent();
  const year = Number(heading?.match(/\d{4}/)?.[0]);
  await page
    .getByRole('navigation', { name: 'Zdaňovací období' })
    .getByRole('link', { name: String(year - 1) })
    .click();
  await page.waitForURL(`**/demo/prehled?rok=${year - 1}`);
  await expect(page.getByRole('heading', { name: `Přehled ${year - 1}` })).toBeVisible();
  await expectDemoBanner(page);
});

test('demo portfolio: hodnota, tabulka s hledáním, podíly, deriváty → detail pozice', async ({
  page,
}) => {
  await page.goto('/demo/portfolio');
  await expectDemoBanner(page);

  // KPI: hodnota portfolia je oceněná (žádné „—“)
  const value = page.getByRole('term').filter({ hasText: 'Hodnota portfolia' }).locator('xpath=..');
  await expect(value.getByRole('definition').first()).toHaveText(/^\d[\d\s]*\sKč$/);
  await expect(page.getByText('Nejbližší osvobození')).toBeVisible();

  // 50+ pozic: tabulka ukazuje prvních dvanáct a zbytek na požádání
  // (stránkování po deseti zaniklo)
  const positionsHeading = page.getByRole('heading', { name: /^Pozice 5\d$/ });
  await expect(positionsHeading).toBeVisible();
  const total = Number((await positionsHeading.textContent())?.match(/\d+/)?.[0]);
  const table = page.getByRole('table', { name: 'Tabulka pozic' });
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(12);
  await (await hydrated(page.getByRole('button', { name: `Zobrazit všech ${total}` }))).click();
  await expect(rows).toHaveCount(total);
  await page.getByRole('button', { name: 'Zobrazit méně' }).click();
  await expect(rows).toHaveCount(12);

  // řadicí hlavičky: s cenami je výchozí Hodnota sestupně (aria-sort)
  await expect(table.getByRole('columnheader', { name: /Hodnota/ })).toHaveAttribute(
    'aria-sort',
    'descending',
  );

  // tabulka pozic + hledání (najde Apple, schová VWCE)
  const search = page.getByRole('searchbox', { name: /Hledat pozici/ });
  await expect(table.getByRole('link', { name: 'VWCE' })).toBeVisible();
  await search.fill('apple');
  await expect(table.getByRole('link', { name: 'AAPL' })).toBeVisible();
  await expect(table.getByRole('link', { name: 'VWCE' })).toHaveCount(0);
  // hledání nesmyslu ukáže poctivý prázdný stav, smazání dotazu ho vrátí
  await search.fill('neexistujici-pozice');
  await expect(page.getByText('Nic nenalezeno pro „neexistujici-pozice“.')).toBeVisible();
  await search.fill('');

  // alokace: koláč zanikl, podíl na portfoliu nese řádek pozice
  const vwce = table.getByRole('row', { name: /^VWCE/ });
  await expect(vwce).toContainText(/ks · \d+(,\d)?\s%/);

  // otevřená opce v sekci derivátů
  await expect(page.getByRole('heading', { name: 'Otevřené deriváty' })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Otevřené derivátové pozice' }).getByText('Opce SPY put 560'),
  ).toBeVisible();

  // křivka osvobozování portfolia (bez cen se váží nabývací cenou —
  // portfolio.spec.ts)
  await expect(page.getByRole('heading', { name: 'Horizont osvobození' })).toBeVisible();
  await expect(
    page.getByRole('application', { name: 'Osvobozování portfolia v čase' }),
  ).toBeVisible();

  // detail pozice: v širokém okně klepnutí řádek jen vybere a detail nabízí
  // inspektor vedle tabulky (odkaz v řádku zůstává odkazem pro klávesnici
  // a nový panel)
  await vwce.getByRole('link', { name: 'VWCE' }).click();
  const inspector = page.getByRole('region', { name: 'Vybraná pozice: VWCE' });
  await expect(inspector.getByText(/\d+(,\d)?\s% portfolia/)).toBeVisible();
  await inspector.getByRole('link', { name: 'Detail pozice' }).click();
  await page.waitForURL('**/demo/portfolio/IE00BK5BQT80');
  await expectDemoBanner(page);
  // nákupy s časovými testy + historie + odkaz na simulátor
  await expect(page.getByRole('heading', { name: /^Nákupy \d+$/ })).toBeVisible();
  await expect(
    page
      .getByRole('table', { name: 'Nákupy a jejich časové testy' })
      .getByRole('cell', { name: 'už bez daně' })
      .first(),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Historie \d+$/ })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Historie transakcí' }).getByRole('listitem').first(),
  ).toBeVisible();

  // „Simulovat prodej“ vede do demo simulátoru s předvyplněnou pozicí
  await page.getByRole('link', { name: 'Simulovat prodej' }).click();
  await page.waitForURL('**/demo/simulator?isin=IE00BK5BQT80');
});

test('demo simulátor: GET výpočet nad ukázkovými daty', async ({ page }) => {
  await page.goto('/demo/simulator');
  await expectDemoBanner(page);
  await expect(page.getByRole('heading', { name: /^Simulátor \d{4}$/ })).toBeVisible();

  // formulář: VWCE, 5 ks za 140 EUR → GET → verdikt. Prodej je sice z lotu
  // osvobozeného časovým testem, ale prolomí úhrn 100k (91k + ~17k) — poctivý
  // verdikt varuje před knock-on zdaněním dřívějších letošních prodejů.
  await simulateSale(page, { position: 'IE00BK5BQT80', quantity: '5', price: '140' });
  await expect(page).toHaveURL(/\/demo\/simulator\?.*isin=IE00BK5BQT80/);
  await expect(page.getByRole('textbox', { name: 'Cena za kus (EUR)' })).toHaveValue('140');

  const verdict = page.getByRole('region', { name: 'Verdikt' });
  await expect(
    verdict.getByRole('heading', { name: 'Prodej zruší osvobození prodejů cenných papírů' }),
  ).toBeVisible();
  await expect(verdict).toContainText(
    'Sám je osvobozený časovým testem, ale letošní prodeje s ním přesáhnou 100 000 Kč a ty dřívější se zpětně zdaní.',
  );
  await expect(page.getByRole('heading', { name: 'Rozpad prodeje' })).toBeVisible();
  await expect(
    section(page, 'Limity po prodeji')
      .getByRole('listitem')
      .filter({ hasText: /^Limit paušální daně/ }),
  ).toContainText('z 50 000 Kč');
});

test('demo report: čísla k přiznání + ukázkové XML místo EPO exportu', async ({ page }) => {
  await page.goto('/demo/report');
  await expectDemoBanner(page);

  await expect(page.getByRole('heading', { name: /^Report \d{4}$/ })).toBeVisible();
  const taxBreakdown = section(page, 'Výpočet daně').getByRole('listitem');
  await expect(taxBreakdown.filter({ hasText: /^Základ daně z prodejů/ })).toHaveText(/\d\sKč$/);

  // varianty párování × kurz: 4 metody × 2 kurzy = 8 řádků (demo má
  // syntetické denní kurzy, srovnání je kompletní jako v reálném reportu).
  // Kurzové soustavy jsou dva pohledy téže sekce — druhý je za přepínačem.
  await expect(page.getByRole('heading', { name: 'Porovnání variant párování' })).toBeVisible();
  const unified = page.getByRole('table', {
    name: 'Srovnání variant výpočtu daně, jednotný kurz GFŘ',
  });
  const daily = page.getByRole('table', {
    name: 'Srovnání variant výpočtu daně, denní kurzy ČNB',
  });
  await expect(unified.locator('tbody tr')).toHaveCount(4);
  await expect(daily).toBeHidden();
  const fxSwitch = page.getByRole('group', { name: 'Kurzy ve srovnání variant' });
  await (await hydrated(fxSwitch.getByRole('button', { name: 'Denní kurzy ČNB' }))).click();
  await expect(daily.locator('tbody tr')).toHaveCount(4);
  await expect(unified).toBeHidden();

  await expect(taxBreakdown.filter({ hasText: /^Základ daně z dividend a úroků/ })).toHaveText(
    /\d\sKč$/,
  );
  await expect(page.getByRole('heading', { name: /^Prodeje v roce \d{4} \d+$/ })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /^Derivátové obchody v roce \d{4} \d+$/ }),
  ).toBeVisible();
  // Podstata, ne formulace: rozpad zahraničních příjmů po státech pro zápočet
  // dle § 38f. Nadpis se změnil z „Dividendy" na „Příjmy", jakmile do tabulky
  // přibyly i úroky — tvrzení zůstalo stejné, jen přesnější.
  await expect(page.getByRole('heading', { name: /podle států/ })).toBeVisible();

  // EPO export je v demu nahrazený odkazem na ukázkové XML: soubor s čísly
  // z dema by nesl smyšlená data, takže se nenabízí formulář ani tlačítko
  // v liště
  await expect(page.getByRole('heading', { name: 'Export pro mojedane.cz' })).toBeVisible();
  await expect(page.getByText('S účtem stáhneš XML s vlastními čísly.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Stáhnout XML/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Stáhnout ukázkové XML (2025)' })).toHaveAttribute(
    'href',
    '/marketing/ukazka-dpfdp7-2025.xml',
  );

  // CTA z banneru vede na registraci
  await page.getByRole('banner').getByRole('link', { name: 'Založit účet' }).click();
  await page.waitForURL('**/registrace');
});

/** G9a: onboarding — registrace vede do průvodce, kroky se odvozují z dat. */
test('onboarding: registrace → průvodce → profil → výzva k datům', async ({ page }) => {
  await page.goto('/registrace');
  await page.getByLabel('Jméno').fill('E2E Onboarding');
  await page.getByLabel('E-mail').fill('onboarding@danero.cz');
  await page.getByLabel('Heslo').fill('bezpecne-heslo-e2e');
  await page.getByRole('button', { name: 'Vytvořit účet' }).click();
  // registrace nepřihlašuje — nejdřív potvrzení adresy odkazem z e-mailu
  await page.waitForURL('**/overeni-emailu**');
  await page.goto(await linkFromEmail(page, 'onboarding@danero.cz'));
  await page.waitForURL('**/vitejte');

  await expect(page.getByText('Krok 1 ze 2')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Vítej v Daneru' })).toBeVisible();

  // vyplnění profilu → krok 2 (data)
  await page.getByRole('link', { name: 'Vyplnit daňový profil' }).click();
  await page.waitForURL('**/nastaveni');
  // stránka říká, proč tu člověk je — bez profilu sem vede i zbytek aplikace
  await expect(page.getByText('Krok 1 ze 2 — vyber daňový režim')).toBeVisible();
  // bez vybraného režimu formulář neodejde (R8): pole je povinné a prázdné
  await expect(page.getByLabel('Daňový režim')).toHaveValue('');
  await page.getByRole('button', { name: 'Uložit profil' }).click();
  await expect(page).toHaveURL(/\/nastaveni$/);
  await page.getByLabel('Daňový režim').selectOption('ZAMESTNANEC');
  await page.getByRole('button', { name: 'Uložit profil' }).click();

  // první uložení profilu pokračuje rovnou krokem 2 na Zdrojích dat — obě
  // cesty k datům jsou na jedné stránce: nahrát výpis, nebo napojit brokera
  await page.waitForURL(/\/import(\?|$)/);
  await expect(page.getByText('Krok 2 ze 2 — přidej svoje obchody')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nahrát výpisy' })).toBeVisible();
  const brokers = page.getByRole('list', { name: 'Brokeři s automatickou synchronizací' });
  await expect(brokers.locator('summary').filter({ hasText: 'Trading 212' })).toBeVisible();
  await expect(brokers.locator('summary').filter({ hasText: 'Interactive Brokers' })).toBeVisible();

  // kroky se odvozují z účtu, neukládají: průvodce teď ukazuje krok 2
  // a vede zpátky na Zdroje dat
  await page.goto('/vitejte');
  await expect(page.getByText('Krok 2 ze 2')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Přidej svoje obchody' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Přidat data' })).toHaveAttribute('href', '/import');

  // prázdný přehled není slepá ulička: vede k nahrání výpisů a říká, proč
  // Report a Simulátor zatím končí tady
  await page.goto('/report');
  await page.waitForURL('**/prehled');
  await expect(page.getByRole('heading', { name: 'Zatím žádná data' })).toBeVisible();
  await expect(page.getByText(/Report a Simulátor se otevřou s prvním výpisem/)).toBeVisible();
  await page.getByRole('link', { name: 'Nahrát výpisy' }).click();
  await page.waitForURL('**/import');
});

/**
 * Sheet v úzkém okně jde táhnout i myší. První tah titulek sheetu označil
 * a druhé chycení za označený text vzal prohlížeč jako přetahování textu:
 * sheet se nepohnul a ve WebKitu zůstal „v ruce“ — nešel zavřít klávesou ani
 * klepnutím mimo (změřeno 11. 10. 2026 v Chromiu, Firefoxu i WebKitu).
 */
test('sheet: jde myší chytit opakovaně a pak zavřít klávesou', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo/prehled');
  await (await hydrated(page.getByRole('button', { name: /^Limit paušální daně/ }))).click();
  const dialog = page.getByRole('dialog', { name: /^Limit paušální daně — / });
  await expect(dialog).toBeVisible();
  const panel = dialog.locator('.material-sheet');
  // sheet přijíždí pružinou — měří se, až stojí
  await (await panel.elementHandle())?.waitForElementState('stable');
  const rest = (await panel.boundingBox())!;
  const x = rest.x + rest.width / 2;
  const top = async () => Math.round((await panel.boundingBox())!.y - rest.y);

  // první tah za úchyt: kousek dolů, ukazatel zastaví a pustí — sheet se vrátí
  await page.mouse.move(x, rest.y + 12);
  await page.mouse.down();
  for (let step = 1; step <= 4; step += 1) await page.mouse.move(x, rest.y + 12 + step * 10);
  expect(await top()).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  await page.mouse.up();
  await expect.poll(top).toBe(0);
  // tah po sobě nenechal označený text
  expect(await page.evaluate(() => window.getSelection()?.toString().trim() ?? '')).toBe('');

  // druhý tah za titulek: sheet ho zase sleduje (nahoru s odporem)
  await page.mouse.move(x, rest.y + 44);
  await page.mouse.down();
  for (let step = 1; step <= 7; step += 1) await page.mouse.move(x, rest.y + 44 - step * 6);
  expect(await top()).toBeLessThan(0);
  await page.mouse.up();
  await expect.poll(top).toBe(0);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
