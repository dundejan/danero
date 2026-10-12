import { expect, test, type Page, type Route } from '@playwright/test';
import { autoSaveForm, holdScripts, registerWithProfile, signOut } from './helpers';

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
  // Odeslání jdou za sebou (změny během ukládání se slijí do jednoho
  // dalšího); další krok smí přijít, až doběhnou všechna.
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
  // první změna odejde hned, zbylé dvě se slijí do jednoho dalšího odeslání
  await savesFinished(6);
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

/**
 * Po každém uložení se stránka vykreslí znovu a pole s fokusem zanikne —
 * klávesnice se vracela na začátek stránky a klávesa zmáčknutá těsně po
 * uložení šla do prázdna (změřeno 11. 10. 2026: mezerník na druhém přepínači
 * se neprovedl vůbec). Nový formulář proto fokus převezme
 * (`lib/focus-handoff.ts`). Test jde klávesnicí, jak ji používá člověk.
 */
test('nastavení klávesnicí: po uložení zůstane fokus na poli a další klávesa platí', async ({
  page,
}) => {
  await registerWithProfile(page, { name: 'E2E Klávesnice', email: 'klavesnice@danero.cz' });
  let finishedSaves = 0;
  page.on('requestfinished', (request) => {
    if (request.method() === 'POST') finishedSaves += 1;
  });
  const savesFinished = (count: number) =>
    expect.poll(() => finishedSaves, { message: `čekám na ${count} dokončených uložení` }).toBe(count);

  await page.goto('/nastaveni/upozorneni');
  await autoSaveForm(page);

  // ── nabídka šipkou: uloží se a fokus zůstane na ní ──────────────────────
  const frequency = page.locator('#frekvence-emailu');
  await frequency.focus();
  await page.keyboard.press('ArrowDown');
  await savesFinished(1);
  await autoSaveForm(page);
  await expect(savedToast(page)).toBeVisible();
  await expect(frequency).toHaveValue('WEEKLY');
  await expect(frequency).toBeFocused();
  // fokus je vidět — po klávesnici patří k poli obrys. Stránka se po uložení
  // dotahuje ze serveru zvlášť, takže nové pole může vzniknout o chvíli později.
  await expect
    .poll(() => frequency.evaluate((element) => element.matches(':focus-visible')))
    .toBe(true);

  // ── další klávesa jde do téhož pole, ne do prázdna ──────────────────────
  await page.keyboard.press('ArrowUp');
  await savesFinished(2);
  await autoSaveForm(page);
  await expect(frequency).toHaveValue('DAILY');
  await expect(frequency).toBeFocused();

  // ── přepínač mezerníkem dvakrát po sobě: obě změny, fokus pořád na něm ──
  const urgent = page.getByRole('switch', { name: 'Naléhavé posílat hned' });
  await urgent.focus();
  await expect(urgent).toBeChecked();
  await page.keyboard.press('Space');
  await savesFinished(3);
  await autoSaveForm(page);
  await expect(urgent).not.toBeChecked();
  await expect(urgent).toBeFocused();
  await page.keyboard.press('Space');
  await savesFinished(4);
  await autoSaveForm(page);
  await expect(urgent).toBeChecked();
  await expect(urgent).toBeFocused();

  // ── políčko ze skupiny (bez vlastního id) se pozná podle hodnoty ────────
  const threshold = page.locator('input[name="hranice-limitu"][value="75"]');
  await threshold.focus();
  await page.keyboard.press('Space');
  await savesFinished(5);
  await autoSaveForm(page);
  await expect(threshold).toBeChecked();
  await expect(threshold).toBeFocused();

  // uložilo se doopravdy — a po načtení stránky fokus nikam neskáče
  await page.reload();
  await autoSaveForm(page);
  await expect(threshold).toBeChecked();
  await expect(urgent).toBeChecked();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

/**
 * Mezerník přepíná až puštěním klávesy, a jen na prvku, na kterém byl
 * stisknut. Když formulář mezi stiskem a puštěním vznikl znovu (doběhlo
 * předchozí uložení), puštění dopadlo na nový přepínač, který stisk neviděl,
 * a klávesa šla do prázdna — změřeno 12. 10. 2026 shodně v Chromiu, Firefoxu
 * i WebKitu. Člověk klávesu drží desítky milisekund, takže se do té chvíle
 * trefí snáz než test, který ji pouští hned.
 */
test('nastavení klávesnicí: mezerník držený přes nové vykreslení formuláře platí', async ({
  page,
}) => {
  await registerWithProfile(page, { name: 'E2E Držená klávesa', email: 'drzena-klavesa@danero.cz' });
  await page.goto('/nastaveni/upozorneni');
  const form = await autoSaveForm(page);
  const urgent = page.getByRole('switch', { name: 'Naléhavé posílat hned' });
  const frequency = page.locator('#frekvence-emailu');
  await expect(urgent).toBeChecked();
  // značka na formuláři: zmizí, až ho uložení vykreslí znovu
  await form.evaluate((element) => element.setAttribute('data-e2e-puvodni', ''));

  // první změna se uloží až na pokyn — do té doby formulář stojí
  const firstSave = await holdFirstSave(page);
  await frequency.focus();
  await page.keyboard.press('ArrowDown');

  // stisk ještě na starém přepínači, puštění až na novém
  await urgent.focus();
  await page.keyboard.down('Space');
  firstSave.release();
  await expect(page.locator('form[data-e2e-puvodni]')).toHaveCount(0);
  await expect(urgent).toBeFocused();
  await page.keyboard.up('Space');

  await expect(urgent).not.toBeChecked();
  await firstSave.idle();
  await expectFormMatchesBaseline(page);

  // obě změny jsou uložené doopravdy
  await page.reload();
  await autoSaveForm(page);
  await expect(frequency).toHaveValue('WEEKLY');
  await expect(urgent).not.toBeChecked();
});

/**
 * Uložení v běhu: první POST se pozdrží, dokud test neřekne, a ostatní se jen
 * počítají. Test čeká na klid, ne na počet.
 */
async function holdFirstSave(page: Page): Promise<{ release: () => void; idle: () => Promise<void> }> {
  let release = (): void => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  let inFlight = 0;
  let finished = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST') inFlight += 1;
  });
  const done = (request: { method(): string }): void => {
    if (request.method() !== 'POST') return;
    inFlight -= 1;
    finished += 1;
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  await page.route('**/nastaveni**', async (route) => {
    if (route.request().method() === 'POST' && !held) {
      held = true;
      await released;
    }
    await route.continue().catch(() => {});
  });
  return {
    release,
    idle: async () => {
      await expect.poll(() => finished, { message: 'čekám na první dokončené uložení' }).toBeGreaterThan(0);
      // klid = žádné uložení neběží ani po chvíli (další se spouští až po vykreslení)
      await expect
        .poll(
          async () => {
            if (inFlight > 0) return false;
            await page.waitForTimeout(400);
            return inFlight === 0;
          },
          { message: 'čekám, až doběhnou všechna uložení' },
        )
        .toBe(true);
    },
  };
}

/** Hodnota je uložená na serveru: čerstvě načtená stránka ji ukazuje. */
async function expectSaved(page: Page, selector: string, value: string): Promise<void> {
  // stejně jako v `zaklad.spec.ts`: ověřuje se výsledek, ne jedna odpověď serveru
  await expect(async () => {
    await page.reload();
    await expect(page.locator(selector)).toHaveValue(value);
  }).toPass({ timeout: 20_000 });
  await autoSaveForm(page);
}

/**
 * Rozepsaná částka během ukládání jiného pole: uložení formulář vykreslí
 * znovu a text, který uživatel právě psal, by s ním zmizel. S vráceným
 * fokusem by navíc psal dál do staré hodnoty. Rozepsaný text se proto předá
 * novému poli a uloží se, jakmile ho uživatel opustí.
 */
test('nastavení: rozepsaná částka přežije uložení jiného pole a psaní pokračuje', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Rozepsáno', email: 'rozepsano@danero.cz' });
  await page.goto('/nastaveni');
  await autoSaveForm(page);
  const saves = await holdFirstSave(page);

  const matching = page.getByLabel('Párování prodejů');
  await matching.focus();
  await page.keyboard.press('ArrowDown');
  // uložení běží; uživatel mezitím píše částku
  const income = page.locator('#ostatni-prijmy');
  await income.click();
  await income.press('ControlOrMeta+a');
  await page.keyboard.type('4321');
  saves.release();
  await saves.idle();
  await autoSaveForm(page);

  // formulář se vykreslil znovu — rozepsaný text i fokus zůstaly
  await expect(matching).toHaveValue('LIFO');
  await expect(income).toHaveValue('4321');
  await expect(income).toBeFocused();
  // psaní pokračuje tam, kde skončilo
  await page.keyboard.type('5');
  await expect(income).toHaveValue('43215');
  await page.keyboard.press('Tab');
  await saves.idle();

  await expectSaved(page, '#ostatni-prijmy', '43215');
  await expect(matching).toHaveValue('LIFO');
});

