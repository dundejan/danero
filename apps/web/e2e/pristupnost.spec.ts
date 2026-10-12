import { expect, test, type Locator, type Page } from '@playwright/test';
import { auditOverlay, auditPage, expandAllDisclosures } from './a11y';
import { UNIVERSAL_TEMPLATE_CSV } from '../../../packages/importers/src/universal/csv';
import { hydrated, registerAccount, saveFirstProfile, uploadStatement } from './helpers';

/**
 * Přístupnost celé aplikace — pojistka, ne dekorace (H-28).
 *
 * Původní verze hlídala jen `impact === 'critical'`, jen ve světlém režimu
 * a jen na 11 z 31 stránek — nechytila by ani jeden nález auditu ze 6. 8. 2026
 * (nefokusovatelné tabulky, kontrasty pod AA). Proto:
 *
 * – práh je `moderate` (tam spadá rozbitá struktura landmarků; `serious` kryje
 *   `scrollable-region-focusable` i `color-contrast`),
 * – auditují se i chybové stavy (404 uvnitř aplikace i uvnitř dema),
 * – kontroluje se struktura shellu: právě jeden `<main>` a jedno `#obsah`,
 * – běží se ve světlém i tmavém režimu (tokeny mají v každém jiné hodnoty),
 * – seznam pokrývá VŠECHNY stránky: aplikaci, onboarding, demo, přihlašovací
 *   tok i marketing včetně právních textů,
 * – axe běží na mobilu i na desktopu. Obojí je nutné: `scrollable-region-focusable`
 *   se ozve jedině tam, kde tabulka opravdu přetéká (tedy na úzkém displeji),
 *   zatímco tabulky s `hidden md:block` jsou na mobilu skryté a axe by je vůbec
 *   neviděl,
 * – měří se i to, co je vidět až po interakci: rozbalené řádky, vysvětlivka,
 *   spodní sheet a potvrzovací dialog. Redesign z října 2026 schoval výklad
 *   za „i“ a detaily za rozbalení — stránka bez nich je jen půlka toho, co
 *   uživatel čte.
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
  // skončený rok: jiná skladba stránky — formulář exportu XML a tlačítko v liště
  '/report?rok=2025',
  '/simulator',
  // simulátor s výsledkem (verdikt, limity po prodeji, rozpad prodeje)
  '/simulator?isin=US0378331005&kusy=1&cena=200',
  '/import',
  '/nastaveni',
  '/nastaveni/upozorneni',
  '/nastaveni/ucet',
];

/**
 * Chybové stavy — dřív neauditoval žádný (audit H2-05). ISIN, který uživatel
 * nemá, spustí v aplikaci `notFound()`; než pro `(app)` vznikla vlastní
 * `not-found.tsx`, vykreslil se marketingový shell UVNITŘ aplikačního layoutu
 * a stránka měla dva `<main>` a dvě `id="obsah"` (axe: `landmark-no-duplicate-main`,
 * `landmark-unique` — obojí `moderate`, tedy pod tehdejším prahem `serious`).
 */
const ERROR_PAGES = ['/portfolio/US9999999999', '/demo/portfolio/US9999999999'];

/** Demo prohlídka je veřejná vstupní brána — musí splňovat totéž. */
const DEMO_PAGES = [
  '/demo/prehled',
  '/demo/portfolio',
  '/demo/portfolio/IE00BK5BQT80',
  '/demo/simulator',
  '/demo/simulator?isin=IE00BK5BQT80&kusy=5&cena=140',
  '/demo/report',
];

/**
 * Přihlašovací tok. `/nove-heslo` bez tokenu schválně míří na chybovou větev —
 * tu uživatel vidí nejčastěji a dřív ji nekontroloval nikdo.
 */
const AUTH_PAGES = ['/prihlaseni', '/registrace', '/zapomenute-heslo', '/nove-heslo'];

