import { expect, test, type Page } from '@playwright/test';
import { autoSaveForm, holdScripts, registerWithProfile } from './helpers';

/**
 * Auto-save v Nastavení a mezera před hydratací.
 *
 * Stránka je vidět a dá se ovládat dřív, než se načtou skripty. `AutoSubmit`
 * proto po hydrataci srovná pole s HTML ze serveru — a rozhoduje, kdo rozdíl
 * způsobil:
 * - změnu, kterou udělal člověk, odešle (jinak by se potichu ztratila),
 * - hodnotu, kterou do pole vrátil prohlížeč, NEODEŠLE a pole vrátí na stav
 *   ze serveru. Firefox při F5 vrací do polí hodnoty z doby před načtením,
 *   i do těch, na která nikdo nesáhl; první verze opravy je po hydrataci
 *   odeslala a nastavení změněné na jiném zařízení tak potichu přepsala zpět
 *   (změřeno 11. 10. 2026: nabídka, přepínač i zaškrtávací políčko).
 *
 * Chromium, ve kterém sada běží, formulář při F5 neobnovuje. Test proto dělá
 * přesně to, co prohlížeč: hodnotu do pole vrátí bez jediné události, dřív než
 * stránka hydratuje (skripty jsou pozdržené).
 */

/** Požadavky, kterými stránka něco ukládá (server action = POST). */
function watchSaves(page: Page): string[] {
  const saves: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') saves.push(request.url());
  });
  return saves;
}

test('nastavení: F5 nepřepíše hodnotu změněnou jinde — pole ukáže uložený stav', async ({
  page,
  browser,
}) => {
  await registerWithProfile(page, { name: 'E2E Dva panely', email: 'dva-panely@danero.cz' });
  await page.goto('/nastaveni');
  await autoSaveForm(page);
  const matching = page.getByLabel('Párování prodejů');
  const income = page.getByLabel(/Další zdanitelné příjmy/);
  const businessAssets = page.getByRole('switch', { name: 'Cenné papíry v obchodním majetku' });
  await expect(matching).toHaveValue('FIFO');
  await expect(income).toHaveValue('0');
  await expect(businessAssets).not.toBeChecked();

  // ── jiné zařízení téhož účtu mezitím změní párování ─────────────────────
  const elsewhere = await browser.newContext({ storageState: await page.context().storageState() });
  const other = await elsewhere.newPage();
  await other.goto('/nastaveni');
  await autoSaveForm(other);
  await other.getByLabel('Párování prodejů').selectOption('LIFO');
  await expect(
    other.getByRole('status').filter({ hasText: 'Uloženo. Výpočty se přepočítají' }),
  ).toBeVisible();
  await elsewhere.close();

  // ── F5 v prvním panelu: prohlížeč vrátí do polí, co v nich bylo ─────────
  const saves = watchSaves(page);
  const releaseScripts = await holdScripts(page);
  await page.reload({ waitUntil: 'commit' });
  // server posílá, co platí; stránka ještě nehydratovala
  await expect(matching).toHaveValue('LIFO');
  await expect(page.locator('form[data-auto-submit]')).toHaveCount(0);
  // stará hodnota v nabídce, a k tomu pole, na která nikdo nesáhl — beze
  // všech událostí, tak jak to dělá obnovení formuláře
  await matching.evaluate((select: HTMLSelectElement) => {
    select.value = 'FIFO';
  });
  await income.evaluate((input: HTMLInputElement) => {
    input.value = '987';
  });
  await businessAssets.evaluate((input: HTMLInputElement) => {
    input.checked = true;
  });
  // totéž skriptem vyslanou změnou (rozšíření prohlížeče): není od člověka
  await page.getByLabel('Měnové kurzy').selectOption('CNB_DAILY');
  releaseScripts();
  await autoSaveForm(page);

  // obrazovka ukazuje, co je uložené — ne to, co vrátil prohlížeč
  await expect(matching).toHaveValue('LIFO');
  await expect(income).toHaveValue('0');
  await expect(businessAssets).not.toBeChecked();
  await expect(page.getByLabel('Měnové kurzy')).toHaveValue('UNIFIED');

  // a nic se neuložilo: čerstvé načtení vrací stav z druhého zařízení
  await page.reload();
  await autoSaveForm(page);
  await expect(matching).toHaveValue('LIFO');
  await expect(income).toHaveValue('0');
  await expect(businessAssets).not.toBeChecked();
  await expect(page.getByLabel('Měnové kurzy')).toHaveValue('UNIFIED');
  await expect(page.getByRole('status').filter({ hasText: 'Uloženo' })).toHaveCount(0);
  expect(saves).toEqual([]);

  // ── totéž na stránce upozornění (přepínač a zaškrtávací políčko) ────────
  await page.goto('/nastaveni/upozorneni', { waitUntil: 'commit' });
  await autoSaveForm(page);
  const urgent = page.getByRole('switch', { name: 'Naléhavé posílat hned' });
  const threshold = page.locator('input[name="hranice-limitu"][value="50"]');
  await expect(urgent).toBeChecked();
  await expect(threshold).not.toBeChecked();

  const holdAgain = await holdScripts(page);
  await page.reload({ waitUntil: 'commit' });
  await expect(urgent).toBeChecked();
  await expect(page.locator('form[data-auto-submit]')).toHaveCount(0);
  await urgent.evaluate((input: HTMLInputElement) => {
    input.checked = false;
  });
  await threshold.evaluate((input: HTMLInputElement) => {
    input.checked = true;
  });
  holdAgain();
  await autoSaveForm(page);
  await expect(urgent).toBeChecked();
  await expect(threshold).not.toBeChecked();
  await page.reload();
  await autoSaveForm(page);
  await expect(urgent).toBeChecked();
  await expect(threshold).not.toBeChecked();
  expect(saves).toEqual([]);
});

test('nastavení: změna, kterou člověk udělá před hydratací, se uloží', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Před hydratací', email: 'pred-hydrataci@danero.cz' });

  // ── pomalé připojení: HTML je na obrazovce, skripty ještě ne ────────────
  const releaseScripts = await holdScripts(page);
  await page.goto('/nastaveni', { waitUntil: 'commit' });
  const matching = page.getByLabel('Párování prodejů');
  const income = page.getByLabel(/Další zdanitelné příjmy/);
  const businessAssets = page.getByRole('switch', { name: 'Cenné papíry v obchodním majetku' });
  await expect(matching).toHaveValue('FIFO');
  await expect(page.locator('form[data-auto-submit]')).toHaveCount(0);

  // skutečná myš a klávesnice — události jsou důvěryhodné, ne vyslané skriptem
  await page.getByText('Cenné papíry v obchodním majetku').click();
  await expect(businessAssets).toBeChecked();
  await matching.focus();
  await page.keyboard.press('ArrowDown');
  await expect(matching).toHaveValue('LIFO');
  // rozepsaná částka: pole ještě nikdo neopustil, `change` nepřišlo
  await income.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('4321');

  releaseScripts();
  await autoSaveForm(page);
  // změny člověka se odeslaly a potvrdily…
  await expect(
    page.getByRole('status').filter({ hasText: 'Uloženo. Výpočty se přepočítají' }),
  ).toBeVisible();
  // …a nic z toho, co zadal, hydratace nepřepsala
  await expect(businessAssets).toBeChecked();
  await expect(matching).toHaveValue('LIFO');
  await expect(income).toHaveValue('4321');

  await page.reload();
  await autoSaveForm(page);
  await expect(businessAssets).toBeChecked();
  await expect(matching).toHaveValue('LIFO');
  await expect(income).toHaveValue('4321');
});
