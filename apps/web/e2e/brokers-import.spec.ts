import { expect, test } from '@playwright/test';
import {
  DEGIRO_TRANSACTIONS_CZ,
} from '../../../packages/importers/test/fixtures/degiro';
import { COINMATE_CZ } from '../../../packages/importers/test/fixtures/coinmate';
import { encodeCp1250, FIO_FIXTURE } from '../../../packages/importers/test/fixtures/fio';
import { KRAKEN_LEDGERS_NEW } from '../../../packages/importers/test/fixtures/kraken';
import { MT4_HTML } from '../../../packages/importers/test/fixtures/metatrader';
import { PORTU_REAL_LAYOUT_FIXTURE } from '../../../packages/importers/test/fixtures/portu';
import { REVOLUT_INVEST_CSV } from '../../../packages/importers/test/fixtures/revolut';
import { SWISSQUOTE_EN } from '../../../packages/importers/test/fixtures/swissquote';
import {
  buildXtbNewReportXlsx,
  buildXtbXlsx,
  XTB_NEW_FILENAME,
  XTB_ROWS_EN,
} from '../../../packages/importers/test/fixtures/xtb';
import { T212_FIXTURE_2026 } from '../../../packages/importers/test/fixtures/t212';
import { openDisclosure, registerWithProfile, uploadStatement } from './helpers';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Platformu importu nese řádek historie jménem z katalogu („Degiro · 2 nové ·
 * 0 duplicit“). Hledá se jméno následované oddělovačem — samotné „degiro“ by
 * našel i název souboru a test by prošel, ať se pozná kterýkoli broker.
 */
const recognizedAs = (platform: string): RegExp =>
  new RegExp(`${platform.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · \\d+ nov`);

/**
 * Akceptace G4: import každého nového formátu end-to-end — Degiro CSV,
 * Fio (windows-1250) a XTB XLSX včetně doplnění číselníku (ISIN/měna)
 * a opakovaného nahrání, které nic nezdvojí.
 */