test('nastavení: rozepsaná částka se uloží, i když po uložení jiného pole nic nepřipíšu', async ({
  page,
}) => {
  await registerWithProfile(page, { name: 'E2E Rozepsáno 2', email: 'rozepsano-2@danero.cz' });
  await page.goto('/nastaveni');
  await autoSaveForm(page);
  const saves = await holdFirstSave(page);

  const rates = page.getByLabel('Měnové kurzy');
  await rates.focus();
  await page.keyboard.press('ArrowDown');
  const income = page.locator('#ostatni-prijmy');
  await income.click();
  await income.press('ControlOrMeta+a');
  await page.keyboard.type('777');
  saves.release();
  await saves.idle();
  await autoSaveForm(page);
  await expect(income).toHaveValue('777');
  await expect(income).toBeFocused();

  // hodnotu vrácenou skriptem prohlížeč jako změnu neohlásí — opuštění pole ji odešle samo
  await page.keyboard.press('Tab');
  await saves.idle();
  await expectSaved(page, '#ostatni-prijmy', '777');
  await expect(rates).toHaveValue('CNB_DAILY');
});

/** Napíše do pole částky skutečnou klávesnicí — a pole neopustí. */
async function typeIncome(page: Page, text: string): Promise<void> {
  const income = page.locator('#ostatni-prijmy');
  await income.click();
  await income.press('ControlOrMeta+a');
  await page.keyboard.type(text);
}

/** Částka uložená na serveru: přečte ji čerstvě načtený panel téhož účtu. */
async function savedIncome(page: Page): Promise<string> {
  const probe = await page.context().newPage();
  try {
    await probe.goto('/nastaveni');
    return await probe.locator('#ostatni-prijmy').inputValue();
  } finally {
    await probe.close();
  }
}

const expectIncomeSaved = (page: Page, value: string): Promise<void> =>
  expect.poll(() => savedIncome(page), { message: `částka ${value} se má uložit` }).toBe(value);

/** Do Nastavení odkazem v aplikaci — přechod uvnitř směrovače, ne načtení dokumentu. */
async function openSettingsByLink(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Nastavení' }).first().click();
  await page.waitForURL('**/nastaveni');
  await autoSaveForm(page);
}

/**
 * Textové pole ohlásí změnu až s opuštěním. Kdo částku napsal a odešel, aniž
 * pole opustil, o ni přišel — změřeno 11. 10. 2026: v Chromiu při Zpět,
 * zavření panelu, F5 i odchodu na jinou adresu, ve Firefoxu při Zpět uvnitř
 * aplikace a zavření panelu. Rozepsaný text se proto ukládá i při odchodu.
 */
test('nastavení: rozepsaná částka se uloží i při odchodu, aniž pole opustím', async ({
  page,
  browserName,
}) => {
  await registerWithProfile(page, { name: 'E2E Odchod', email: 'odchod@danero.cz' });

  // ── Zpět uvnitř aplikace: formulář zaniká, potvrzení přijde na stránce, kam se odešlo ──
  await openSettingsByLink(page);
  await typeIncome(page, '1111');
  await page.goBack();
  await page.waitForURL(/\/import(\?|$)/);
  await expect(savedToast(page)).toBeVisible();
  await expectIncomeSaved(page, '1111');

  // ── odchod na jinou adresu (načtení jiného dokumentu) ───────────────────
  await page.goto('/nastaveni');
  await autoSaveForm(page);
  await typeIncome(page, '2222');
  await page.goto('/soukromi');
  await expectIncomeSaved(page, '2222');

  // ── F5: uloží se a nová stránka ji hned ukazuje ─────────────────────────
  await page.goto('/nastaveni');
  await autoSaveForm(page);
  await typeIncome(page, '3333');
  await page.reload();
  await autoSaveForm(page);
  await expect(page.locator('#ostatni-prijmy')).toHaveValue('3333');
  await expectIncomeSaved(page, '3333');

  // ── zavření panelu ──────────────────────────────────────────────────────
  // Ve Firefoxu z Playwrightu se tenhle krok zkoušet nedá: `page.close()`
  // v něm zhruba v jednom případě z dvaceti zavře panel dřív, než požadavek
  // odejde — na server nedorazí vůbec. Změřeno 12. 10. 2026 na 172 zavřeních:
  // ztraceno 8, stejně s `keepalive` i přes beacon, s pauzou před zavřením
  // i s `runBeforeUnload` (Chromium 0 z 30). Aplikace na tom nic nezmění,
  // obě cesty odeslání už používá; skutečný Firefox zbývá vyzkoušet ručně.
  if (browserName !== 'firefox') {
    const tab = await page.context().newPage();
    await tab.goto('/nastaveni');
    await autoSaveForm(tab);
    await typeIncome(tab, '4444');
    await tab.close();
    await expectIncomeSaved(page, '4444');
  }

  // ── Enter v poli uloží jednou (dřív odešla dvě stejná odeslání) ─────────
  await page.reload();
  await autoSaveForm(page);
  const saves = watchSaves(page);
  await typeIncome(page, '5555');
  await page.keyboard.press('Enter');
  await expect(savedToast(page)).toBeVisible();
  await expectIncomeSaved(page, '5555');
  expect(saves).toHaveLength(1);
});

