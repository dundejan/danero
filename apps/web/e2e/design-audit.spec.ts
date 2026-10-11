import { expect, test, type Page } from '@playwright/test';
import { UNIVERSAL_TEMPLATE_CSV } from '../../../packages/importers/src/universal/csv';
import { hydrated, openDisclosure, registerWithProfile, uploadStatement } from './helpers';

/**
 * Vizuální audit (ne asserty — sběr screenshotů pro ruční/AI rozbor):
 * všechny stránky aplikace s bohatými daty (CP + krypto + deriváty),
 * desktop light/dark + mobil. Výstup: test-results/design/.
 *
 * Od redesignu z října 2026 je část obsahu vidět až po interakci (výklad za
 * „i“, detail limitu v inspektoru nebo sheetu, formuláře účtu za rozbalením,
 * nevratné akce za dialogem) — sbírají se proto i tyhle stavy, jinak by
 * rozbor viděl jen zavřené řádky.
 */
const OUT = 'test-results/design';

async function shoot(page: Page, name: string) {
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

/** Snímek okna (ne celé stránky) — překryv je ukotvený k oknu, ne k dokumentu. */
async function shootOverlay(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

test('design audit: screenshoty všech stránek', async ({ page }) => {
  test.setTimeout(300_000);
  // bez animací: stagger tečka po tečce jinak vyrobí „prázdné“ snímky
  await page.emulateMedia({ reducedMotion: 'reduce' });

  // veřejné stránky
  for (const [path, name] of [
    ['/', 'landing'],
    ['/cenik', 'cenik'],
    ['/kalkulacka', 'kalkulacka'],
    ['/demo/prehled', 'demo'],
    ['/prihlaseni', 'prihlaseni'],
    ['/registrace', 'registrace'],
  ] as const) {
    await page.goto(path);
    await shoot(page, `${name}-light`);
  }

  await registerWithProfile(page, { name: 'Design Audit', email: 'design@danero.cz' });
  // krok 2 nového uživatele: Zdroje dat s výzvou a prázdný přehled
  await shoot(page, 'import-prazdny-light');
  await page.goto('/prehled');
  await shoot(page, 'prehled-prazdny-light');

  await page.goto('/import');
  await uploadStatement(page, {
    name: 'data.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(UNIVERSAL_TEMPLATE_CSV, 'utf8'),
  });

  const APP_PAGES = [
    ['/prehled', 'prehled'],
    ['/portfolio', 'portfolio'],
    ['/portfolio/US0378331005', 'portfolio-detail'],
    ['/report', 'report'],
    ['/report?rok=2025', 'report-s-exportem'],
    ['/simulator', 'simulator'],
    ['/simulator?isin=US0378331005&kusy=1&cena=200', 'simulator-vysledek'],
    ['/import', 'import'],
    ['/nastaveni', 'nastaveni'],
    ['/nastaveni/upozorneni', 'nastaveni-upozorneni'],
    ['/nastaveni/ucet', 'nastaveni-ucet'],
  ] as const;

  // desktop light
  for (const [path, name] of APP_PAGES) {
    await page.goto(path);
    await shoot(page, `${name}-light`);
  }

  // stavy po interakci (desktop light): vysvětlivka, vybraný limit, rozbalené
  // řádky účtu a potvrzovací dialog
  await page.goto('/prehled');
  await (await hydrated(page.getByRole('button', { name: 'Vysvětlení: Daň z investic' }))).click();
  await expect(page.getByRole('dialog', { name: 'Jak se daň počítá' })).toBeVisible();
  await shootOverlay(page, 'prehled-vysvetlivka-light');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Osvobození prodejů cenných papírů/ }).click();
  await expect(
    page.getByRole('region', { name: /^Osvobození prodejů cenných papírů — / }),
  ).toBeVisible();
  await shoot(page, 'prehled-limit-light');

  await page.goto('/nastaveni/ucet');
  await openDisclosure(page, /^E-mail/);
  await openDisclosure(page, /^Heslo/);
  await openDisclosure(page, 'Dvoufaktorové ověření');
  await shoot(page, 'nastaveni-ucet-rozbalene-light');
  await (await hydrated(page.getByRole('button', { name: 'Smazat účet…' }))).click();
  await expect(page.getByRole('alertdialog', { name: 'Smazat účet?' })).toBeVisible();
  await shootOverlay(page, 'nastaveni-ucet-dialog-light');

  // desktop dark
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  for (const [path, name] of [...APP_PAGES, ['/demo/prehled', 'demo'] as const]) {
    await page.goto(path);
    await shoot(page, `${name}-dark`);
  }
  // mobil light (vybrané stránky)
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, name] of APP_PAGES) {
    await page.goto(path);
    await shoot(page, `${name}-mobil`);
  }

  // stavy po interakci (mobil): detail limitu a další sekce jsou spodní sheety
  await page.goto('/prehled');
  await (await hydrated(page.getByRole('button', { name: /^Limit paušální daně/ }))).click();
  await expect(page.getByRole('dialog', { name: /^Limit paušální daně — / })).toBeVisible();
  await shootOverlay(page, 'prehled-sheet-limitu-mobil');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: 'Více' }).click();
  await expect(page.getByRole('dialog', { name: 'Další sekce' })).toBeVisible();
  await shootOverlay(page, 'prehled-sheet-vice-mobil');
});