/**
 * Stránky, které se dají auditovat JEN odhlášené. `/overeni-emailu` posílá
 * potvrzeného uživatele na `/vitejte`, takže ve společné smyčce (ta běží
 * přihlášená) se místo chybové větve auditoval podruhé onboarding — a nikdo
 * o tom nevěděl, dokud `auditPage` nezačala hlídat, kde skutečně skončila.
 */
const LOGGED_OUT_PAGES = [
  '/overeni-emailu?error=1',
  // čekání na potvrzení a stránka po kliknutí na odkaz — bez chyby
  '/overeni-emailu',
  '/overeni-emailu/hotovo',
  // formulář nového hesla (bez tokenu se auditovala jen chybová větev)
  '/nove-heslo?token=neplatny-token',
  // kořenová 404 mimo aplikaci i demo
  '/tahle-stranka-neexistuje',
  // potvrzení po nevratném smazání účtu
  '/?smazano=1',
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
];

/**
 * Stránky s rozbalovacími řádky a detaily — měří se podruhé, se vším
 * otevřeným (kontroly výpočtu a upozornění, řádky účtu s formuláři, historie
 * importů, napojení brokera, osobní údaje exportu, otázky a odpovědi).
 */
const EXPANDABLE_PAGES = [
  '/prehled',
  '/report',
  '/report?rok=2025',
  '/import',
  '/nastaveni/ucet',
  '/demo/prehled',
  '/demo/report',
  '/cenik',
  '/caste-otazky',
];

const EXPANDED = { label: 'rozbalené řádky', run: expandAllDisclosures };

/** Otevře prvek klepnutím na spouštěč a počká na dialog daného jména. */
const openDialog =
  (
    trigger: (page: Page) => Locator,
    role: 'dialog' | 'alertdialog',
    name: string | RegExp,
  ) =>
  async (page: Page) => {
    await (await hydrated(trigger(page))).click();
    const dialog = page.getByRole(role, { name });
    await expect(dialog).toBeVisible();
    // sheet přijíždí pružinou řízenou skriptem — měřit se má, až stojí
    await (await dialog.elementHandle())?.waitForElementState('stable');
  };

/** Spodní sheety telefonu: detail limitu, další sekce, vysvětlivka. */
const MOBILE_OVERLAYS = [
  {
    label: 'sheet limitu',
    path: '/prehled',
    open: openDialog(
      (page) => page.getByRole('button', { name: /^Osvobození prodejů cenných papírů/ }),
      'dialog',
      /^Osvobození prodejů cenných papírů — /,
    ),
  },
  {
    label: 'sheet „Více“',
    path: '/prehled',
    open: openDialog((page) => page.getByRole('button', { name: 'Více' }), 'dialog', 'Další sekce'),
  },
  {
    label: 'vysvětlivka v sheetu',
    path: '/prehled',
    open: openDialog(
      (page) => page.getByRole('button', { name: 'Vysvětlení: Daň z investic' }),
      'dialog',
      'Jak se daň počítá',
    ),
  },
  {
    label: 'potvrzovací dialog',
    path: '/nastaveni/ucet',
    open: openDialog(
      (page) => page.getByRole('button', { name: 'Smazat účet…' }),
      'alertdialog',
      'Smazat účet?',
    ),
  },
  {
    label: 'sheet limitu v demu',
    path: '/demo/prehled',
    open: openDialog(
      (page) => page.getByRole('button', { name: /^Limit paušální daně/ }),
      'dialog',
      /^Limit paušální daně — /,
    ),
  },
  {
    label: 'rozbalené menu',
    path: '/',
    open: async (page: Page) => {
      await (await hydrated(page.getByRole('button', { name: 'Otevřít menu' }))).click();
      await expect(page.getByRole('navigation', { name: 'Mobilní navigace' })).toBeVisible();
    },
  },
] as const;

