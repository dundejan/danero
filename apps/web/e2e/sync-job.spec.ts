import { expect, test } from '@playwright/test';
import { importHistory, openDisclosure, registerWithProfile } from './helpers';

/**
 * Akceptace G1: první plný sync běží jako background job s viditelným průběhem.
 * T212 API je lokální mock (playwright.config.ts) — plná historie: 2026 data,
 * 2025 prázdný, 2024 data, 2023+2022 prázdné → konec. Po dokončení se stránka
 * sama překreslí a ukáže výsledek rekonciliace.
 */
test('T212 sync jako job: připojení klíče → průběh po letech → výsledek', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Sync', email: 'sync@danero.cz' });

  // ── připojení T212 klíče na stránce Zdroje dat (mock přijme cokoli) ─────
  await page.goto('/import');
  // formulář na klíč je za řádkem brokera — zavřený řádek je jen jméno
  const brokers = page.getByRole('list', { name: 'Brokeři s automatickou synchronizací' });
  const connect = await openDisclosure(brokers, 'Trading 212');
  await connect.getByLabel('ID klíče API').fill('e2e-key-id');
  await connect.getByLabel('Tajný klíč').fill('e2e-tajny-klic-12345');
  await connect.getByRole('button', { name: 'Připojit' }).click();
  // uložení klíče se potvrdí hláškou a stránka zůstane u karty brokera (L6b-01)
  await expect(page.getByRole('status').filter({ hasText: 'Klíč je uložený' })).toBeVisible();
  await expect(page).toHaveURL(/\/import#trading212$/);
  const account = page.locator('#trading212');
  await expect(account.getByRole('heading', { name: 'Trading 212' })).toBeVisible();
  await expect(account.getByText('Připojeno. Zbývá stáhnout historii.')).toBeVisible();

  // ── spuštění plné synchronizace — akce se vrátí hned, job běží na pozadí ─
  await account.getByRole('button', { name: 'Stáhnout kompletní historii' }).click();

  // průběh: fáze + stavy per rok (polling každé 3 s)
  await expect(
    account.getByText(/Synchronizace čeká ve frontě|Připojuji se k Trading 212|Stahuji transakce/),
  ).toBeVisible();
  await expect(
    account.getByRole('list', { name: 'Průběh po letech' }).getByText('2026', { exact: true }),
  ).toBeVisible();

  // ── dokončení: stránka se překreslí, rekonciliace sedí ──────────────────
  await expect(account.getByText(/Pozice sedí s Trading 212/)).toBeVisible({ timeout: 60_000 });
  await expect(importHistory(page).getByText('t212-api-2026.csv')).toBeVisible();
  await expect(importHistory(page).getByText('t212-api-2024.csv')).toBeVisible();

  // dashboard po syncu ukazuje data
  await page.goto('/prehled');
  await expect(page.getByRole('heading', { name: /Přehled \d{4}/ })).toBeVisible();
});

/**
 * Chyba synchronizace se dřív vypisovala syrově („Trading212 API 500 na
 * /history/exports: {…}“). Na obrazovce má být věta podle druhu chyby
 * a syrový text až za rozbalením, ať ho jde poslat provozovateli
 * (`lib/sync-failure.ts`). Mock brokera vrací chybu účtu, jehož ID klíče je
 * `selhani-<kód>`.
 */
test('T212 sync: když broker neodpovídá, řekne to větou a syrovou chybu schová', async ({
  page,
}) => {
  await registerWithProfile(page, { name: 'E2E Sync chyba', email: 'sync-chyba@danero.cz' });
  await page.goto('/import');
  const brokers = page.getByRole('list', { name: 'Brokeři s automatickou synchronizací' });
  const connect = await openDisclosure(brokers, 'Trading 212');
  await connect.getByLabel('ID klíče API').fill('selhani-500');
  await connect.getByLabel('Tajný klíč').fill('e2e-tajny-klic-12345');
  await connect.getByRole('button', { name: 'Připojit' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Klíč je uložený' })).toBeVisible();

  const account = page.locator('#trading212');
  await account.getByRole('button', { name: 'Stáhnout kompletní historii' }).click();
  await expect(account.getByText('Poslední synchronizace selhala')).toBeVisible({ timeout: 60_000 });

  // věta pro člověka, bez kódu a bez adresy rozhraní
  await expect(
    account.getByText('Trading 212 teď neodpovídá. Zkus to za chvíli znovu — co už se stáhlo, zůstává.'),
  ).toBeVisible();
  const raw = account.getByText(/Trading212 API 500 na \/history\/exports/);
  await expect(raw).toBeHidden();
  // syrový text je k mání na požádání
  const detail = await openDisclosure(account, 'Technický detail');
  await expect(detail.getByText(/Trading212 API 500 na \/history\/exports/)).toBeVisible();

  // po neúspěchu zůstává první synchronizace plná — účet se netváří jako
  // synchronizovaný (`lastSyncedAt` se nenastavilo)
  await expect(account.getByRole('button', { name: 'Stáhnout kompletní historii' })).toBeVisible();
  await expect(account.getByText('Poslední synchronizace', { exact: true })).toHaveCount(0);
});
