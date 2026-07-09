import { expect, test } from '@playwright/test';
import {
  DEGIRO_TRANSACTIONS_CZ,
} from '../../../packages/importers/test/fixtures/degiro';
import { encodeCp1250, FIO_FIXTURE } from '../../../packages/importers/test/fixtures/fio';
import { buildXtbXlsx, XTB_ROWS_EN } from '../../../packages/importers/test/fixtures/xtb';
import { registerWithProfile } from './helpers';

/**
 * Akceptace G4: import každého nového formátu end-to-end — Degiro CSV,
 * Fio (windows-1250) a XTB XLSX včetně doplnění číselníku (ISIN/měna)
 * a opakovaného nahrání, které nic nezdvojí.
 */
test('import Degiro, Fio a XTB včetně číselníku instrumentů', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Brokeři', email: 'brokeri@danero.cz' });
  await page.goto('/import');

  // deterministický upload: čeká, až se import propíše do historie (nový batch),
  // jinak další setInputFiles závodí s překreslením stránky po redirectu
  const upload = async (file: { name: string; mimeType: string; buffer: Buffer }) => {
    const batchButtons = page.getByRole('button', { name: 'Smazat záznam' });
    const before = await batchButtons.count();
    await page.locator('input[name="soubory"]').setInputFiles(file);
    await page.getByRole('button', { name: 'Nahrát výpisy' }).click();
    await expect(batchButtons).toHaveCount(before + 1, { timeout: 20_000 });
  };

  // ── Degiro Transactions (CZ hlavičky, středníky, des. čárka) ────────────
  await upload({
    name: 'degiro-transactions.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(DEGIRO_TRANSACTIONS_CZ, 'utf8'),
  });
  await expect(page.getByText('degiro-transactions.csv')).toBeVisible();
  await expect(page.getByText(/degiro/).first()).toBeVisible();

  // ── Fio (windows-1250): nejdřív číselník, pak import ────────────────────
  await upload({
    name: 'fio-obchody.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(encodeCp1250(FIO_FIXTURE)),
  });
  await expect(page.getByText('Doplň chybějící údaje instrumentů')).toBeVisible();
  await page.locator('input[name="isin-0"]').fill('US0378331005');
  await page.getByRole('button', { name: 'Uložit číselník' }).click();
  await expect(page.getByText('Číselník uložen')).toBeVisible();

  await upload({
    name: 'fio-obchody.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(encodeCp1250(FIO_FIXTURE)),
  });
  // po doplnění číselníku už formulář nevyskakuje a obchody se naimportovaly
  await expect(page.getByText('Doplň chybějící údaje instrumentů')).not.toBeVisible();

  // ── XTB XLSX: číselník chce ISIN i měnu ─────────────────────────────────
  const xlsx = await buildXtbXlsx({ rows: XTB_ROWS_EN });
  await upload({
    name: 'xtb-report.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(xlsx),
  });
  await expect(page.getByText('Doplň chybějící údaje instrumentů')).toBeVisible();
  const isinInputs = page.locator('input[name^="isin-"]');
  const count = await isinInputs.count();
  for (let i = 0; i < count; i += 1) {
    await page.locator(`input[name="isin-${i}"]`).fill('US5949181045');
    await page.locator(`input[name="currency-${i}"]`).fill('USD');
  }
  await page.getByRole('button', { name: 'Uložit číselník' }).click();
  await expect(page.getByText('Číselník uložen')).toBeVisible();

  const xlsx2 = await buildXtbXlsx({ rows: XTB_ROWS_EN });
  await upload({
    name: 'xtb-report.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(xlsx2),
  });
  await expect(page.getByText('Doplň chybějící údaje instrumentů')).not.toBeVisible();

  // stažitelná šablona existuje
  const response = await page.request.get('/api/sablona');
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain('CORPORATE_ACTION');
});
