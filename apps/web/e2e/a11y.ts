import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * Sdílené jádro auditu přístupnosti (H-28).
 *
 * Vlastní modul, ne pomocníci uvnitř specu: stejný audit potřebuje i sada
 * `e2e-paywall` (objednávkové stránky existují jedině se zapnutými platbami),
 * a import ze souboru s `test(...)` by ty testy zaregistroval podruhé.
 */
export const MOBILE = { width: 390, height: 844 };
export const DESKTOP = { width: 1280, height: 900 };

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

/** Jeden průchod stránkou: světlý i tmavý režim, mobil i desktop. */
export async function auditPage(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  // Stránka, která přesměruje (objednávka bez čeho koupit, onboarding s daty),
  // by se jinak tiše auditovala jako cíl přesměrování — sada by hlásila zeleň
  // za stránku, kterou nikdy nenačetla.
  const cil = new URL(page.url());
  expect
    .soft(`${cil.pathname}${cil.search}`, `${path} přesměrovalo jinam — audit měřil něco jiného`)
    .toBe(path);
  await expectSingleContentLandmark(page, path);
  // kurzor zůstává tam, kam naposledy klikl test — jinak by axe měřil `:hover`
  // stav náhodného prvku pod ním a nález by záležel na rozložení stránky
  await page.mouse.move(0, 0);

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // ThemeProvider přepíná třídu na <html> podle systémového nastavení;
    // bez téhle kontroly by se „tmavý“ průchod mohl tiše měřit ve světlém
    await expect
      .soft(page.locator('html'))
      .toHaveClass(scheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b).*$/);

    for (const [name, size] of [
      ['mobil', MOBILE],
      ['desktop', DESKTOP],
    ] as const) {
      await page.setViewportSize(size);
      // grafy se překreslují přes ResizeObserver — bez snímku navíc by axe
      // měřil na plátně o předchozí šířce
      await page.waitForTimeout(150);
      if (name === 'mobil') await expectNoHorizontalOverflow(page, `${path} (${scheme}, ${name})`);
      await expectNoSeriousViolations(page, `${path} (${scheme}, ${name})`);
    }
  }
}

