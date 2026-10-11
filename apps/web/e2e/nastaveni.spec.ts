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
test('nastavení: rozepsaná částka se uloží i při odchodu, aniž pole opustím', async ({ page }) => {
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
  const tab = await page.context().newPage();
  await tab.goto('/nastaveni');
  await autoSaveForm(tab);
  await typeIncome(tab, '4444');
  await tab.close();
  await expectIncomeSaved(page, '4444');

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
  await expect(savedToast(page)).toBeVisible();
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

  // změna dole na stránce ji nesmí vrátit nahoru
  const lowest = page.getByLabel('Vratka kapitálu');
  await lowest.scrollIntoViewIfNeeded();
  await lowest.focus();
  const scrolled = await page.evaluate(() => Math.round(window.scrollY));
  expect(scrolled).toBeGreaterThan(0);
  await page.keyboard.press('ArrowDown');
  await savesFinished(3);
  await expect(savedToast(page)).toBeVisible();
  await autoSaveForm(page);
  await expect(lowest).toHaveValue('lenient');
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
