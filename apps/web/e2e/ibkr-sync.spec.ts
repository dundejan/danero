import { expect, test } from '@playwright/test';
import { IBKR_FLEX_XML } from '../test/ibkr-data.mjs';
import {
  importHistory,
  importHistoryRow,
  openDisclosure,
  registerWithProfile,
  uploadStatement,
} from './helpers';

/**
 * Akceptace G2: import IBKR end-to-end — připojení Flex tokenu, sync jako
 * background job, rekonciliace proti OpenPositions, a ruční nahrání téhož XML
 * nic nezdvojí (dedupe). Flex Web Service je lokální mock (playwright.config.ts).
 */
test('IBKR: připojení Flex → sync jako job → rekonciliace → ruční XML nic nezdvojí', async ({
  page,
}) => {
  await registerWithProfile(page, { name: 'E2E IBKR', email: 'ibkr@danero.cz' });

  // ── připojení IBKR na stránce Zdroje dat (mock přijme cokoli) ───────────
  await page.goto('/import');
  // formulář na token je za řádkem brokera — zavřený řádek je jen jméno
  const brokers = page.getByRole('list', { name: 'Brokeři s automatickou synchronizací' });
  const connect = await openDisclosure(brokers, 'Interactive Brokers');
  await connect.getByLabel('Token Flex Web Service').fill('e2e-flex-token-1234');
  await connect.getByLabel('Query ID').fill('654321');
  await connect.getByRole('button', { name: 'Připojit' }).click();

  // ── sync jako background job ────────────────────────────────────────────
  const account = page.locator('#ibkr');
  await expect(account.getByText('Připojeno.')).toBeVisible();
  await account.getByRole('button', { name: 'Synchronizovat', exact: true }).click();

  // dokončení: rekonciliace proti OpenPositions sedí, batch je v historii
  await expect(account.getByText(/Pozice sedí s Interactive Brokers/)).toBeVisible({
    timeout: 60_000,
  });
  const synced = importHistory(page)
    .getByRole('listitem')
    .filter({ hasText: /ibkr-flex-.*\.xml/ });
  await expect(synced).toContainText('3 nové · 0 duplicit');

  // ── ruční nahrání téhož XML: vše duplicitní ─────────────────────────────
  await uploadStatement(page, {
    name: 'ibkr-rucni.xml',
    mimeType: 'text/xml',
    buffer: Buffer.from(IBKR_FLEX_XML, 'utf8'),
  });
  await expect(importHistoryRow(page, 'ibkr-rucni.xml')).toContainText('0 nových · 3 duplicity');

  // dashboard po syncu ukazuje data (dividenda + prodej 2026)
  await page.goto('/prehled');
  await expect(page.getByRole('heading', { name: /Přehled \d{4}/ })).toBeVisible();
});
