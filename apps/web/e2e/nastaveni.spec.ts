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

/**
 * Formulář nese ve skrytém poli stav, se kterým byl vykreslen, a server
 * zapisuje jen pole, která se od něj liší (`lib/form-baseline.ts`). Skrytý
 * stav proto musí říkat přesně to, co by neupravený formulář odeslal — jinak
 * by se nedotčené pole tvářilo jako změněné.
 */
async function expectFormMatchesBaseline(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.locator('form[data-auto-submit="ready"]').evaluate((form: HTMLFormElement) => {
        const sorted = (query: string): string =>
          [...new URLSearchParams(query)].map((pair) => pair.join('=')).sort().join('&');
        const data = new FormData(form);
        const shown = [...data].filter(
          (pair): pair is [string, string] =>
            typeof pair[1] === 'string' &&
            pair[0] !== 'puvodni-stav' &&
            pair[0] !== 'zmenene-pole' &&
            !pair[0].startsWith('$ACTION'),
        );
        return sorted(new URLSearchParams(shown).toString()) === sorted(String(data.get('puvodni-stav')));
      }),
    )
    .toBe(true);
}

const savedToast = (page: Page) => page.getByRole('status').filter({ hasText: 'Uloženo' });

test('nastavení: panel se starým stavem nepřepíše, co se mezitím uložilo jinde', async ({
  page,
  browser,
}) => {
  await registerWithProfile(page, { name: 'E2E Starý panel', email: 'stary-panel@danero.cz' });
  // druhé zařízení téhož účtu — otevřené dřív, než se cokoli změní
  const elsewhere = await browser.newContext({ storageState: await page.context().storageState() });
  const stale = await elsewhere.newPage();

  // ── daňový profil ───────────────────────────────────────────────────────
  await page.goto('/nastaveni');
  await autoSaveForm(page);
  await expectFormMatchesBaseline(page);
  await stale.goto('/nastaveni');
  await autoSaveForm(stale);

  await page.getByLabel('Párování prodejů').selectOption('LIFO');
  await expect(savedToast(page)).toBeVisible();

  // druhý panel pořád ukazuje FIFO a mění JINÉ pole
  await expect(stale.getByLabel('Párování prodejů')).toHaveValue('FIFO');
  await stale.getByLabel('Měnové kurzy').selectOption('CNB_DAILY');
  await expect(savedToast(stale)).toBeVisible();
  // po uložení ukazuje stav ze serveru, včetně cizí změny
  await expect(stale.getByLabel('Párování prodejů')).toHaveValue('LIFO');
  await expect(stale.getByLabel('Měnové kurzy')).toHaveValue('CNB_DAILY');
  await expectFormMatchesBaseline(stale);

  await page.reload();
  await autoSaveForm(page);
  await expect(page.getByLabel('Párování prodejů')).toHaveValue('LIFO');
  await expect(page.getByLabel('Měnové kurzy')).toHaveValue('CNB_DAILY');

  // ── upozornění ──────────────────────────────────────────────────────────
  await page.goto('/nastaveni/upozorneni');
  await autoSaveForm(page);
  await expectFormMatchesBaseline(page);
  await stale.goto('/nastaveni/upozorneni');
  await autoSaveForm(stale);

  await page.getByLabel('Souhrn', { exact: true }).selectOption('WEEKLY');
  await expect(savedToast(page)).toBeVisible();
  await expect(stale.getByLabel('Souhrn', { exact: true })).toHaveValue('DAILY');
  await stale.getByText('Naléhavé posílat hned').click();
  await expect(savedToast(stale)).toBeVisible();
  await expect(stale.getByLabel('Souhrn', { exact: true })).toHaveValue('WEEKLY');
  await expectFormMatchesBaseline(stale);

  await page.reload();
  await autoSaveForm(page);
  await expect(page.getByLabel('Souhrn', { exact: true })).toHaveValue('WEEKLY');
  await expect(page.getByRole('switch', { name: 'Naléhavé posílat hned' })).not.toBeChecked();
  await elsewhere.close();
});

