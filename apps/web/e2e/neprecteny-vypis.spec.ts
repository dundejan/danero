import { expect, test } from '@playwright/test';
import { T212_FIXTURE_2026 } from '../../../packages/importers/test/fixtures/t212';
import { E2E_OPERATOR } from './operator';
import { registerWithProfile, waitForEmail } from './helpers';

/**
 * Nepřečtený výpis: uživatel vidí, že si ho necháváme a co s ním bude,
 * provozovateli o tom přijde upozornění a hlášení „ze které je platformy“
 * se propíše do druhého e-mailu.
 *
 * Druhá půlka scénáře je vrácení importu — do 13. 8. 2026 se mazal jen záznam
 * v historii, takže tlačítko slibovalo něco jiného, než dělalo.
 */

/** Vymyšlená platforma: žádný sniffer ji nepozná (pozor na česká slova — „Datum obchodu“ patří Fiu). */
const NEZNAMY_VYPIS = [
  'Obchodni den;Titul;Operace;Mnozstvi;Kurz;Mena',
  '2026-01-05;CEZ;Nakup;10;1050,50;CZK',
].join('\n');

const csv = (name: string, content: string) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(content, 'utf8'),
});

test('nepřečtený výpis: panel, hlášení uživatele a upozornění provozovateli', async ({ page }) => {
  const email = 'neprecteny@danero.cz';
  await registerWithProfile(page, { name: 'E2E Nepřečtený', email });
  await page.goto('/import');

  await page.locator('input[name="soubory"]').setInputFiles(csv('vypis-neznamy.csv', NEZNAMY_VYPIS));
  await page.getByRole('button', { name: 'Nahrát výpisy' }).click();

  // uživatel se dozví, co se stalo a co bude dál — ne jen že to nešlo
  await expect(page.getByText('Na zpracování tohohle výpisu pracujeme.')).toBeVisible();
  await expect(page.getByText(/Dáme ti e-mailem vědět/)).toBeVisible();

  // vrácení importu se u nepřečteného výpisu nenabízí (není co vracet)
  await expect(page.getByRole('button', { name: 'Vrátit import zpět' })).toHaveCount(0);

  // provozovateli přišlo upozornění hned, bez čekání na uživatele
  const alert = await waitForEmail(page, E2E_OPERATOR.email, (m) => m.text.includes('vypis-neznamy.csv'));
  expect(alert.text).toContain('Obchodni den'); // hlavička ano
  expect(alert.text).not.toContain('1050,50'); // obsah výpisu NIKDY

  // uživatel doplní, odkud výpis je
  await page.getByLabel('Ze které platformy výpis je?').selectOption('Portu');
  await page.getByLabel('Poznámka (nepovinné)').fill('Stáhnuto přes Transakce → Export.');
  await page.getByRole('button', { name: 'Odeslat' }).click();

  await expect(page.getByText(/Díky — máme to/)).toBeVisible();
  await expect(page.getByText(/platforma: Portu/)).toBeVisible();

  const hlaseni = await waitForEmail(page, E2E_OPERATOR.email, (m) => m.text.includes('Portu'));
  expect(hlaseni.text).toContain('Stáhnuto přes Transakce');
});

test('vrácení importu smaže i transakce a soubor jde nahrát znovu', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Vrácení', email: 'vraceni@danero.cz' });
  await page.goto('/import');

  const historie = page.locator('section').filter({ hasText: 'Historie importů' });
  await page.locator('input[name="soubory"]').setInputFiles(csv('t212-2026.csv', T212_FIXTURE_2026));
  await page.getByRole('button', { name: 'Nahrát výpisy' }).click();
  await expect(historie.getByText('t212-2026.csv')).toHaveCount(1, { timeout: 20_000 });

  // počty ber z exportu dat, ne z tabulky pozic: prodané pozice se v portfoliu
  // nezobrazují a test by pak měřil něco jiného, než o co jde
  const pocetTransakci = async (): Promise<number> => {
    const response = await page.request.get('/api/export');
    const data = (await response.json()) as { transactions: unknown[] };
    return data.transactions.length;
  };
  expect(await pocetTransakci()).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Vrátit import zpět' }).first().click();
  await expect(historie.getByText('t212-2026.csv')).toHaveCount(0, { timeout: 20_000 });

  // transakce jsou opravdu pryč, ne jen záznam v historii
  expect(await pocetTransakci()).toBe(0);

  // a tentýž soubor jde nahrát znovu — dedupe už nebrání
  await page.goto('/import');
  await page.locator('input[name="soubory"]').setInputFiles(csv('t212-2026.csv', T212_FIXTURE_2026));
  await page.getByRole('button', { name: 'Nahrát výpisy' }).click();
  await expect(historie.getByText('t212-2026.csv')).toHaveCount(1, { timeout: 20_000 });
  await expect(historie.getByText(/0 duplicit/)).toBeVisible();
});
