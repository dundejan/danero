import { expect, test } from '@playwright/test';
import { auditPage } from './a11y';
import { UNIVERSAL_TEMPLATE_CSV } from '../../../packages/importers/src/universal/csv';
import { registerWithProfile } from './helpers';

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
  '/nastaveni/upozorneni',
  '/nastaveni/ucet',
  '/predplatne',
  // objednávkové stránky (`/predplatne/hlidani`, `/predplatne/podklady`) tady
  // být nemůžou: bez `DANERO_BILLING=stripe` se neprodává nic a obě
  // přesměrují zpátky. Auditují se v `e2e-paywall/pristupnost-objednavky`.
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
const LOGGED_OUT_PAGES = ['/overeni-emailu?error=1'];

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

test('přístupnost: axe bez vážných nálezů a bez vodorovného přetečení (light i dark)', async ({
  page,
}) => {
  // 35 stránek × 2 režimy × 2 viewporty — pomalé, ale je to jediná pojistka
  // proti tomu, aby se přístupnost zase tiše rozpadla
  test.setTimeout(1_800_000);
  // dokud je prohlížeč odhlášený — potvrzenému uživateli tyhle stránky utečou
  for (const path of LOGGED_OUT_PAGES) {
    await auditPage(page, path);
  }

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

  for (const path of [
    ...APP_PAGES,
    ...ERROR_PAGES,
    ...DEMO_PAGES,
    ...AUTH_PAGES,
    ...MARKETING_PAGES,
  ]) {
    await auditPage(page, path);
  }
});
