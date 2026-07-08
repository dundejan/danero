import { expect, test } from '@playwright/test';
import { IBKR_FLEX_XML } from '../test/ibkr-data.mjs';
import { registerWithProfile } from './helpers';

/**
 * Akceptace G2: import IBKR end-to-end — připojení Flex tokenu, sync jako
 * background job, rekonciliace proti OpenPositions, a ruční nahrání téhož XML
 * nic nezdvojí (dedupe). Flex Web Service je lokální mock (playwright.config.ts).
 */
test('IBKR: připojení Flex → sync jako job → rekonciliace → ruční XML nic nezdvojí', async ({
  page,
}) => {
  await registerWithProfile(page, { name: 'E2E IBKR', email: 'ibkr@danero.cz' });

  // ── připojení IBKR (mock přijme cokoli) ─────────────────────────────────
  await page.goto('/nastaveni');
  await page.getByLabel('Token Flex Web Service').fill('e2e-flex-token-1234');
  await page.getByLabel('Query ID').fill('654321');
  await page.locator('#ibkr').getByRole('button', { name: 'Připojit' }).click();
  await page.waitForURL('**/import');

  // ── sync jako background job ────────────────────────────────────────────
  await expect(
    page.getByRole('heading', { name: 'Interactive Brokers — automatická synchronizace' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Synchronizovat', exact: true }).click();

  // dokončení: rekonciliace proti OpenPositions sedí, batch je v historii
  await expect(page.getByText(/Pozice sedí s Interactive Brokers/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(/ibkr-flex-.*\.xml/)).toBeVisible();
  await expect(page.getByText('3 nových · 0 duplicit')).toBeVisible();

  // ── ruční nahrání téhož XML: vše duplicitní ─────────────────────────────
  await page.locator('input[name="soubory"]').setInputFiles({
    name: 'ibkr-rucni.xml',
    mimeType: 'text/xml',
    buffer: Buffer.from(IBKR_FLEX_XML, 'utf8'),
  });
  await page.getByRole('button', { name: 'Nahrát výpisy' }).click();
  await expect(page.getByText('ibkr-rucni.xml')).toBeVisible();
  await expect(page.getByText('0 nových · 3 duplicit')).toBeVisible();

  // dashboard po syncu ukazuje data (dividenda + prodej 2026)
  await page.goto('/prehled');
  await expect(page.getByRole('heading', { name: /Přehled \d{4}/ })).toBeVisible();
});
