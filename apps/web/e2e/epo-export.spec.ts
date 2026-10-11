import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { UNIVERSAL_TEMPLATE_CSV } from '../../../packages/importers/src/universal/csv';
import { hydrated, registerWithProfile, uploadStatement } from './helpers';

/**
 * Export XML pro podání přes mojedane.cz, skutečným účtem a skutečným
 * stažením. Od redesignu stojí hlavní tlačítko v liště reportu, mimo formulář
 * — odesílá ho přes atribut `form` — a osobní údaje i pole dodatečného
 * přiznání jsou za rozbalením. Kdyby vazba tlačítka na formulář vypadla,
 * tlačítko by mlčky neudělalo nic; kdyby se neplatné pole ve sbalené sekci
 * neohlásilo, vypadalo by to stejně.
 *
 * Data: univerzální šablona. Rok 2025 je skončený a jeho strukturu XML
 * finanční správa zveřejnila, běžný rok ji ještě nemá.
 */
test('report: XML pro EPO se stáhne tlačítkem z lišty, neplatné pole se ohlásí', async ({
  page,
}) => {
  await registerWithProfile(page, { name: 'E2E Export', email: 'epo-export@danero.cz' });
  await page.goto('/import');
  await uploadStatement(page, {
    name: 'sablona.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(UNIVERSAL_TEMPLATE_CSV, 'utf8'),
  });

  // běžný rok: struktura XML ještě neexistuje — poctivá hláška, žádné tlačítko
  await page.goto('/report');
  await expect(
    page.getByText(/Pro rok \d{4} oficiální struktura XML přiznání zatím neexistuje/),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Stáhnout XML/ })).toHaveCount(0);

  // skončený rok: formulář exportu a tlačítko v liště
  await page
    .getByRole('navigation', { name: 'Zdaňovací období' })
    .getByRole('link', { name: '2025' })
    .click();
  await page.waitForURL('**/report?rok=2025');
  await expect(page.getByRole('heading', { name: /^Report 2025$/ })).toBeVisible();
  const toolbarDownload = page.getByRole('button', { name: 'Stáhnout XML', exact: true });
  await expect(toolbarDownload).toBeVisible();

  // ── chybový stav: dodatečné přiznání bez dne zjištění důvodů ─────────────
  // pole je ve sbalené sekci — formulář ji otevře, pole zaměří a řekne česky,
  // co chybí (bublina prohlížeče by se u sbalené sekce neukázala vůbec)
  const filingType = await hydrated(page.getByLabel('Typ přiznání'));
  const discoveryDate = page.getByLabel('Den zjištění důvodů');
  await expect(discoveryDate).toBeHidden();
  await filingType.selectOption('D');
  await toolbarDownload.click();
  await expect(
    page.getByText('U dodatečného přiznání vyplň den, kdy jsi zjistil důvody'),
  ).toBeVisible();
  await expect(discoveryDate).toBeVisible();
  await expect(discoveryDate).toBeFocused();
  await expect(discoveryDate).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/report\?rok=2025$/);

  // ── řádné přiznání: soubor se stáhne a je to podání za zvolený rok ───────
  await filingType.selectOption('B');
  const [download] = await Promise.all([page.waitForEvent('download'), toolbarDownload.click()]);
  expect(download.suggestedFilename()).toBe('danero-dpfdp7-2025.xml');
  const xml = await readFile(await download.path(), 'utf8');
  expect(xml).toMatch(/^<\?xml /);
  expect(xml).toContain('<Pisemnost');
  expect(xml).toMatch(/rok="2025"/);

  // XML je podklad pro podání, takže se nastavení roku zafixuje — a Nastavení
  // to ukáže, i s cestou, jak fixaci zrušit
  await page.goto('/nastaveni');
  const pinned = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Zafixované roky' }) });
  await expect(pinned.locator('summary').filter({ hasText: '2025' })).toBeVisible();
});