/**
 * Neplatnou částku server neuloží. Dřív se o tom člověk dozvěděl jen tehdy,
 * když na stránce zůstal; při odchodu zmizela beze slova.
 */
test('nastavení: neplatná částka se nezahodí potichu a nebrzdí ostatní změny', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Neplatná', email: 'neplatna@danero.cz' });
  const refusal = page.getByRole('alert').filter({ hasText: 'Další zdanitelné příjmy zadej jako částku' });

  // ── odchod uvnitř aplikace: hláška přijde na stránce, kam se odešlo ─────
  await openSettingsByLink(page);
  await typeIncome(page, '12 000 Kč');
  await page.goBack();
  await page.waitForURL(/\/import(\?|$)/);
  await expect(refusal).toBeVisible();
  await expectIncomeSaved(page, '0');

  // ── opuštění pole: text zůstane k opravě a pole je označené ─────────────
  await page.goto('/nastaveni');
  await autoSaveForm(page);
  const income = page.locator('#ostatni-prijmy');
  await typeIncome(page, '12 000 Kč');
  await page.keyboard.press('Tab');
  await expect(refusal).toBeVisible();
  await expect(income).toHaveValue('12 000 Kč');
  await expect(income).toHaveAttribute('aria-invalid', 'true');

  // ── jiná změna se uloží i s neplatnou částkou vedle ─────────────────────
  await page.getByText('Cenné papíry v obchodním majetku').click();
  // hláška říká obojí: co se uložilo a že částka pořád ne (holé „Uloženo“ by
  // odmítnutí přebilo — revize R7, D2)
  await expect(
    page.getByRole('alert').filter({ hasText: 'Ostatní změny jsou uložené.' }),
  ).toContainText('Další zdanitelné příjmy zadej jako částku');
  await expect(savedToast(page)).toHaveCount(0);
  await expect
    .poll(async () => {
      const probe = await page.context().newPage();
      await probe.goto('/nastaveni');
      const checked = await probe.locator('#obchodni-majetek').isChecked();
      await probe.close();
      return checked;
    })
    .toBe(true);
  await expectIncomeSaved(page, '0');
  // uložení stránku dotáhlo ze serveru a formulář vznikl znovu — odmítnutý
  // text v něm zůstal i s označením
  await autoSaveForm(page);
  await expect(page.locator('#obchodni-majetek')).toHaveJSProperty('defaultChecked', true);
  await expect(income).toHaveValue('12 000 Kč');
  await expect(income).toHaveAttribute('aria-invalid', 'true');

  // ── zavírání panelu: není kde to říct, tak se prohlížeč zeptá ───────────
  await autoSaveForm(page);
  await typeIncome(page, 'abc');
  const dialog = page.waitForEvent('dialog');
  // obnovení čeká na odpověď na dotaz — nečeká se na něj
  void page.evaluate(() => window.location.reload()).catch(() => {});
  const question = await dialog;
  expect(question.type()).toBe('beforeunload');
  await question.dismiss();
  // kdo zůstal, vidí proč — a text má pořád v poli
  await expect(page.getByRole('alert').filter({ hasText: 'Zadej částku v korunách' })).toBeVisible();
  await expect(income).toHaveValue('abc');
});

/** Zdrží každé uložení akcí o `ms` — pomalé připojení. Vrací funkci, která zdržování zruší. */
async function slowSaves(page: Page, ms: number): Promise<() => Promise<void>> {
  const pattern = '**/nastaveni**';
  const handler = async (route: Route): Promise<void> => {
    const request = route.request();
    if (request.method() === 'POST' && request.headers()['next-action']) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
    await route.continue().catch(() => {});
  };
  await page.route(pattern, handler);
  return () => page.unroute(pattern, handler);
}

/** Hodnota pole uložená na serveru: přečte ji čerstvě načtený panel téhož účtu. */
async function savedValue(page: Page, selector: string): Promise<string> {
  const probe = await page.context().newPage();
  try {
    await probe.goto('/nastaveni');
    return await probe.locator(selector).inputValue();
  } finally {
    await probe.close();
  }
}

const MATCHING = 'select[name="parovani"]';

/**
 * Revize R7, D1 a D2 — neplatná částka v řadě s jinou změnou, na pomalém
 * připojení. Server odmítá formulář celý, takže:
 * - D1: změna zařazená ZA neplatnou částku nesla tentýž text a padla s ním.
 *   Nabídka ukazovala LIFO, v databázi zůstalo FIFO — a neuložilo se to ani
 *   při odchodu ze stránky.
 * - D2: neplatná částka zadaná hned PO jiné změně skončila hláškou „Uloženo“
 *   (z odeslání zbytku) a dotažení stránky ji z pole smazalo. Člověk odešel
 *   s tím, že příjmy zadal; limit se počítal s nulou.
 */
test('nastavení: neplatná částka v řadě s jinou změnou — změna se uloží, odmítnutí zůstane vidět', async ({
  page,
}) => {
  await registerWithProfile(page, { name: 'E2E Řada', email: 'rada@danero.cz' });
  await openSettingsByLink(page);
  const income = page.locator('#ostatni-prijmy');
  const matching = page.locator(MATCHING);
  const refusal = page.getByRole('alert').filter({ hasText: 'Další zdanitelné příjmy zadej jako částku' });
  /** Stránka je dotažená ze serveru: nabídka má novou volbu už v HTML. */
  const rendered = (value: string): Promise<void> =>
    expect(page.locator(`${MATCHING} option[value="${value}"]`)).toHaveJSProperty(
      'defaultSelected',
      true,
    );
  const fast = await slowSaves(page, 1500);

  // ── D1: částka (běží) a hned za ní nabídka (čeká) ───────────────────────
  await typeIncome(page, 'abc');
  await page.keyboard.press('Tab');
  await matching.selectOption('LIFO');
  await expect(refusal).toBeVisible();
  await expect.poll(() => savedValue(page, MATCHING), { message: 'párování se má uložit' }).toBe('LIFO');
  await rendered('LIFO');
  await autoSaveForm(page);
  await expect(matching).toHaveValue('LIFO');
  // odmítnutý text přežil i nové vykreslení formuláře a hláška o něm je poslední
  await expect(income).toHaveValue('abc');
  await expect(income).toHaveAttribute('aria-invalid', 'true');
  await expect(refusal).toBeVisible();
  await expect(savedToast(page)).toHaveCount(0);
  await expectIncomeSaved(page, '0');

  // ── D2: nabídka (běží) a hned za ní neplatná částka — dva tvary ─────────
  for (const [invalid, choice] of [
    ['12x', 'MAX_PROFIT'],
    ['50.000', 'MAX_LOSS'],
  ] as const) {
    await matching.selectOption(choice);
    await typeIncome(page, invalid);
    await page.keyboard.press('Tab');
    await expect.poll(() => savedValue(page, MATCHING)).toBe(choice);
    await rendered(choice);
    await autoSaveForm(page);
    await expect(income, `„${invalid}“ má zůstat v poli`).toHaveValue(invalid);
    await expect(income).toHaveAttribute('aria-invalid', 'true');
    await expect(refusal).toBeVisible();
    await expect(savedToast(page)).toHaveCount(0);
    await expectIncomeSaved(page, '0');
  }

  // ── oprava: platná částka se uloží, označení i hláška o chybě zmizí ─────
  await fast();
  await typeIncome(page, '50000');
  await page.keyboard.press('Tab');
  await expect(savedToast(page)).toBeVisible();
  await expectIncomeSaved(page, '50000');
  await expect(income).not.toHaveAttribute('aria-invalid', 'true');
  await expect(refusal).toHaveCount(0);
});

