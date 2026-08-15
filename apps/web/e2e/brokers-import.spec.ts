import { expect, test, type Page } from '@playwright/test';
import {
  DEGIRO_TRANSACTIONS_CZ,
} from '../../../packages/importers/test/fixtures/degiro';
import { COINMATE_CZ } from '../../../packages/importers/test/fixtures/coinmate';
import { encodeCp1250, FIO_FIXTURE } from '../../../packages/importers/test/fixtures/fio';
import { KRAKEN_LEDGERS_NEW } from '../../../packages/importers/test/fixtures/kraken';
import { MT4_HTML } from '../../../packages/importers/test/fixtures/metatrader';
import { REVOLUT_INVEST_CSV } from '../../../packages/importers/test/fixtures/revolut';
import { SWISSQUOTE_EN } from '../../../packages/importers/test/fixtures/swissquote';
import { buildXtbXlsx, XTB_ROWS_EN } from '../../../packages/importers/test/fixtures/xtb';
import { T212_FIXTURE_2026 } from '../../../packages/importers/test/fixtures/t212';
import { registerWithProfile } from './helpers';

/** Sekce „Historie importů“ — jediné místo, kde je název souboru záznamem. */
const historie = (page: Page) => page.locator('section').filter({ hasText: 'Historie importů' });

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
    // Čeká se na nový záznam V HISTORII (ne na tlačítko dávky: to má jen import,
    // který něco přidal). Scope na sekci je nutný — jméno souboru krátce svítí
    // i u samotného pole pro výběr, než ho server action zresetuje.
    const zaznamy = historie(page).getByText(file.name, { exact: true });
    const before = await zaznamy.count();
    await page.locator('input[name="soubory"]').setInputFiles(file);
    await page.getByRole('button', { name: 'Nahrát výpisy' }).click();
    await expect(zaznamy).toHaveCount(before + 1, { timeout: 20_000 });
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

/**
 * Autodetekce nové vlny brokerů end-to-end: každý formát projde uploadem,
 * pozná se správný broker a transakce se propíší do historie importů.
 */
test('autodetekce nových formátů: Revolut, Coinmate, Kraken, MT4, Swissquote', async ({
  page,
}) => {
  await registerWithProfile(page, { name: 'E2E Brokeři 2', email: 'brokeri2@danero.cz' });
  await page.goto('/import');

  const upload = async (file: { name: string; mimeType: string; buffer: Buffer }) => {
    // Čeká se na nový záznam V HISTORII (ne na tlačítko dávky: to má jen import,
    // který něco přidal). Scope na sekci je nutný — jméno souboru krátce svítí
    // i u samotného pole pro výběr, než ho server action zresetuje.
    const zaznamy = historie(page).getByText(file.name, { exact: true });
    const before = await zaznamy.count();
    await page.locator('input[name="soubory"]').setInputFiles(file);
    await page.getByRole('button', { name: 'Nahrát výpisy' }).click();
    await expect(zaznamy).toHaveCount(before + 1, { timeout: 20_000 });
  };

  // Revolut invest (ISIN se doplňuje číselníkem — objeví se formulář)
  await upload({
    name: 'revolut-invest.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(REVOLUT_INVEST_CSV, 'utf8'),
  });
  await expect(page.getByText('revolut-invest.csv')).toBeVisible();
  await expect(page.getByText('Doplň chybějící údaje instrumentů')).toBeVisible();

  // Coinmate (CZ hlavičky, středník) — krypto s ISIN=symbol, číselník netřeba
  await upload({
    name: 'coinmate-vypis.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(COINMATE_CZ, 'utf8'),
  });
  await expect(page.getByText('coinmate-vypis.csv')).toBeVisible();
  await expect(page.getByText(/coinmate/).first()).toBeVisible();

  // Kraken ledgers (páry přes refid)
  await upload({
    name: 'ledgers.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(KRAKEN_LEDGERS_NEW, 'utf8'),
  });
  await expect(page.getByText(/kraken/).first()).toBeVisible();

  // MT4 HTML statement (deriváty dle R-12r)
  await upload({
    name: 'statement.htm',
    mimeType: 'text/html',
    buffer: Buffer.from(MT4_HTML, 'utf8'),
  });
  await expect(page.getByText(/mt4/).first()).toBeVisible();

  // Swissquote (středníkové CSV, EN 13 sloupců)
  await upload({
    name: 'transactions-from-01012022-to-31122022.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(SWISSQUOTE_EN, 'utf8'),
  });
  await expect(page.getByText(/swissquote/).first()).toBeVisible();
});

/**
 * Regrese ze srpna 2026 hlášená z produkce: T212 přejmenoval sloupec „Time“
 * na „Time (UTC)“, autodetekce si o něj říkala přesným názvem, a tak celý
 * export propadl až na univerzální šablonu — uživatel dostal nesmyslné
 * „Chybí povinný sloupec type“. Jednotkové testy to nechytily, protože
 * fixtury měly starý název; proto se to hlídá i tudy, skutečným uploadem.
 */
test('T212 export s přejmenovaným sloupcem „Time (UTC)“ se naimportuje', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E T212 2026', email: 't212-2026@danero.cz' });
  await page.goto('/import');

  await page.locator('input[name="soubory"]').setInputFiles({
    name: 't212-2026.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(T212_FIXTURE_2026, 'utf8'),
  });
  await page.getByRole('button', { name: 'Nahrát výpisy' }).click();

  await expect(page.getByText('t212-2026.csv')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Chybí povinný sloupec/)).toHaveCount(0);
  await expect(page.getByText(/trading212/).first()).toBeVisible();
});