/** Překryvy širokého okna: bublina vysvětlivky a potvrzovací dialog. */
const DESKTOP_OVERLAYS = [
  {
    label: 'vysvětlivka',
    path: '/prehled',
    open: openDialog(
      (page) => page.getByRole('button', { name: 'Vysvětlení: Daň z investic' }),
      'dialog',
      'Jak se daň počítá',
    ),
  },
  {
    label: 'vysvětlivka u pole',
    path: '/nastaveni',
    open: openDialog(
      (page) => page.getByRole('button', { name: 'Vysvětlení: jak se daní vratky kapitálu' }),
      'dialog',
      'Vratka kapitálu',
    ),
  },
  {
    label: 'potvrzovací dialog',
    path: '/nastaveni/ucet',
    open: openDialog(
      (page) => page.getByRole('button', { name: 'Smazat účet…' }),
      'alertdialog',
      'Smazat účet?',
    ),
  },
  {
    label: 'vysvětlivka v demu',
    path: '/demo/portfolio',
    open: openDialog(
      (page) => page.getByRole('button', { name: 'Vysvětlení: Hodnota portfolia' }),
      'dialog',
      'Z čeho hodnota vychází',
    ),
  },
] as const;

test('přístupnost: axe bez vážných nálezů a bez vodorovného přetečení (light i dark)', async ({
  page,
}) => {
  // 40 stránek × 2 režimy × 2 viewporty a stavy po interakci — pomalé, ale je
  // to jediná pojistka proti tomu, aby se přístupnost zase tiše rozpadla
  test.setTimeout(1_800_000);
  // dokud je prohlížeč odhlášený — potvrzenému uživateli tyhle stránky utečou
  for (const path of LOGGED_OUT_PAGES) {
    await auditPage(page, path);
  }

  // krok 1: účet bez profilu — průvodce a Nastavení s výzvou vybrat režim
  // (sem vede i přehled, portfolio, simulátor a report)
  await registerAccount(page, { name: 'E2E A11y', email: 'a11y@danero.cz' });
  await auditPage(page, '/vitejte');
  await auditPage(page, '/nastaveni');
  await auditPage(page, '/nastaveni', EXPANDED);

  // krok 2: profil je, data ne — průvodce, Zdroje dat s výzvou a prázdný
  // přehled se po naimportování dat už neukážou, projít je jde jedině teď
  await saveFirstProfile(page);
  await auditPage(page, '/vitejte');
  await auditPage(page, '/import');
  await auditPage(page, '/prehled');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/import');
  await uploadStatement(page, {
    name: 'sablona.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(UNIVERSAL_TEMPLATE_CSV, 'utf8'),
  });

  for (const path of [
    ...APP_PAGES,
    ...ERROR_PAGES,
    ...DEMO_PAGES,
    ...AUTH_PAGES,
    ...MARKETING_PAGES,
  ]) {
    await auditPage(page, path);
  }

  for (const path of EXPANDABLE_PAGES) {
    await auditPage(page, path, EXPANDED);
  }

  // kalkulačka s verdiktem — bez odpovědí je na stránce jen prázdný stav
  await auditPage(page, '/kalkulacka', {
    label: 'verdikt',
    run: async (calculator) => {
      const answer = (question: string | RegExp, option: string) =>
        calculator
          .getByRole('group', { name: question })
          .getByRole('button', { name: option, exact: true });
      await (await hydrated(answer(/Jsi zaměstnanec/, 'Zaměstnanec'))).click();
      await answer(/akcie nebo ETF za víc než 100 000 Kč/, 'Ne').click();
      await answer(/kryptoměny za víc než 100 000 Kč/, 'Ne').click();
      await answer(/vedle zaměstnání jiné zdanitelné příjmy/, 'Ne').click();
      await expect(
        calculator.getByText('Vypadá to, že přiznání kvůli investicím řešit nemusíš.'),
      ).toBeVisible();
    },
  });

  for (const overlay of MOBILE_OVERLAYS) {
    await auditOverlay(page, { ...overlay, viewport: 'mobil' });
  }
  for (const overlay of DESKTOP_OVERLAYS) {
    await auditOverlay(page, { ...overlay, viewport: 'desktop' });
  }
});