/** Napodobí skrytí a návrat panelu — v headless prohlížeči jinak nenastane. */
const setVisibility = (page: Page, state: 'hidden' | 'visible'): Promise<void> =>
  page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => next });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => next === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);

const LEAVING_NOTE = 'danero:leaving-draft';

/**
 * Revize R7, D3 — poznámka pro F5 (`lib/leaving-draft.ts`) se psala i při
 * pouhém skrytí panelu a nikdo ji nemazal. Do deseti vteřin: napíšu 5000,
 * přepnu panel (uloží se), vrátím se, přepíšu na 0, F5 → server pošle 0,
 * poznámka do pole vrátí 5000 a auto-save ho uloží. Hodnota, kterou uživatel
 * výslovně zrušil, byla zpátky v databázi — s hláškou „Uloženo“.
 */
test('nastavení: F5 nevrátí částku, kterou uživatel mezitím přepsal', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Poznámka', email: 'poznamka@danero.cz' });
  await page.goto('/nastaveni');
  await autoSaveForm(page);
  const income = page.locator('#ostatni-prijmy');

  await typeIncome(page, '5000');
  await setVisibility(page, 'hidden');
  await expectIncomeSaved(page, '5000');
  await setVisibility(page, 'visible');
  // stránka žije dál — poznámka pro F5 nevznikla
  expect(await page.evaluate((key) => sessionStorage.getItem(key), LEAVING_NOTE)).toBeNull();

  // uživatel si to rozmyslel
  await typeIncome(page, '0');
  await page.keyboard.press('Tab');
  await expectIncomeSaved(page, '0');

  const saves = watchSaves(page);
  await page.reload();
  await autoSaveForm(page);
  await expect(income).toHaveValue('0');
  // nic se po načtení neukládá a na serveru zůstala nula
  await expect(savedToast(page)).toHaveCount(0);
  expect(await savedIncome(page)).toBe('0');
  expect(saves).toEqual([]);

  // ── poznámka jiného účtu (odhlášení v jiném panelu ji smazat neumí) ─────
  await typeIncome(page, '7000');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  const note = JSON.parse(
    (await page.evaluate((key) => sessionStorage.getItem(key), LEAVING_NOTE)) ?? 'null',
  ) as { owner: string; fields: Record<string, { from: string; text: string }> } | null;
  // poznámka nese označení účtu — ne e-mail ani id
  expect(note?.owner).toMatch(/^[0-9a-f]{16}$/);
  expect(note?.fields['ostatni-prijmy']).toEqual({ from: '0', text: '7000' });
  await expectIncomeSaved(page, '7000');
  // tatáž poznámka s cizím označením a částkou, kterou server nemá
  await page.evaluate(
    ([key, raw]) => sessionStorage.setItem(key!, raw!),
    [
      LEAVING_NOTE,
      JSON.stringify({
        ...note,
        owner: 'cizi-ucet-000000',
        at: Date.now(),
        fields: { 'ostatni-prijmy': { from: '7000', text: '9999' } },
      }),
    ],
  );
  await page.reload();
  await autoSaveForm(page);
  await expect(income).toHaveValue('7000');
  expect(await savedIncome(page)).toBe('7000');
});

/**
 * Revize R7, M1 — hláška auto-save se z úložiště nikdy nemazala. Po návratu
 * z veřejné stránky se „Uloženo…“ ukázalo znovu a po odhlášení ho viděl i další
 * účet přihlášený v témže panelu (týž dokument, rozložení aplikace vzniklo
 * znovu). Text je obecný, ale je to nepravdivé potvrzení cizímu účtu.
 */
test('nastavení: hláška o uložení se neukáže znovu po návratu ani jinému účtu', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Druhý', email: 'hlaska-b@danero.cz' });
  await signOut(page);
  await registerWithProfile(page, { name: 'E2E První', email: 'hlaska-a@danero.cz' });
  await page.goto('/nastaveni');
  await autoSaveForm(page);
  const marker = await page.evaluate(() => {
    const value = Math.random();
    (window as unknown as { documentMarker: number }).documentMarker = value;
    return value;
  });
  const sameDocument = (): Promise<boolean> =>
    page.evaluate(
      (value) => (window as unknown as { documentMarker?: number }).documentMarker === value,
      marker,
    );

  // ── hláška zavřená uživatelem se po návratu z veřejné stránky neukáže ───
  await page.locator(MATCHING).selectOption('LIFO');
  await expect(savedToast(page)).toBeVisible();
  await savedToast(page).getByRole('button', { name: 'Zavřít' }).click();
  await expect(savedToast(page)).toHaveCount(0);
  await page.locator('footer a[href^="/podminky"]').first().click();
  await page.waitForURL('**/podminky**');
  await page.goBack();
  await page.waitForURL('**/nastaveni');
  await autoSaveForm(page);
  expect(await sameDocument()).toBe(true);
  await expect(savedToast(page)).toHaveCount(0);

  // ── hláška, která ještě svítí, se po odhlášení neukáže dalšímu účtu ─────
  await page.locator(MATCHING).selectOption('FIFO');
  await expect(savedToast(page)).toBeVisible();
  await signOut(page);
  await page.getByLabel('E-mail').fill('hlaska-b@danero.cz');
  await page.getByLabel('Heslo').fill('bezpecne-heslo-e2e');
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await page.waitForURL('**/prehled');
  await expect(page.getByRole('heading', { name: 'Přehled' })).toBeVisible();
  // týž dokument — úložiště hlášek přežilo, a přesto se nic neukáže
  expect(await sameDocument()).toBe(true);
  await expect(savedToast(page)).toHaveCount(0);
});

/**
 * Revize R7, M2 — ztracená odpověď. Požadavek dorazil a server zapsal, jen
 * odpověď se cestou ztratila (výpadek mobilní sítě). Obrazovka řekla „Uložení
 * se nepovedlo“ a vrátila nabídku na starou volbu, přestože v databázi byla
 * nová: ukazovala jiné párování, než kterým se počítá. Stránka teď netvrdí
 * nic, dokud si stav nevyžádá ze serveru — a formulář je do té doby zamčený.
 */