test('nastavení: změny rychle po sobě se uloží všechny, i ta vrácená', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Rychlé změny', email: 'rychle-zmeny@danero.cz' });

  // ── dvě nabídky hned po sobě: druhá se dřív ztratila, protože dokončené
  //    uložení formulář vykreslilo znovu ze serveru ─────────────────────────
  // Každá změna je vlastní uložení; další krok smí přijít, až doběhnou
  // všechna — obnovení stránky by rozdělané uložení utnulo.
  let finishedSaves = 0;
  page.on('requestfinished', (request) => {
    if (request.method() === 'POST') finishedSaves += 1;
  });
  const savesFinished = (count: number) =>
    expect.poll(() => finishedSaves, { message: `čekám na ${count} dokončených uložení` }).toBe(count);

  await page.goto('/nastaveni');
  await autoSaveForm(page);
  // druhá změna přijde dřív, než první uložení doběhne
  await page.evaluate(() => {
    for (const [id, value] of [
      ['parovani', 'LIFO'],
      ['kurzy', 'CNB_DAILY'],
    ] as const) {
      const select = document.getElementById(id) as HTMLSelectElement;
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await savesFinished(2);
  await expect(page.getByLabel('Měnové kurzy')).toHaveValue('CNB_DAILY');
  await expect(page.getByLabel('Párování prodejů')).toHaveValue('LIFO');

  // ── přepínač zapnutý a hned vypnutý: druhé odeslání nese totéž, co stálo
  //    ve formuláři při vykreslení — i tak se musí zapsat ──────────────────
  const businessAssets = page.getByRole('switch', { name: 'Cenné papíry v obchodním majetku' });
  await autoSaveForm(page);
  await page.evaluate(() => {
    const input = document.getElementById('obchodni-majetek') as HTMLInputElement;
    input.click();
    input.click();
  });
  await savesFinished(4);
  await expect(businessAssets).not.toBeChecked();

  await page.reload();
  await autoSaveForm(page);
  await expect(page.getByLabel('Párování prodejů')).toHaveValue('LIFO');
  await expect(page.getByLabel('Měnové kurzy')).toHaveValue('CNB_DAILY');
  await expect(businessAssets).not.toBeChecked();

  // ── tři políčka za sebou v upozornění ───────────────────────────────────
  await page.goto('/nastaveni/upozorneni');
  await autoSaveForm(page);
  const threshold = (percent: number) =>
    page.locator(`input[name="hranice-limitu"][value="${percent}"]`);
  await page.evaluate(() => {
    for (const percent of [50, 75, 90]) {
      document
        .querySelector<HTMLInputElement>(`input[name="hranice-limitu"][value="${percent}"]`)!
        .click();
    }
  });
  await savesFinished(7);
  for (const percent of [50, 60, 75, 85, 90, 100]) await expect(threshold(percent)).toBeChecked();
  await page.reload();
  await autoSaveForm(page);
  for (const percent of [50, 60, 75, 85, 90, 100]) await expect(threshold(percent)).toBeChecked();
});

/**
 * Zpět umí ukázat stránku z paměti prohlížeče — a tedy starý stav. Rozložení
 * aplikace ji v tom případě obnoví ze serveru (`RefreshOnRestore`). Cesty jsou
 * dvě: dokument z mezipaměti při procházení historie (tu test prochází
 * doopravdy) a rozmrazení z bfcache, které se ve vývojovém režimu nestane —
 * proto se jeho událost vysílá ručně.
 */
test('nastavení: návrat zpět ukáže stav ze serveru, ne z paměti prohlížeče', async ({
  page,
  browser,
}) => {
  await registerWithProfile(page, { name: 'E2E Návrat zpět', email: 'navrat-zpet@danero.cz' });
  await page.goto('/nastaveni');
  await autoSaveForm(page);
  await expect(page.getByLabel('Párování prodejů')).toHaveValue('FIFO');
  // plné načtení jiné stránky, ne přechod uvnitř aplikace
  await page.goto('/soukromi');

  const elsewhere = await browser.newContext({ storageState: await page.context().storageState() });
  const other = await elsewhere.newPage();
  await other.goto('/nastaveni');
  await autoSaveForm(other);
  await other.getByLabel('Párování prodejů').selectOption('LIFO');
  await expect(savedToast(other)).toBeVisible();

  const saves = watchSaves(page);
  await page.goBack();
  await autoSaveForm(page);
  await expect(page.getByLabel('Párování prodejů')).toHaveValue('LIFO');
  await expectFormMatchesBaseline(page);

  // bfcache: stránka se rozmrazí bez načítání, přijde jen `pageshow`
  await other.getByLabel('Párování prodejů').selectOption('MAX_PROFIT');
  await expect(savedToast(other)).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page.getByLabel('Párování prodejů')).toHaveValue('MAX_PROFIT');
  await expectFormMatchesBaseline(page);
  // obnovení nic neukládá
  expect(saves).toEqual([]);
  await elsewhere.close();
});
