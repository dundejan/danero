import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { pageSettled } from './helpers';

/**
 * Sdílené jádro auditu přístupnosti (H-28).
 *
 * Vlastní modul, ne pomocníci uvnitř specu: audit jde tak použít z víc
 * souborů — import ze souboru s `test(...)` by jeho testy zaregistroval
 * podruhé.
 */
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };
const VIEWPORTS = { mobil: MOBILE, desktop: DESKTOP } as const;
type Viewport = keyof typeof VIEWPORTS;

/**
 * Nálezy, které stránku shodí.
 *
 * Původně `critical` + `serious`. Jenže rozbitá struktura landmarků (dva
 * `<main>`, duplicitní `id`) je pro axe **`moderate`** — takže 404 uvnitř
 * aplikace prošla sadou bez povšimnutí (audit H2-05a). Práh je proto
 * `moderate`; pod ním zůstává jen `minor` (kosmetika typu `empty-table-header`).
 */
const BLOCKING_IMPACTS = new Set(['critical', 'serious', 'moderate']);

/**
 * Kontroly jsou `soft`: jeden běh trvá minuty, takže musí vypsat VŠECHNY
 * stránky najednou — tvrdý expect by sadu zastavil na první z nich a na
 * zbytek by se přišlo až za dalších pár minut.
 */
async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect.soft(overflow, `${label} přetéká vodorovně o ${overflow}px`).toBeLessThanOrEqual(1);
}

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ''));
  // porovnává se seznam popisů, ne celé objekty nálezů — hláška při pádu se
  // pak dá přečíst (celý axe node má stovky řádků JSONu)
  const summary = blocking.map(
    (v) => `${v.id} [${v.impact}] ${v.nodes.length}× ${v.help} @ ${v.nodes[0]?.target.join(' ')}`,
  );
  expect.soft(summary, `${label}`).toEqual([]);
}

/**
 * Právě jeden `<main>` a právě jedno `id="obsah"`.
 *
 * axe to sice hlásí taky (`landmark-no-duplicate-main`, `landmark-unique`), ale
 * jen jako `moderate` a s hláškou, ze které není poznat příčinu. Tenhle test
 * pojmenuje přesně to, co se rozbilo: shell se vykreslil uvnitř jiného shellu.
 * Skip-link „Přeskočit na obsah“ míří na `#obsah` — se dvěma stejnými `id`
 * skočí na to první, tedy nikoli na obsah stránky.
 */
async function expectSingleContentLandmark(page: Page, label: string) {
  const counts = await page.evaluate(() => ({
    main: document.querySelectorAll('main').length,
    obsah: document.querySelectorAll('#obsah').length,
  }));
  const problemy: string[] = [];
  if (counts.main !== 1) problemy.push(`<main> ${counts.main}× (má být právě 1)`);
  // přihlašovací stránky skip-link nemají (jeden krátký formulář, není co
  // přeskakovat), takže 0 je v pořádku — chybou je až duplicita
  if (counts.obsah > 1) problemy.push(`id="obsah" ${counts.obsah}× (dvojznačná kotva)`);
  expect.soft(problemy, label).toEqual([]);
}

/**
 * Počká, až doběhnou přechody na stránce. Bublina, dialog i sheet přijíždějí
 * prolnutím — axe by jinak měřil kontrast napůl průhledného textu a nález by
 * záležel na tom, v které milisekundě se trefil.
 *
 * Počítají se jen BĚŽÍCÍ animace s konečnou délkou: nekonečná (točící se
 * ukazatel průběhu) ani pozastavená nedoběhne nikdy a čekání na její
 * `finished` by viselo do limitu testu.
 */
async function settleAnimations(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.getAnimations().filter((animation) => {
              const end = animation.effect?.getComputedTiming().endTime;
              return animation.playState === 'running' && Number.isFinite(Number(end));
            }).length,
        ),
      { message: 'přechody na stránce nedoběhly' },
    )
    .toBe(0);
}