test('nastavení: po ztracené odpovědi ukáže obrazovka, co je opravdu uložené', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Odpověď', email: 'odpoved@danero.cz' });
  await page.goto('/nastaveni');
  await autoSaveForm(page);
  const matching = page.locator(MATCHING);
  // server odpovídá, jen odpověď na uložení nepřišla — spojení za to nemůže
  const unconfirmed = page.getByRole('alert').filter({ hasText: 'Uložení se nepotvrdilo.' });
  const unknown = page.getByRole('alert').filter({ hasText: 'Spojení vypadlo.' });
  // Revize R8, M3: zámek shodí fokus na stránku; po odemčení má být zpátky na
  // poli, kde byl — i když formulář mezitím vznikl znovu s jiným stavem.
  await matching.focus();
  let mode: 'lost-response' | 'never-sent' = 'lost-response';
  await page.route('**/nastaveni**', async (route) => {
    const request = route.request();
    if (!(request.method() === 'POST' && request.headers()['next-action'])) {
      return route.continue();
    }
    // server změnu zapíše, odpověď se ztratí — nebo požadavek vůbec neodejde
    if (mode === 'lost-response') await route.fetch();
    return route.abort('connectionfailed');
  });

  // ── server zapsal, odpověď se ztratila: obrazovka ukáže novou volbu ─────
  await matching.selectOption('LIFO');
  await expect(unconfirmed).toBeVisible();
  await autoSaveForm(page);
  await expect(matching).toHaveValue('LIFO');
  await expect(matching).toBeFocused();
  expect(await savedValue(page, MATCHING)).toBe('LIFO');

  // ── požadavek neodešel: obrazovka se vrátí na uložený stav ──────────────
  mode = 'never-sent';
  await matching.selectOption('MAX_PROFIT');
  await expect(unconfirmed).toBeVisible();
  await autoSaveForm(page);
  await expect(matching).toHaveValue('LIFO');
  await expect(matching).toBeFocused();
  expect(await savedValue(page, MATCHING)).toBe('LIFO');
  await expect(unknown).toHaveCount(0);

  // ── server není dosažitelný vůbec: formulář je zamčený a netvrdí nic ────
  await page.route('**/api/health', (route) => route.abort('connectionfailed'));
  await matching.selectOption('MAX_LOSS');
  // zámek je ohlášený (`role="alert"`) — čtečka jinak jen přijde o pole
  await expect(unknown).toBeVisible();
  const form = page.locator('form[data-auto-submit]');
  await expect(form).toHaveAttribute('data-auto-submit', 'unsynced');
  await expect(form).toHaveAttribute('aria-busy', 'true');
  await expect(form).toHaveJSProperty('inert', true);
  // spojení se vrátí: stránka si stav vyžádá sama a formulář odemkne
  await page.unroute('**/api/health');
  await autoSaveForm(page);
  await expect(form).not.toHaveAttribute('aria-busy', 'true');
  await expect(matching).toHaveValue('LIFO');
  await expect(matching).toBeFocused();
  // nabídka se nevrací beze slova: po odemčení zazní, že formulář ukazuje stav serveru
  await expect(unconfirmed).toBeVisible();
  expect(await savedValue(page, MATCHING)).toBe('LIFO');

  // a další změna se uloží jako obvykle
  await page.unroute('**/nastaveni**');
  await matching.selectOption('FIFO');
  await expect(savedToast(page)).toBeVisible();
  await expect.poll(() => savedValue(page, MATCHING)).toBe('FIFO');
});

/** Počítá server actions stránky: kolik jich odešlo a kolik doběhlo. */
function watchActions(page: Page): { sent: () => number; finished: () => number } {
  let sent = 0;
  let finished = 0;
  const isAction = (request: { method(): string; headers(): Record<string, string> }): boolean =>
    request.method() === 'POST' && Boolean(request.headers()['next-action']);
  page.on('request', (request) => {
    if (isAction(request)) sent += 1;
  });
  const done = (request: Parameters<typeof isAction>[0]): void => {
    if (isAction(request)) finished += 1;
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return { sent: () => sent, finished: () => finished };
}

/**
 * Revize R8, D1 — ochrana pořadí (R7, M3) zahazovala vrácení změny. Server
 * zapisuje jen pole jmenovaná a pole, která se liší od stavu při vykreslení;
 * změna vrácená na původní hodnotu je vidět jen podle jména, a to neslo jen
 * odeslání, které ji vracelo. Naměřeno 12. 10. 2026 v Chromiu i Firefoxu:
 * párování FIFO → LIFO (akce běží), zpět na FIFO (čeká), skrytí panelu pošle
 * vrácení cestou odchodu a to se zdrží; po návratu změna kurzů dorazí dřív,
 * server opožděné vrácení zahodí jako starší a zůstane na LIFO — s hláškou
 * „Uloženo“. Každé odeslání proto nese jména všech změn, které server ještě
 * nepotvrdil (`lib/save-queue.ts`).
 */
test('nastavení: vrácená změna se neztratí, když ji předběhne uložení jiného pole', async ({
  page,
}) => {
  await registerWithProfile(page, { name: 'E2E Vrácená změna', email: 'vracena-zmena@danero.cz' });
  await page.goto('/nastaveni');
  await autoSaveForm(page);
  const matching = page.locator(MATCHING);
  const rates = page.locator('select[name="kurzy"]');
  const actions = watchActions(page);

  // první akce chvíli běží; uložení při odchodu visí v síti, dokud ho test nepustí
  let releaseFirst = (): void => {};
  const firstHeld = new Promise<void>((resolve) => (releaseFirst = resolve));
  let releaseLeaving = (): void => {};
  const leavingHeld = new Promise<void>((resolve) => (releaseLeaving = resolve));
  let held = false;
  await page.route('**/nastaveni**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && request.headers()['next-action'] && !held) {
      held = true;
      await firstHeld;
    }
    await route.continue().catch(() => {});
  });
  let leavingDone = 0;
  await page.route('**/api/settings/profile', async (route) => {
    await leavingHeld;
    await route.continue().catch(() => {});
  });
  page.on('requestfinished', (request) => {
    if (request.url().includes('/api/settings/profile')) leavingDone += 1;
  });

  await matching.selectOption('LIFO'); // 1: akce běží
  await matching.selectOption('FIFO'); // 2: uživatel si to rozmyslel — čeká
  await setVisibility(page, 'hidden'); // 2 odchází cestou odchodu a zdrží se
  releaseFirst();
  await expect.poll(actions.finished, { message: 'první akce má doběhnout' }).toBe(1);
  await setVisibility(page, 'visible');
  await expect(matching).toHaveValue('FIFO');
  await rates.selectOption('CNB_DAILY'); // 3: jiné pole, dorazí dřív než 2
  await expect.poll(actions.finished, { message: 'změna kurzů má doběhnout' }).toBe(2);
  releaseLeaving();
  await expect.poll(() => leavingDone, { message: 'opožděné vrácení má dorazit' }).toBe(1);

  await autoSaveForm(page);
  await expect(matching).toHaveValue('FIFO');
  await expect(rates).toHaveValue('CNB_DAILY');
  expect(await savedValue(page, MATCHING)).toBe('FIFO');
  expect(await savedValue(page, 'select[name="kurzy"]')).toBe('CNB_DAILY');
});

