import { expect, test } from '@playwright/test';
import { UNIVERSAL_TEMPLATE_CSV } from '../../../packages/importers/src/universal/csv';
import { registerWithProfile } from './helpers';

const HESLO = 'bezpecne-heslo-e2e';
const NOVE_HESLO = 'jeste-bezpecnejsi-heslo';

/**
 * Akceptace G8a: změna hesla (ověřená přihlášením), export dat obsahuje
 * transakce, smazání účtu = data pryč a přihlášení nejde (GDPR /soukromi).
 */
test('účet: změna hesla → export dat → nevratné smazání', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Účet', email: 'ucet@danero.cz' });

  // data k exportu: univerzální šablona
  await page.goto('/import');
  await page.locator('input[name="soubory"]').setInputFiles({
    name: 'sablona.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(UNIVERSAL_TEMPLATE_CSV, 'utf8'),
  });
  await page.getByRole('button', { name: 'Nahrát výpisy' }).click();
  await expect(page.getByText('sablona.csv')).toBeVisible();

  // ── zabezpečení: sessions + audit (G8b) ──────────────────────────────────
  await page.goto('/nastaveni');
  await expect(page.getByText(/Aktivní přihlášení \(\d+\)/)).toBeVisible();
  await expect(page.getByText('toto zařízení')).toBeVisible();
  await expect(page.getByText('Přihlášení').first()).toBeVisible(); // audit LOGIN
  await expect(page.getByText('Import výpisu').first()).toBeVisible(); // audit IMPORT

  // ── změna hesla ──────────────────────────────────────────────────────────
  await page.getByLabel('Současné heslo').fill(HESLO);
  await page.getByLabel('Nové heslo (min. 10 znaků)').fill(NOVE_HESLO);
  await page.getByRole('button', { name: 'Změnit heslo' }).click();
  await expect(page.getByText('Heslo změněno')).toBeVisible();

  await expect(page.getByText('Změna hesla').first()).toBeVisible();

  // nové heslo funguje (odhlásit → přihlásit)
  await page.getByRole('button', { name: 'Odhlásit se' }).click();
  await page.waitForURL('**/prihlaseni');
  await page.getByLabel('E-mail').fill('ucet@danero.cz');
  await page.getByLabel('Heslo').fill(NOVE_HESLO);
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await page.waitForURL('**/prehled');

  // ── změna e-mailu (proti mrtvé konfiguraci — dřív padala vždy) ──────────
  await page.goto('/nastaveni');
  await page.getByLabel('Nový e-mail').fill('ucet-novy@danero.cz');
  await page.getByLabel('Heslo (potvrzení)').fill(NOVE_HESLO);
  await page.getByRole('button', { name: 'Změnit e-mail' }).click();
  await expect(page.getByText('E-mail změněn.')).toBeVisible();
  await expect(page.getByText('ucet-novy@danero.cz').first()).toBeVisible();

  // surový endpoint Better Auth je vypnutý — bez něj by session cookie stačila
  // k přepsání identity účtu bez hesla; jediná cesta je akce s re-autentizací
  const rawChange = await page.request.post('/api/auth/change-email', {
    data: { newEmail: 'utocnik@danero.cz' },
  });
  expect(rawChange.status()).toBe(403);

  // ── export dat: JSON s transakcemi ───────────────────────────────────────
  const exportResponse = await page.request.get('/api/export');
  expect(exportResponse.ok()).toBe(true);
  const exported = (await exportResponse.json()) as {
    format: string;
    user: { email: string };
    transactions: unknown[];
    brokerAccounts: Array<Record<string, unknown>>;
  };
  expect(exported.format).toBe('danero-export-v1');
  expect(exported.user.email).toBe('ucet-novy@danero.cz');
  expect(exported.transactions.length).toBeGreaterThanOrEqual(8);
  // API klíče se nikdy neexportují
  expect(JSON.stringify(exported.brokerAccounts)).not.toContain('encrypted');

  // ── smazání účtu ─────────────────────────────────────────────────────────
  await page.goto('/nastaveni');
  await page.getByLabel('Heslo', { exact: true }).fill(NOVE_HESLO);
  await page.getByLabel('Napiš SMAZAT').fill('SMAZAT');
  await page.getByRole('button', { name: 'Nevratně smazat účet' }).click();
  await page.waitForURL(/smazano=1/);
  await expect(page.getByText('Účet byl smazán.')).toBeVisible();

  // přihlášení už nejde — účet neexistuje
  await page.goto('/prihlaseni');
  await page.getByLabel('E-mail').fill('ucet-novy@danero.cz');
  await page.getByLabel('Heslo').fill(NOVE_HESLO);
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(page.getByText('Přihlášení se nepodařilo. Zkontroluj e-mail a heslo.')).toBeVisible();
  // export bez session vrací 401
  const after = await page.request.get('/api/export');
  expect(after.status()).toBe(401);
});

/**
 * Předplatné (docs/19): stránka musí být v navigaci a nákup nesmí jít dokončit
 * bez výslovné žádosti o zahájení plnění (§ 1837 písm. l OZ) — ta je zákonná
 * podmínka, ne kosmetika, a checkbox nesmí být předškrtnutý.
 */
test('předplatné: v navigaci a bez souhlasu se nekupuje', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Platby', email: 'platby@danero.cz' });

  await page.getByRole('link', { name: 'Předplatné' }).click();
  await page.waitForURL('**/predplatne');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Předplatné');
  // cena je i v poučení o obnově, proto cílíme na cenovku
  await expect(page.getByText(/990 Kč\s*\/ rok/)).toBeVisible();

  // § 1811/2 a § 1820/1 OZ: doba trvání a automatická obnova musí být vidět
  // PŘED objednávkou, ne až ve stavu „mám zaplaceno"
  await expect(page.getByText(/Předplatné trvá/)).toBeVisible();
  await expect(page.getByText(/automaticky obnovuje za 990 Kč/)).toBeVisible();
  await expect(page.getByText(/14 dní před obnovou/)).toBeVisible();
  await expect(page.getByText(/zrušit ji můžeš kdykoli v zákaznickém portálu/)).toBeVisible();

  const souhlas = page.locator('#souhlas-predplatne');
  await expect(souhlas).not.toBeChecked();
  await expect(souhlas).toHaveAttribute('required', '');

  // odeslání bez zaškrtnutí prohlížeč nepustí — zůstáváme na stránce
  await page
    .locator('form', { has: souhlas })
    .getByRole('button', { name: 'Objednat s povinností platby' })
    .click();
  await expect(page).toHaveURL(/\/predplatne/);

  // ceny jsou konečné a je vidět, kdo prodává
  await expect(page.getByText(/Ceny jsou konečné/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'poučení o odstoupení' })).toBeVisible();
});
