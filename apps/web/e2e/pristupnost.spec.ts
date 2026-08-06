import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { UNIVERSAL_TEMPLATE_CSV } from '../../../packages/importers/src/universal/csv';
import { registerWithProfile } from './helpers';

/**
 * Přístupnost celé aplikace — pojistka, ne dekorace (H-28).
 *
 * Původní verze hlídala jen `impact === 'critical'`, jen ve světlém režimu
 * a jen na 11 z 31 stránek — nechytila by ani jeden nález auditu ze 6. 8. 2026
 * (nefokusovatelné tabulky, kontrasty pod AA). Proto:
 *
 * – práh je `serious` (tam spadá `scrollable-region-focusable` i `color-contrast`),
 * – běží se ve světlém i tmavém režimu (tokeny mají v každém jiné hodnoty),
 * – seznam pokrývá VŠECHNY stránky: aplikaci, onboarding, demo, přihlašovací
 *   tok i marketing včetně právních textů,
 * – axe běží na mobilu i na desktopu. Obojí je nutné: `scrollable-region-focusable`
 *   se ozve jedině tam, kde tabulka opravdu přetéká (tedy na úzkém displeji),
 *   zatímco tabulky s `hidden md:block` jsou na mobilu skryté a axe by je vůbec
 *   neviděl.
 *
 * Každá stránka se načte jednou a pak se na ní přepínají režim a viewport.
 */

/** Aplikace za přihlášením. */
const APP_PAGES = [
  '/prehled',
  '/portfolio',
  // detail pozice — ISIN z univerzální šablony, kterou test importuje
  '/portfolio/US0378331005',
  '/report',
  '/simulator',
  '/import',
  '/nastaveni',
  '/predplatne',
];

/** Demo prohlídka je veřejná vstupní brána — musí splňovat totéž. */
const DEMO_PAGES = [
  '/demo/prehled',
  '/demo/portfolio',
  '/demo/portfolio/IE00BK5BQT80',
  '/demo/simulator',
  '/demo/report',
];

/**
 * Přihlašovací tok. `/nove-heslo` bez tokenu i `/overeni-emailu?error=1`
 * schválně míří na chybové větve — ty uživatel vidí nejčastěji a dřív je
 * nekontroloval nikdo.
 */
const AUTH_PAGES = [
  '/prihlaseni',
  '/registrace',
  '/zapomenute-heslo',
  '/nove-heslo',
  '/overeni-emailu?error=1',
];

/** Marketing a právní texty — první, co návštěvník uvidí. */
const MARKETING_PAGES = [
  '/',
  '/cenik',
  '/caste-otazky',
  '/o-projektu',
  '/bezpecnost',
  '/jak-pocitame',
  '/platformy',
  '/pruvodce',
  '/pruvodce/limit-100-000-kc',
  '/pruvodce/pausalni-rezim-a-investice',
  '/kalkulacka',
  '/podminky',
  '/soukromi',
  '/odstoupeni',
];

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

/**
 * Nálezy, které stránku shodí. `serious` je práh, pod nímž zůstávají už jen
 * kosmetické „moderate/minor“ — a nad ním leží všechno, co reálně brání
 * v ovládání (klávesnice, kontrast, chybějící názvy).
 */
const BLOCKING_IMPACTS = new Set(['critical', 'serious']);

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

/** Jeden průchod stránkou: světlý i tmavý režim, mobil i desktop. */
async function auditPage(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
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

test('přístupnost: axe bez vážných nálezů a bez vodorovného přetečení (light i dark)', async ({
  page,
}) => {
  // 33 stránek × 2 režimy × 2 viewporty — pomalé, ale je to jediná pojistka
  // proti tomu, aby se přístupnost zase tiše rozpadla
  test.setTimeout(1_800_000);
  await registerWithProfile(page, { name: 'E2E A11y', email: 'a11y@danero.cz' });

  // onboarding se po naimportování dat přesměruje na přehled — projít ho jde
  // jedině teď, s hotovým profilem a prázdnou historií
  await auditPage(page, '/vitejte');

  await page.goto('/import');
  await page.locator('input[name="soubory"]').setInputFiles({
    name: 'sablona.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(UNIVERSAL_TEMPLATE_CSV, 'utf8'),
  });
  await page.getByRole('button', { name: 'Nahrát výpisy' }).click();
  await expect(page.getByText('sablona.csv')).toBeVisible();

  for (const path of [...APP_PAGES, ...DEMO_PAGES, ...AUTH_PAGES, ...MARKETING_PAGES]) {
    await auditPage(page, path);
  }
});