/**
 * Nález revize oprav R8. Formulář vykreslený znovu uprostřed ukládání dostával
 * CELÝ stav odeslání, které právě odchází — i pole, na která uživatel nesáhl.
 * V panelu se starým stavem tak do nového formuláře (který už ukazoval změnu
 * udělanou jinde) vrátil starou hodnotu, a ta se od stavu při vykreslení
 * lišila: další změna v tom panelu ji zapsala a cizí změnu potichu přepsala.
 * Formulář teď z odcházejícího odeslání přebírá jen pole, která uživatel
 * opravdu změnil.
 */
test('nastavení: starý panel nepřepíše cizí změnu, ani když se vykreslí znovu uprostřed ukládání', async ({
  page,
  browser,
}) => {
  await registerWithProfile(page, { name: 'E2E Panel v běhu', email: 'stary-panel-v-behu@danero.cz' });
  await page.goto('/nastaveni');
  await autoSaveForm(page);
  const matching = page.locator(MATCHING);
  const actions = watchActions(page);

  // jinde (jiný panel téhož účtu) se mezitím změní párování
  const elsewhere = await browser.newContext({ storageState: await page.context().storageState() });
  const other = await elsewhere.newPage();
  await other.goto('/nastaveni');
  await autoSaveForm(other);
  await other.locator(MATCHING).selectOption('LIFO');
  await expect(savedToast(other)).toBeVisible();
  await elsewhere.close();
  await expect(matching).toHaveValue('FIFO');

  // dotažení stránky po prvním uložení a uložení při odchodu se zdrží, dokud
  // test neřekne — formulář tak vznikne znovu, zatímco odchodové uložení běží
  let releaseRefresh = (): void => {};
  const refreshHeld = new Promise<void>((resolve) => (releaseRefresh = resolve));
  let releaseLeaving = (): void => {};
  const leavingHeld = new Promise<void>((resolve) => (releaseLeaving = resolve));
  let refreshes = 0;
  let leavingSent = 0;
  let leavingDone = 0;
  await page.route('**/nastaveni**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' && request.headers()['rsc']) {
      refreshes += 1;
      if (refreshes === 1) await refreshHeld;
    }
    await route.continue().catch(() => {});
  });
  await page.route('**/api/settings/profile', async (route) => {
    leavingSent += 1;
    await leavingHeld;
    await route.continue().catch(() => {});
  });
  page.on('requestfinished', (request) => {
    if (request.url().includes('/api/settings/profile')) leavingDone += 1;
  });

  await page.locator('select[name="kurzy"]').selectOption('CNB_DAILY'); // 1: uloží se, stránka se dotahuje
  await expect.poll(() => refreshes, { message: 'stránka se má po uložení dotahovat' }).toBe(1);
  await typeIncome(page, '4321'); // 2: rozepsaná částka odejde se skrytím panelu
  await setVisibility(page, 'hidden');
  await expect.poll(() => leavingSent).toBe(1);
  releaseRefresh();

  // formulář vznikl znovu se stavem serveru; odchodové uložení pořád běží
  await expect(page.locator('input[name="puvodni-stav"]')).toHaveValue(/parovani=LIFO/);
  await expect(page.locator('#ostatni-prijmy'), 'částka, která právě odchází, zůstává vidět').toHaveValue('4321');
  await expect(matching, 'pole, na které uživatel nesáhl, ukazuje stav serveru').toHaveValue('LIFO');

  // návrat do panelu a další změna dřív, než odchodové uložení doběhne
  await setVisibility(page, 'visible');
  await page.locator('select[name="zaklad-casoveho-testu"]').selectOption('trade');
  await expect.poll(actions.finished, { message: 'mají doběhnout dvě akce' }).toBe(2);
  releaseLeaving();
  await expect.poll(() => leavingDone).toBe(1);
  await autoSaveForm(page);

  expect(await savedValue(page, MATCHING), 'cizí změna párování má zůstat').toBe('LIFO');
  expect(await savedValue(page, 'select[name="kurzy"]')).toBe('CNB_DAILY');
  expect(await savedValue(page, 'select[name="zaklad-casoveho-testu"]')).toBe('trade');
  expect(await savedIncome(page)).toBe('4321');
});

/**
 * Revize R8, D2 — server na uložení odpovídá chybou (500, zásah WAF), ale jinak
 * běží. Rozepsaná částka se po dotažení stránky poslala znovu, to selhalo,
 * stránka se dotáhla… 36 kol za 12 s, formulář blikal mezi zamčeným
 * a odemčeným a hláška se ohlásila 36×. Teď: jeden pokus, jedna hláška, text
 * zůstane v poli a odejde s další změnou, kterou člověk udělá.
 */
test('nastavení: po chybě serveru se uložení částky neopakuje samo', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Chyba serveru', email: 'chyba-serveru@danero.cz' });
  await page.goto('/nastaveni');
  await autoSaveForm(page);
  const actions = watchActions(page);
  let failing = true;
  let healthChecks = 0;
  await page.route('**/nastaveni**', async (route) => {
    const request = route.request();
    if (failing && request.method() === 'POST' && request.headers()['next-action']) {
      return route.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' });
    }
    return route.continue().catch(() => {});
  });
  page.on('request', (request) => {
    if (request.url().includes('/api/health')) healthChecks += 1;
  });
  // každá hláška, která se na stránce objeví (i ta, která mezitím zmizela)
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { alertsSeen: string[] }).alertsSeen = seen;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          const alert = node.matches('[role="alert"]') ? node : node.querySelector('[role="alert"]');
          if (alert?.textContent) seen.push(alert.textContent.trim());
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  const alertsSeen = (): Promise<string[]> =>
    page.evaluate(() => (window as unknown as { alertsSeen: string[] }).alertsSeen);

  const income = page.locator('#ostatni-prijmy');
  await typeIncome(page, '4321');
  await page.keyboard.press('Tab');
  const unsaved = page.getByRole('alert').filter({ hasText: 'Uložení se nepovedlo.' });
  await expect(unsaved).toBeVisible();
  await autoSaveForm(page);
  // dost dlouho na to, aby se dřívější smyčka otočila desetkrát
  await page.waitForTimeout(3000);
  expect(actions.sent(), 'uložení se má zkusit jednou').toBe(1);
  expect(healthChecks).toBe(1);
  expect(await alertsSeen()).toHaveLength(1);
  // text zůstal v poli, formulář jde ovládat a fokus je tam, kam uživatel přešel
  await expect(income).toHaveValue('4321');
  await expect(page.locator('#obchodni-majetek')).toBeFocused();
  expect(await savedIncome(page)).toBe('0');

  // ── server už odpovídá: částka odejde s další změnou ─────────────────────
  failing = false;
  await page.locator(MATCHING).selectOption('LIFO');
  await expect(savedToast(page)).toBeVisible();
  expect(actions.sent()).toBe(2);
  await expectIncomeSaved(page, '4321');
  expect(await savedValue(page, MATCHING)).toBe('LIFO');

  // ── a stejně tak, když se člověk do pole jen vrátí a zase ho opustí ──────
  await autoSaveForm(page);
  failing = true;
  await typeIncome(page, '555');
  await page.keyboard.press('Tab');
  await expect(unsaved).toBeVisible();
  await autoSaveForm(page);
  expect(actions.sent()).toBe(3);
  failing = false;
  await income.focus();
  await page.keyboard.press('Tab');
  await expectIncomeSaved(page, '555');
  expect(actions.sent()).toBe(4);
});

