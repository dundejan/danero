import { expect, test, type Page } from '@playwright/test';
import { linkFromEmail } from './helpers';

/**
 * Demo prohlídka: návštěvník bez registrace vidí vizuálně totéž co přihlášený
 * uživatel — přehled, portfolio, detail pozice, simulátor i report nad
 * bohatými ukázkovými daty. Všude banner + CTA na registraci, nic se neukládá.
 */

/** Banner dema s CTA je na každé demo stránce. */
async function expectDemoBanner(page: Page) {
  await expect(page.getByText('Prohlížíš demo s ukázkovými daty')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Založit účet zdarma' }).first()).toBeVisible();
}

test('demo přehled: verdikt, odměrky, horizont, upozornění; rok-switcher', async ({ page }) => {
  // /demo (odkaz z landing page) → redirect na vstupní stránku prohlídky
  await page.goto('/demo');
  await page.waitForURL('**/demo/prehled');
  await expectDemoBanner(page);

  // naváděcí checklist prohlídky pod bannerem + mini patička s právními odkazy
  await expect(page.getByRole('navigation', { name: 'Prohlídka dema' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Simulátor — prodej nanečisto/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Podmínky užití' })).toBeVisible();

  // verdikt-box: prolomený limit 50k → „podáš přiznání“ + orientační daň
  await expect(page.getByText(/podáš daňové přiznání/)).toBeVisible();
  await expect(page.getByText('Orientační daň z investic:')).toBeVisible();

  // odměrky limitů (50k prolomený, 100k CRITICAL, krypto OK)
  await expect(page.getByText('Limit paušální daně — 50 000 Kč')).toBeVisible();
  await expect(page.getByText('Osvobození prodejů cenných papírů — 100 000 Kč')).toBeVisible();
  await expect(page.getByText('Osvobození krypta — 100 000 Kč')).toBeVisible();

  // horizont osvobození s tečkami (SVG pás)
  await expect(page.getByRole('heading', { name: 'Horizont osvobození' })).toBeVisible();
  await expect(page.locator('svg[aria-label="Horizont osvobození"]')).toBeVisible();

  // demo upozornění z hlídače (prolomený limit) — .first(): týž text nese
  // i varování enginu v „Kontrolách výpočtu“
  await expect(page.getByText('Poslední upozornění')).toBeVisible();
  await expect(page.getByText(/Prolomen limit 50.*paušální/).first()).toBeVisible();

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

test('demo portfolio: hodnota, tabulka s hledáním, donut, deriváty → detail pozice', async ({
  page,
}) => {
  await page.goto('/demo/portfolio');
  await expectDemoBanner(page);

  // KPI: hodnota portfolia je oceněná (žádné „—“)
  await expect(page.getByText('Hodnota portfolia')).toBeVisible();
  await expect(page.getByText(/mil\.|\d{3}\s?\d{3}\s?Kč/).first()).toBeVisible();
  await expect(page.getByText('Nejbližší osvobození')).toBeVisible();

  // 50+ pozic se stránkováním po 10
  await expect(page.getByText(/1–10 z 5\d pozic/)).toBeVisible();

  // tabulka pozic + hledání (najde Apple, schová VWCE)
  await expect(page.getByRole('link', { name: 'VWCE' })).toBeVisible();
  await page.getByRole('searchbox', { name: /Hledat pozici/ }).fill('apple');
  await expect(page.getByRole('link', { name: 'AAPL' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'VWCE' })).toHaveCount(0);
  await page.getByRole('searchbox', { name: /Hledat pozici/ }).fill('');

  // donut alokace (přepínač pohledu Pozice → Graf)
  await page
    .getByRole('group', { name: 'Pohled na pozice' })
    .getByRole('button', { name: 'Graf' })
    .click();
  await expect(page.locator('.recharts-pie').first()).toBeVisible();

  // otevřená opce v sekci derivátů
  await expect(page.getByText('Otevřené derivátové pozice')).toBeVisible();
  await expect(page.getByText('Opce SPY put 560')).toBeVisible();

  // detail pozice: loty s časovými testy + historie + odkaz na simulátor
  await page
    .getByRole('group', { name: 'Pohled na pozice' })
    .getByRole('button', { name: 'Tabulka' })
    .click();
  await page.getByRole('link', { name: 'VWCE' }).click();
  await page.waitForURL('**/demo/portfolio/IE00BK5BQT80');
  await expectDemoBanner(page);
  await expect(page.getByText('Nákupy (loty) a časové testy')).toBeVisible();
  await expect(page.getByText('už bez daně').first()).toBeVisible();
  await expect(page.getByText(/Historie \(\d+\)/)).toBeVisible();

  // „Simulovat prodej“ vede do demo simulátoru s předvyplněnou pozicí
  await page.getByRole('link', { name: 'Simulovat prodej' }).click();
  await page.waitForURL('**/demo/simulator?isin=IE00BK5BQT80');
});

test('demo simulátor: GET výpočet nad ukázkovými daty', async ({ page }) => {
  await page.goto('/demo/simulator');
  await expectDemoBanner(page);
  await expect(page.getByRole('heading', { name: 'Simulátor prodeje' })).toBeVisible();

  // formulář: VWCE, 5 ks za 140 EUR → GET → verdikt. Prodej je sice z lotu
  // osvobozeného časovým testem, ale prolomí úhrn 100k (91k + ~17k) — poctivý
  // verdikt varuje před knock-on zdaněním dřívějších letošních prodejů.
  await page.getByLabel('Pozice').selectOption('IE00BK5BQT80');
  await page.getByLabel('Kusů (prázdné = vše)').fill('5');
  await page.getByLabel('Cena/ks').fill('140');
  await page.getByRole('button', { name: 'Spočítat dopad' }).click();
  await page.waitForURL(/\/demo\/simulator\?.*isin=IE00BK5BQT80/);

  await expect(page.getByText('Verdikt')).toBeVisible();
  await expect(
    page.getByText(/Prodej je osvobozený časovým testem, ale prolomí úhrn 100 000 Kč/),
  ).toBeVisible();
  await expect(page.getByText('Rozpad prodeje')).toBeVisible();
  await expect(page.getByText('Paušální daň (50 000 Kč)')).toBeVisible();
});

test('demo report: čísla k přiznání + teaser místo EPO exportu', async ({ page }) => {
  await page.goto('/demo/report');
  await expectDemoBanner(page);

  await expect(page.getByRole('heading', { name: /Daňový report \d{4}/ })).toBeVisible();
  await expect(page.getByText('Dílčí základ § 10 (součet druhů)')).toBeVisible();

  // varianty párování × kurz: 4 metody × 2 kurzy = 8 řádků (demo má
  // syntetické denní kurzy, tabulka je kompletní jako v reálném reportu)
  await expect(page.getByText('Porovnání variant párování')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'denní ČNB' })).toHaveCount(4);
  await expect(page.getByRole('cell', { name: 'jednotný', exact: true })).toHaveCount(4);
  await expect(page.getByText('Dílčí základ § 8 (dividendy, úroky)')).toBeVisible();
  await expect(page.getByText(/Prodeje v roce \d{4}/)).toBeVisible();
  await expect(page.getByText(/Derivátové obchody v roce \d{4}/)).toBeVisible();
  await expect(page.getByText('Dividendy podle států', { exact: false })).toBeVisible();

  // EPO export je v demu nahrazený teaserem s CTA + odkazem na ukázkové XML
  await expect(page.getByText('Export pro mojedane.cz')).toBeVisible();
  await expect(page.getByText(/V demu nedostupné/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stáhnout XML pro EPO' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Stáhni ukázkové XML (2025)' })).toHaveAttribute(
    'href',
    '/marketing/ukazka-dpfdp7-2025.xml',
  );

  // na reportu (konec prohlídky) vede poslední krok checklistu na registraci
  await expect(page.getByRole('link', { name: 'Hotovo? Založ si účet' })).toBeVisible();

  // CTA z banneru vede na registraci
  await page.getByRole('link', { name: 'Založit účet zdarma' }).first().click();
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

  await expect(page.getByText('Vítej v Daneru')).toBeVisible();
  await expect(page.getByText('Krok 1: Řekni nám, kdo jsi vůči dani')).toBeVisible();

  // vyplnění profilu → krok 2 (data)
  await page.getByRole('link', { name: 'Vyplnit daňový profil' }).click();
  await page.waitForURL('**/nastaveni');
  await page.getByRole('button', { name: 'Uložit profil' }).click();
  await page.waitForURL('**/prehled');
  await page.goto('/vitejte');
  await expect(page.getByText('Krok 2: Nahraj svoje obchody')).toBeVisible();
  await expect(page.getByText('Trading 212 / IBKR API')).toBeVisible();
});
