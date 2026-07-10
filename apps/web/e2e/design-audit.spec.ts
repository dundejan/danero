import { expect, test } from '@playwright/test';
import { UNIVERSAL_TEMPLATE_CSV } from '../../../packages/importers/src/universal/csv';
import { registerWithProfile } from './helpers';

/**
 * Vizuální audit (ne asserty — sběr screenshotů pro ruční/AI rozbor):
 * všechny stránky aplikace s bohatými daty (CP + krypto + deriváty),
 * desktop light/dark + mobil. Výstup: test-results/design/.
 */
const OUT = 'test-results/design';

async function shoot(page: import('@playwright/test').Page, name: string) {
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

test('design audit: screenshoty všech stránek', async ({ page }) => {
  test.setTimeout(300_000);
  // bez animací: stagger tečka po tečce jinak vyrobí „prázdné" snímky
  await page.emulateMedia({ reducedMotion: 'reduce' });

  // veřejné stránky
  for (const [path, name] of [
    ['/', 'landing'],
    ['/demo/prehled', 'demo'],
    ['/prihlaseni', 'prihlaseni'],
    ['/registrace', 'registrace'],
  ] as const) {
    await page.goto(path);
    await shoot(page, `${name}-light`);
  }

  await registerWithProfile(page, { name: 'Design Audit', email: 'design@danero.cz' });
  await page.goto('/import');
  await page.locator('input[name="soubory"]').setInputFiles({
    name: 'data.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(UNIVERSAL_TEMPLATE_CSV, 'utf8'),
  });
  await page.getByRole('button', { name: 'Nahrát výpisy' }).click();
  await expect(page.getByText('data.csv')).toBeVisible();

  const APP_PAGES = [
    ['/prehled', 'prehled'],
    ['/portfolio', 'portfolio'],
    ['/portfolio/US0378331005', 'portfolio-detail'],
    ['/report', 'report'],
    ['/simulator', 'simulator'],
    ['/import', 'import'],
    ['/nastaveni', 'nastaveni'],
  ] as const;

  // desktop light
  for (const [path, name] of APP_PAGES) {
    await page.goto(path);
    await shoot(page, `${name}-light`);
  }
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
});