/**
 * Revize R8, M1 — fronta auto-save žije s dokumentem, ne s přihlášením.
 * Odeslání účtu A viselo v síti, A se odhlásil a v témže panelu se přihlásil
 * B: formulář B ukázal volbu účtu A (jako „stav, který právě odchází“)
 * a s další změnou ji zapsal do svého profilu. Pozdržené odeslání navíc
 * dorazilo s cookie účtu B a server ho zapsal taky.
 */
test('nastavení: rozdělané uložení jednoho účtu se nedostane k dalšímu v témže panelu', async ({
  page,
}) => {
  await registerWithProfile(page, { name: 'E2E Druhý', email: 'fronta-b@danero.cz' });
  await signOut(page);
  await registerWithProfile(page, { name: 'E2E První', email: 'fronta-a@danero.cz' });
  await page.goto('/nastaveni');
  await autoSaveForm(page);
  const marker = await page.evaluate(() => {
    const value = Math.random();
    (window as unknown as { documentMarker: number }).documentMarker = value;
    return value;
  });
  const saves = await holdFirstSave(page);
  // těla odeslání formuláře nastavení (jiné akce na stránce sem nepatří)
  const bodies: string[] = [];
  page.on('request', (request) => {
    const body = request.method() === 'POST' ? (request.postData() ?? '') : '';
    if (request.headers()['next-action'] && body.includes('puvodni-stav')) bodies.push(body);
  });

  // uložení účtu A visí v síti; A se odhlásí a přihlásí se B
  await page.locator(MATCHING).selectOption('MAX_LOSS');
  await signOut(page);
  await page.getByLabel('E-mail').fill('fronta-b@danero.cz');
  await page.getByLabel('Heslo').fill('bezpecne-heslo-e2e');
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await page.waitForURL('**/prehled');
  await openSettingsByLink(page);
  expect(
    await page.evaluate(
      (value) => (window as unknown as { documentMarker?: number }).documentMarker === value,
      marker,
    ),
    'má jít o týž dokument — jinak by fronta zanikla sama',
  ).toBe(true);

  // formulář B ukazuje stav účtu B a jeho změna nese jen to, co změnil on
  await expect(page.locator(MATCHING)).toHaveValue('FIFO');
  await page.locator('select[name="kurzy"]').selectOption('CNB_DAILY');
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).not.toMatch(/zmenene-pole"\r\n\r\nparovani/);
  expect(bodies[1]).toMatch(/zmenene-pole"\r\n\r\nkurzy/);

  // pozdržené odeslání účtu A dorazí až teď — s cookie účtu B
  saves.release();
  await saves.idle();
  await expect.poll(() => savedValue(page, 'select[name="kurzy"]')).toBe('CNB_DAILY');
  expect(await savedValue(page, MATCHING)).toBe('FIFO');
});

/**
 * Odhlášení fronty auto-save zahazuje (viz test výš) — změna, která při
 * klepnutí na „Odhlásit se“ teprve čekala na uložení, se ale ztratit nesmí.
 * Tlačítko proto nejdřív nechá doběhnout, co čeká, a teprve pak odhlašuje.
 */
test('nastavení: změny udělané těsně před odhlášením se ještě uloží', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Před odhlášením', email: 'pred-odhlasenim@danero.cz' });
  await page.goto('/nastaveni');
  await autoSaveForm(page);
  // první uložení chvíli běží, takže druhá změna čeká ve frontě
  const restore = await slowSaves(page, 1500);
  await page.locator(MATCHING).selectOption('LIFO');
  await page.locator('select[name="kurzy"]').selectOption('CNB_DAILY');
  await signOut(page);
  await restore();

  await page.getByLabel('E-mail').fill('pred-odhlasenim@danero.cz');
  await page.getByLabel('Heslo').fill('bezpecne-heslo-e2e');
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await page.waitForURL('**/prehled');
  await page.goto('/nastaveni');
  await autoSaveForm(page);
  await expect(page.locator(MATCHING)).toHaveValue('LIFO');
  await expect(page.locator('select[name="kurzy"]')).toHaveValue('CNB_DAILY');
});

/**
 * Revize R8 (N1) — přihlášení vypršelo a formulář ukládá. Nesmí skončit
 * zamčený s hláškou o spojení: člověk má skončit na přihlášení, ať ukládá
 * akce, nebo požadavek při odchodu.
 */
test('nastavení: uložení po vypršelém přihlášení vede na přihlášení, ne k zámku', async ({
  page,
}) => {
  await registerWithProfile(page, { name: 'E2E Vypršelo', email: 'vyprselo@danero.cz' });
  const signInAgain = async (): Promise<void> => {
    await page.getByLabel('E-mail').fill('vyprselo@danero.cz');
    await page.getByLabel('Heslo').fill('bezpecne-heslo-e2e');
    await page.getByRole('button', { name: 'Přihlásit se' }).click();
    await page.waitForURL('**/prehled');
    await page.goto('/nastaveni');
    await autoSaveForm(page);
  };
  const lost = page.getByRole('alert').filter({ hasText: /Spojení vypadlo|Uložení se/ });

  // ── běžné uložení (server action) ────────────────────────────────────────
  await page.goto('/nastaveni');
  await autoSaveForm(page);
  await page.context().clearCookies();
  await page.locator(MATCHING).selectOption('LIFO');
  await page.waitForURL('**/prihlaseni**');
  await expect(lost).toHaveCount(0);

  // ── uložení při odchodu (skrytý panel s rozepsanou částkou) ──────────────
  await signInAgain();
  await typeIncome(page, '4321');
  await page.context().clearCookies();
  const leaving = page.waitForResponse((response) =>
    response.url().includes('/api/settings/profile'),
  );
  await setVisibility(page, 'hidden');
  expect((await leaving).status()).toBe(401);
  await page.waitForURL('**/prihlaseni**');
  await expect(lost).toHaveCount(0);

  // nic z toho se neuložilo
  await signInAgain();
  await expect(page.locator(MATCHING)).toHaveValue('FIFO');
  await expect(page.locator('#ostatni-prijmy')).toHaveValue('0');
});

/**
 * Uložení dřív končilo přesměrováním s potvrzením v adrese: každá změna
 * přidala krok do historie prohlížeče (po třech změnách čtyři stisky Zpět)
 * a v adrese po ní zůstala kotva.
 */