test('import Degiro, Fio a XTB včetně číselníku instrumentů', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Brokeři', email: 'brokeri@danero.cz' });
  await page.goto('/import');

  // ── Degiro Transactions (CZ hlavičky, středníky, des. čárka) ────────────
  const degiro = await uploadStatement(page, {
    name: 'degiro-transactions.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(DEGIRO_TRANSACTIONS_CZ, 'utf8'),
  });
  await expect(degiro).toContainText(recognizedAs('Degiro'));

  // ── Fio (windows-1250): nejdřív číselník, pak import ────────────────────
  const fio = await uploadStatement(page, {
    name: 'fio-obchody.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(encodeCp1250(FIO_FIXTURE)),
  });
  await expect(fio).toContainText(recognizedAs('Fio e-Broker'));
  const aliases = page.getByRole('heading', { name: 'Doplň chybějící údaje instrumentů' });
  await expect(aliases).toBeVisible();
  await page.locator('input[name="isin-0"]').fill('US0378331005');
  await page.getByRole('button', { name: 'Uložit číselník' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Číselník uložen' })).toBeVisible();

  await uploadStatement(page, {
    name: 'fio-obchody.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(encodeCp1250(FIO_FIXTURE)),
  });
  // po doplnění číselníku už formulář nevyskakuje a obchody se naimportovaly
  await expect(aliases).toBeHidden();

  // ── XTB XLSX: číselník chce ISIN i měnu ─────────────────────────────────
  const xtb = await uploadStatement(page, {
    name: 'xtb-report.xlsx',
    mimeType: XLSX,
    buffer: Buffer.from(await buildXtbXlsx({ rows: XTB_ROWS_EN })),
  });
  await expect(xtb).toContainText(recognizedAs('XTB'));
  await expect(aliases).toBeVisible();
  const isinInputs = page.locator('input[name^="isin-"]');
  const count = await isinInputs.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    await page.locator(`input[name="isin-${i}"]`).fill('US5949181045');
    await page.locator(`input[name="currency-${i}"]`).fill('USD');
  }
  await page.getByRole('button', { name: 'Uložit číselník' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Číselník uložen' })).toBeVisible();

  await uploadStatement(page, {
    name: 'xtb-report.xlsx',
    mimeType: XLSX,
    buffer: Buffer.from(await buildXtbXlsx({ rows: XTB_ROWS_EN })),
  });
  await expect(aliases).toBeHidden();

  // ── XTB, report z tlačítka „Export (new)“: jiné listy, sloupce i typy ───
  // 7. 10. 2026 ho autodetekce nepoznala a první cizí uživatel četl „XLSX
  // nepoznáváme — podporujeme reporty XTB…“. AAPL.US už v číselníku je, takže
  // se má načíst celý: 8 řádků, srážková daň splyne s dividendou.
  const newReport = await uploadStatement(page, {
    name: XTB_NEW_FILENAME,
    mimeType: XLSX,
    buffer: await buildXtbNewReportXlsx(),
  });
  await expect(newReport).toContainText('XTB · 7 nových · 0 duplicit');
  // chyby se píšou jen tehdy, když nějaké jsou — nula chyb není zpráva
  await expect(newReport).not.toContainText(/chyb/);
  await expect(aliases).toBeHidden();

  // stažitelná šablona existuje — ve tvaru pro český Excel (BOM + středník),
  // jinak se po dvojkliku nasype do jednoho sloupce s rozbitou diakritikou
  const response = await page.request.get('/api/sablona');
  expect(response.ok()).toBe(true);
  const template = await response.body();
  expect([...template.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(template.toString('utf8')).toContain('CORPORATE_ACTION;2024-08-31;');

  // a pravidla pro vyplnění stojí tam, kde se šablona stahuje — za rozbalením
  // pod formulářem pro nahrání
  const rules = await openDisclosure(page, 'Jak vyplnit univerzální šablonu');
  await expect(rules).toHaveAttribute('id', 'sablona');
  await expect(rules.getByRole('link', { name: 'Stáhnout šablonu' })).toHaveAttribute(
    'href',
    '/api/sablona',
  );
  await expect(rules.getByText('5.3.2026')).toBeVisible();
  await expect(rules.getByText('TRANSFER_OUT')).toBeVisible();
});

/**
 * Autodetekce nové vlny brokerů end-to-end: každý formát projde uploadem,
 * pozná se správný broker a transakce se propíší do historie importů.
 */
test('autodetekce nových formátů: Revolut, Coinmate, Kraken, MT4, Swissquote, Portu', async ({
  page,
}) => {
  await registerWithProfile(page, { name: 'E2E Brokeři 2', email: 'brokeri2@danero.cz' });
  await page.goto('/import');

  // Revolut invest (ISIN se doplňuje číselníkem — objeví se formulář)
  const revolut = await uploadStatement(page, {
    name: 'revolut-invest.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(REVOLUT_INVEST_CSV, 'utf8'),
  });
  await expect(revolut).toContainText(recognizedAs('Revolut'));
  await expect(
    page.getByRole('heading', { name: 'Doplň chybějící údaje instrumentů' }),
  ).toBeVisible();

  // Coinmate (CZ hlavičky, středník) — krypto s ISIN=symbol, číselník netřeba
  const coinmate = await uploadStatement(page, {
    name: 'coinmate-vypis.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(COINMATE_CZ, 'utf8'),
  });
  await expect(coinmate).toContainText(recognizedAs('Coinmate'));

  // Kraken ledgers (páry přes refid)
  const kraken = await uploadStatement(page, {
    name: 'ledgers.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(KRAKEN_LEDGERS_NEW, 'utf8'),
  });
  await expect(kraken).toContainText(recognizedAs('Kraken'));

  // MT4 HTML statement (deriváty dle R-12r)
  const mt4 = await uploadStatement(page, {
    name: 'statement.htm',
    mimeType: 'text/html',
    buffer: Buffer.from(MT4_HTML, 'utf8'),
  });
  await expect(mt4).toContainText(recognizedAs('MetaTrader 4'));

  // Swissquote (středníkové CSV, EN 13 sloupců)
  const swissquote = await uploadStatement(page, {
    name: 'transactions-from-01012022-to-31122022.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(SWISSQUOTE_EN, 'utf8'),
  });
  await expect(swissquote).toContainText(recognizedAs('Swissquote'));

  // Portu ve skutečném tvaru sloupce Typ („Nákup – … – … kusů“). 15. 10. 2026
  // skončil první skutečný export chybou na každém řádku; načte se úrok
  // a nákup, zbytek (výběr, přesuny, zajištění…) se přeskočí bez chyby.
  const portu = await uploadStatement(page, {
    name: 'Transakcni_historie.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(PORTU_REAL_LAYOUT_FIXTURE, 'utf8'),
  });
  await expect(portu).toContainText('Portu · 2 nové · 0 duplicit');
  await expect(portu).not.toContainText(/chyb/);
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

  const imported = await uploadStatement(page, {
    name: 't212-2026.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(T212_FIXTURE_2026, 'utf8'),
  });
  await expect(imported).toContainText(recognizedAs('Trading 212'));
  // hláška cizího parseru nesmí být nikde na stránce, ani v zavřeném řádku
  await expect(page.getByText(/Chybí povinný sloupec/)).toHaveCount(0);
  await expect(imported).not.toContainText(/chyb/);
});
