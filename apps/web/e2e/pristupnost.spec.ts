import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { UNIVERSAL_TEMPLATE_CSV } from '../../../packages/importers/src/universal/csv';
import { registerWithProfile } from './helpers';

/**
 * Akceptace G9: všechny stránky projdou na mobilním viewportu bez
 * horizontálního přetečení (light i dark) a axe-core nenajde kritické
 * a11y nálezy. Jedna registrace + import šablony → průchod všemi stránkami.
 */
const PAGES = ['/prehled', '/portfolio', '/report', '/simulator', '/import', '/nastaveni'];

async function expectNoHorizontalOverflow(page: Page, path: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${path} přetéká vodorovně o ${overflow}px`).toBeLessThanOrEqual(1);
}

test('mobil + dark: žádné vodorovné přetečení; axe bez kritických nálezů', async ({ page }) => {
  test.setTimeout(300_000);
  await registerWithProfile(page, { name: 'E2E A11y', email: 'a11y@danero.cz' });
  await page.goto('/import');
  await page.locator('input[name="soubory"]').setInputFiles({
    name: 'sablona.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(UNIVERSAL_TEMPLATE_CSV, 'utf8'),
  });
  await page.getByRole('button', { name: 'Nahrát výpisy' }).click();
  await expect(page.getByText('sablona.csv')).toBeVisible();

  // ── mobilní viewport, light i dark ───────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of [...PAGES, '/demo']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalOverflow(page, `${path} (${scheme})`);
    }
  }

  // ── axe-core na desktopu: kritické nálezy = 0 ────────────────────────────
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  for (const path of [...PAGES, '/demo']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).analyze();
    const critical = results.violations.filter((v) => v.impact === 'critical');
    expect(
      critical,
      `${path}: ${critical.map((v) => `${v.id} (${v.nodes.length}×): ${v.help}`).join('; ')}`,
    ).toEqual([]);
  }
});