test('nastavení: uložení nemění adresu, historii prohlížeče ani polohu stránky', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Historie', email: 'historie@danero.cz' });
  let finishedSaves = 0;
  page.on('requestfinished', (request) => {
    if (request.method() === 'POST') finishedSaves += 1;
  });
  const savesFinished = (count: number) =>
    expect.poll(() => finishedSaves, { message: `čekám na ${count} dokončených uložení` }).toBe(count);
  /** Přepne nabídku klávesnicí na druhou volbu. */
  const flip = async (label: string): Promise<void> => {
    await page.getByLabel(label).focus();
    await page.keyboard.press('ArrowDown');
  };

  await openSettingsByLink(page);
  const entries = await page.evaluate(() => window.history.length);
  await flip('Párování prodejů');
  await savesFinished(1);
  await flip('Měnové kurzy');
  await savesFinished(2);
  // Doběhlé odeslání ještě není nový formulář: stránka se po něm dotahuje ze
  // serveru zvlášť. Test na další pole sáhne, až ho má — jinak mu prvek
  // zanikne pod rukou (Firefox: „Element is not attached to the DOM“).
  await expectFormMatchesBaseline(page);

  // změna dole na stránce ji nesmí vrátit nahoru
  const lowest = page.getByLabel('Vratka kapitálu');
  // předchozí uložení stránku ještě dotahuje ze serveru a formulář při tom
  // vzniká znovu — pole, které test právě drží, může zaniknout pod rukama
  // (ve Firefoxu naměřeno 12. 10. 2026: „Element is not attached to the DOM“)
  await expect(async () => {
    await lowest.scrollIntoViewIfNeeded();
    await lowest.focus();
    await expect(lowest).toBeFocused();
  }).toPass();
  const scrolled = await page.evaluate(() => Math.round(window.scrollY));
  expect(scrolled).toBeGreaterThan(0);
  await page.keyboard.press('ArrowDown');
  await savesFinished(3);
  await expect(savedToast(page)).toBeVisible();
  await autoSaveForm(page);
  await expect(lowest).toHaveValue('lenient');
  // Poloha se měří až po novém vykreslení formuláře: právě ono stránku ve
  // WebKitu vracelo na začátek (kotvení rolování neumí; 12. 10. 2026: 516 → 0 px).
  await expectFormMatchesBaseline(page);
  expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(scrolled);

  // adresa je pořád táž a historie nepřibyla
  expect(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash).toBe(
    '/nastaveni',
  );
  expect(await page.evaluate(() => window.history.length)).toBe(entries);

  // totéž na stránce upozornění
  await page.getByRole('link', { name: 'Upozornění' }).first().click();
  await page.waitForURL('**/nastaveni/upozorneni');
  await autoSaveForm(page);
  await page.getByText('Naléhavé posílat hned').click();
  await savesFinished(4);
  await expect(savedToast(page)).toBeVisible();
  expect(page.url()).toMatch(/\/nastaveni\/upozorneni$/);

  // jeden stisk Zpět = o stránku zpět, ne o jednu změnu
  await page.goBack();
  await expect(page).toHaveURL(/\/nastaveni$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/import(\?|$)/);
});

/**
 * Zpět a Vpřed uvnitř aplikace vracel směrovač ze své paměti a serveru se
 * nezeptal — Nastavení ukázalo stav z doby před odchodem (změřeno
 * 11. 10. 2026 v Chromiu i Firefoxu). Rozložení aplikace proto po návratu
 * stránku obnoví (`RefreshOnRestore`).
 */
test('nastavení: Zpět a Vpřed uvnitř aplikace ukážou stav ze serveru', async ({ page, browser }) => {
  await registerWithProfile(page, { name: 'E2E Směrovač', email: 'smerovac@danero.cz' });
  await openSettingsByLink(page);
  const matching = page.getByLabel('Párování prodejů');
  await expect(matching).toHaveValue('FIFO');
  // odchod odkazem v aplikaci — stránka zůstává v paměti směrovače
  await page.getByRole('link', { name: 'Zdroje dat' }).first().click();
  await page.waitForURL(/\/import(\?|$)/);

  const elsewhere = await browser.newContext({ storageState: await page.context().storageState() });
  const other = await elsewhere.newPage();
  await other.goto('/nastaveni');
  await autoSaveForm(other);
  await other.getByLabel('Párování prodejů').selectOption('LIFO');
  await expect(savedToast(other)).toBeVisible();

  const saves = watchSaves(page);
  await page.goBack();
  await page.waitForURL('**/nastaveni');
  await expect(matching).toHaveValue('LIFO');
  await autoSaveForm(page);
  await expectFormMatchesBaseline(page);

  // o krok dál zpět, další změna jinde, a Vpřed
  await page.goBack();
  await page.waitForURL(/\/import(\?|$)/);
  await other.getByLabel('Měnové kurzy').selectOption('CNB_DAILY');
  await expect(savedToast(other)).toBeVisible();
  await page.goForward();
  await page.waitForURL('**/nastaveni');
  await expect(page.getByLabel('Měnové kurzy')).toHaveValue('CNB_DAILY');
  await expect(matching).toHaveValue('LIFO');
  await autoSaveForm(page);
  await expectFormMatchesBaseline(page);
  // obnovení nic neukládá
  expect(saves).toEqual([]);
  await elsewhere.close();
});

/**
 * Aplikace se bez JavaScriptu nevykreslí: obsah se posílá po částech a na
 * místo ho skládá skript. Dřív zůstala na obrazovce kostra načítání, která
 * se nikdy nedočkala. Teď stránka řekne, co chybí — a přihlášení, které bez
 * skriptu taky nefunguje, aspoň nepošle heslo do adresy.
 */
test('bez JavaScriptu aplikace, demo i přihlášení řeknou, co chybí', async ({ page, browser }) => {
  await registerWithProfile(page, { name: 'E2E Bez skriptů', email: 'bez-skriptu@danero.cz' });
  const context = await browser.newContext({
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  const plain = await context.newPage();
  // Co je na stránce doopravdy vidět. Lokátory Playwrightu obsah `<noscript>`
  // přeskakují (počítají s tím, že skripty běží), `innerText` ne — a skryté
  // prvky do něj nepatří.
  const shown = async (): Promise<string> =>
    (await plain.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  const NOTICE =
    'Danero potřebuje zapnutý JavaScript. Zapni ho v nastavení prohlížeče a načti stránku znovu.';

  for (const path of ['/nastaveni', '/prehled', '/demo/prehled']) {
    await plain.goto(path);
    await expect.poll(shown, { message: path }).toContain(NOTICE);
    // kostra načítání, která by se nedočkala obsahu, vidět není
    await expect(plain.locator('[data-app-skeleton]'), path).toBeHidden();
  }

  // veřejná stránka se čte i bez skriptů a nic takového neříká
  await plain.goto('/podminky');
  await expect(plain.getByRole('heading', { level: 1, name: 'Podmínky užití' })).toBeVisible();
  expect(await shown()).not.toContain('potřebuje zapnutý JavaScript');

  // přihlášení: sdělení, a odeslání prohlížečem nenechá heslo v adrese
  await plain.goto('/prihlaseni');
  await expect.poll(shown).toContain(NOTICE);
  await plain.getByLabel('E-mail').fill('bez-skriptu@danero.cz');
  await plain.getByLabel('Heslo').fill('bezpecne-heslo-e2e');
  await plain.getByRole('button', { name: 'Přihlásit se' }).click();
  await plain.waitForLoadState();
  expect(plain.url()).not.toContain('heslo');
  expect(plain.url()).not.toContain('bezpecne-heslo-e2e');
  await context.close();
});