/** Zkontroluje, že stránka opravdu přepnula barevný režim, který se má měřit. */
async function switchScheme(page: Page, scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme });
  // ThemeProvider přepíná třídu na <html> podle systémového nastavení;
  // bez téhle kontroly by se „tmavý“ průchod mohl tiše měřit ve světlém
  await expect
    .soft(page.locator('html'))
    .toHaveClass(scheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b).*$/);
}

/**
 * Rozbalí všechny rozbalovací řádky a detaily na stránce — klepnutím, jako
 * uživatel, takže zároveň ověří, že se k obsahu dá dostat. Opakuje se, dokud
 * je co otevírat: rozbalený řádek může nést další (návod uvnitř formuláře).
 */
export async function expandAllDisclosures(page: Page) {
  const closed = page.locator('details:not([open]) > summary:visible');
  for (let opened = 0; opened < 200 && (await closed.count()) > 0; opened += 1) {
    await closed.first().click();
  }
  expect.soft(await closed.count(), 'některý rozbalovací řádek nejde otevřít').toBe(0);
}

/**
 * Jeden průchod stránkou: světlý i tmavý režim, mobil i desktop.
 *
 * `prepare` uvede stránku do stavu, který se má měřit a který přežije změnu
 * šířky i režimu (rozbalené řádky, vyplněná kalkulačka). Stavy vázané na
 * šířku okna — sheet, bublina, dialog — měří `auditOverlay`.
 */
export async function auditPage(
  page: Page,
  path: string,
  prepare?: { label: string; run: (page: Page) => Promise<void> },
) {
  const name = prepare ? `${path} — ${prepare.label}` : path;
  await page.setViewportSize(DESKTOP);
  await page.goto(path);
  await pageSettled(page);
  // Stránka, která přesměruje (objednávka bez čeho koupit, onboarding s daty),
  // by se jinak tiše auditovala jako cíl přesměrování — sada by hlásila zeleň
  // za stránku, kterou nikdy nenačetla.
  const cil = new URL(page.url());
  expect
    .soft(`${cil.pathname}${cil.search}`, `${path} přesměrovalo jinam — audit měřil něco jiného`)
    .toBe(path);
  await expectSingleContentLandmark(page, name);
  await prepare?.run(page);
  // kurzor zůstává tam, kam naposledy klikl test — jinak by axe měřil `:hover`
  // stav náhodného prvku pod ním a nález by záležel na rozložení stránky
  await page.mouse.move(0, 0);

  for (const scheme of ['light', 'dark'] as const) {
    await switchScheme(page, scheme);

    for (const viewport of ['mobil', 'desktop'] as const) {
      await page.setViewportSize(VIEWPORTS[viewport]);
      // grafy se překreslují přes ResizeObserver — bez snímku navíc by axe
      // měřil na plátně o předchozí šířce
      await page.waitForTimeout(150);
      if (viewport === 'mobil') {
        await expectNoHorizontalOverflow(page, `${name} (${scheme}, ${viewport})`);
      }
      await expectNoSeriousViolations(page, `${name} (${scheme}, ${viewport})`);
    }
  }
}

/**
 * Audit překryvu, který vznikne až interakcí a patří k jedné šířce okna:
 * spodní sheet na telefonu, bublina vysvětlivky v širokém okně, potvrzovací
 * dialog. `open` ho otevře (a počká, až je vidět); měří se ve světlém
 * i tmavém režimu se stejným prahem jako celé stránky.
 */
export async function auditOverlay(
  page: Page,
  {
    label,
    path,
    viewport,
    open,
  }: { label: string; path: string; viewport: Viewport; open: (page: Page) => Promise<void> },
) {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize(VIEWPORTS[viewport]);
  await page.goto(path);
  await open(page);
  await page.mouse.move(0, 0);

  for (const scheme of ['light', 'dark'] as const) {
    await switchScheme(page, scheme);
    await settleAnimations(page);
    const name = `${path} — ${label} (${scheme}, ${viewport})`;
    if (viewport === 'mobil') await expectNoHorizontalOverflow(page, name);
    await expectNoSeriousViolations(page, name);
  }
}
