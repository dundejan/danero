import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  autoSaveForm,
  registerWithProfile,
  selectLimit,
  simulateSale,
  uploadStatement,
} from './helpers';

/**
 * Hlavní scénář (docs/09, G1): registrace → daňový profil → ruční import
 * fixtury → dashboard ukazuje limity → simulátor → report.
 * Fixture: nákup 100 AAPL (2024), prodej 50 (2026) → tržby ~230k CZK
 * přes limit 100k, zbývající pozice 50 ks.
 */
test('registrace → profil → import → přehled → simulátor → report', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Tester', email: 'zaklad@danero.cz' });

  // ── ruční import fixtury ────────────────────────────────────────────────
  // Bez `goto`: uložení prvního profilu vede rovnou na Zdroje dat (krok 2),
  // takže nový uživatel nahrává tam, kam ho aplikace sama dovedla.
  const imported = await uploadStatement(page, join(__dirname, 'fixtures', 't212-vzorek.csv'));
  await expect(imported).toContainText('2 nové · 0 duplicit');
  // s prvními daty výzva „krok 2“ zmizí — krok se odvozuje z účtu, neukládá se
  await expect(page.getByText(/Krok 2 ze 2/)).toHaveCount(0);

  // ── dashboard: limity z reálných dat ────────────────────────────────────
  // Bez `goto`: výsledek prvního nahrání nabízí další krok sám — dřív cesta
  // nového uživatele skončila na Zdrojích dat hláškou a dál nic.
  const uploadResult = page
    .getByRole('status')
    .filter({ hasText: 'Nahráno: 1 soubor, přibyly 2 transakce.' });
  await uploadResult.getByRole('link', { name: 'Hotovo, otevřít přehled' }).click();
  await expect(page.getByRole('heading', { name: /Přehled \d{4}/ })).toBeVisible();
  // v seznamu je jméno limitu a čerpání; celé znění s částkou nese detail
  // vybraného řádku
  const flatTax = await selectLimit(page, 'Limit paušální daně');
  await expect(
    flatTax.getByRole('heading', { name: 'Limit paušální daně — 50 000 Kč' }),
  ).toBeVisible();
  const securities = await selectLimit(page, 'Osvobození prodejů cenných papírů');
  await expect(
    securities.getByRole('heading', { name: 'Osvobození prodejů cenných papírů — 100 000 Kč' }),
  ).toBeVisible();
  // upozornění se v aplikaci počítají při otevření přehledu — bez tohohle by
  // je uživatel viděl až po nočním běhu hlídače, přestože to nastavení
  // upozornění slibuje
  const notifications = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Poslední upozornění' }) });
  await expect(
    notifications.getByText('Prolomen limit 100 000 Kč pro osvobození prodejů'),
  ).toBeVisible();

  // ── simulátor: prodej 10 ks zbývajících AAPL ────────────────────────────
  await page.goto('/simulator');
  await simulateSale(page, { position: { index: 1 }, quantity: '10', price: '200' });
  const verdict = page.getByRole('region', { name: 'Verdikt' });
  await expect(verdict.getByRole('heading')).toBeVisible();

  // ── report ──────────────────────────────────────────────────────────────
  await page.goto('/report');
  await expect(page.getByRole('heading', { name: /Report \d{4}/ })).toBeVisible();
  await expect(page.getByText('Základ daně z prodejů', { exact: true })).toBeVisible();
  // G5: průvodce, tisk a EPO export (rok 2026 → poctivá hláška o struktuře)
  await expect(page.getByRole('heading', { name: 'Co zapsat do přiznání' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vytisknout', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Export pro mojedane.cz' })).toBeVisible();

  // ── auto-save nastavení: změny se ukládají bez tlačítek Uložit ──────────
  await page.goto('/nastaveni');
  // s existujícím profilem žádná tlačítka Uložit u profilu/metod/upozornění
  await expect(page.getByRole('button', { name: 'Uložit profil' })).toHaveCount(0);
  // změna selectu metody → uloží se hned, potvrzení toastem. Volba skriptem
  // čeká, až auto-save poslouchá: `selectOption` není vstup člověka a změnu
  // před hydratací by `AutoSubmit` schválně neodeslal (viz nastaveni.spec.ts,
  // kde se mezera před hydratací zkouší skutečnou myší a klávesnicí)
  await autoSaveForm(page);
  await page.getByLabel('Párování prodejů').selectOption('LIFO');
  await expect(page.getByText('Uloženo. Výpočty se přepočítají podle nového profilu.')).toBeVisible();
  await page.reload();
  await autoSaveForm(page);
  await expect(page.getByLabel('Párování prodejů')).toHaveValue('LIFO');

  /**
   * Auto-save je asynchronní a uložení jdou na server jedno po druhém — čekat
   * na jednu odpověď serveru proto nestačí, dá se chytit odpověď předchozího
   * uložení a reload pak předběhne to skutečné.
   * Ověřuje se tedy VÝSLEDEK: opakovaně načíst stránku, dokud tam hodnota není.
   */
  const ulozenoJako = async (popisek: RegExp | string, hodnota: string) => {
    await expect(async () => {
      await page.reload();
      await expect(page.getByLabel(popisek)).toHaveValue(hodnota);
    }).toPass({ timeout: 20_000 });
    // další krok do formuláře zase píše — až auto-save poslouchá
    await autoSaveForm(page);
  };

  // Částku lidé píšou s mezerou mezi tisíci — a Danero ji tak samo tiskne,
  // takže zkopírované číslo se sem vrací i s NEDĚLITELNOU mezerou. Dokud se
  // hodnota kontrolovala dvěma refine za sebou, spadlo tohle na výjimku
  // z Decimalu a uživatel dostal chybovou stránku místo hlášky.
  await page.getByLabel(/Další zdanitelné příjmy/).fill('10 000');
  await page.getByLabel('Párování prodejů').focus(); // blur → auto-save
  await ulozenoJako(/Další zdanitelné příjmy/, '10000');

  // nesmysl musí skončit radou, ne pádem
  await page.getByLabel(/Další zdanitelné příjmy/).fill('12 000 Kč');
  await page.getByLabel('Párování prodejů').focus();
  await expect(page.getByText(/Další zdanitelné příjmy zadej jako částku/)).toBeVisible();

  // R-07h: sporný výklad se musí uložit a být vidět i v podkladech k přiznání
  await page.getByLabel('Vratka kapitálu').selectOption('lenient');
  await ulozenoJako('Vratka kapitálu', 'lenient');
  await page.goto('/report');
  // pozor: tatáž věta je i v tiskové hlavičce (`print:block`, na obrazovce
  // skrytá) — hledá se řádek seznamu „Metoda výpočtu“, kde pojem a hodnota
  // stojí vedle sebe
  const returnOfCapital = page.getByRole('listitem').filter({ hasText: /^Vratka kapitálu/ });
  await expect(returnOfCapital).toBeVisible();
  await expect(returnOfCapital).toContainText('snižuje nabývací cenu');
  // Volba hned po `goto` umí předběhnout hydrataci, kdy `AutoSubmit` ještě
  // neposlouchá: v CI 8. 10. 2026 na tom spadl pokus i jeho opakování a test
  // pak celý krok dokola opakoval. Teď čeká na signál aplikace, že auto-save
  // poslouchá, volí jednou a čeká na potvrzení — bez opakování volby.
  await page.goto('/nastaveni');
  await autoSaveForm(page);
  await page.getByLabel('Vratka kapitálu').selectOption('safe');
  await expect(
    page.getByRole('status').filter({ hasText: 'Uloženo. Výpočty se přepočítají' }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Vratka kapitálu')).toHaveValue('safe');

  // upozornění mají vlastní stránku — odkaz z podnavigace tam musí vést
  await page.getByRole('link', { name: 'Upozornění' }).click();
  await page.waitForURL('**/nastaveni/upozorneni');
  // ani tady se neukládá tlačítkem
  await expect(page.getByRole('button', { name: 'Uložit' })).toHaveCount(0);

  // přepnutí switche upozornění → taky auto-save
  await autoSaveForm(page);
  await page.getByText('Posílat e-maily').click();
  await expect(page.getByText('Uloženo. E-maily se řídí novým nastavením.')).toBeVisible();
  await page.reload();
  await expect(page.locator('input[name="emaily-zapnute"]')).not.toBeChecked();
});
