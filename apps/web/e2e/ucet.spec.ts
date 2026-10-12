import { expect, test } from '@playwright/test';
import { UNIVERSAL_TEMPLATE_CSV } from '../../../packages/importers/src/universal/csv';
import {
  autoSaveForm,
  hydrated,
  openConfirmDialog,
  openDisclosure,
  registerWithProfile,
  signOut,
  signOutButton,
  uploadStatement,
} from './helpers';

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
  await uploadStatement(page, {
    name: 'sablona.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(UNIVERSAL_TEMPLATE_CSV, 'utf8'),
  });

  // ── zabezpečení: sessions + audit (G8b) ──────────────────────────────────
  await page.goto('/nastaveni/ucet');
  await expect(page.getByRole('heading', { name: /^Aktivní přihlášení \d+$/ })).toBeVisible();
  await expect(page.getByText('toto zařízení')).toBeVisible();
  // záznamy auditu jsou za rozbalením pod přihlášenými zařízeními
  const activity = (await openDisclosure(page, /^Poslední aktivita \(\d+\)$/)).getByRole(
    'listitem',
  );
  await expect(activity.filter({ hasText: /^Přihlášení/ }).first()).toBeVisible(); // audit LOGIN
  await expect(activity.filter({ hasText: /^Import výpisu/ })).toBeVisible(); // audit IMPORT

  // ── změna hesla ──────────────────────────────────────────────────────────
  const password = await openDisclosure(page, /^Heslo/);
  await password.getByLabel('Současné heslo').fill(HESLO);
  await password.getByLabel('Nové heslo').fill(NOVE_HESLO);
  await password.getByRole('button', { name: 'Změnit heslo' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Heslo změněno' })).toBeVisible();

  await openDisclosure(page, /^Poslední aktivita \(\d+\)$/);
  await expect(activity.filter({ hasText: /^Změna hesla/ })).toBeVisible();

  // nové heslo funguje (odhlásit → přihlásit)
  await signOut(page);
  await page.getByLabel('E-mail').fill('ucet@danero.cz');
  await page.getByLabel('Heslo').fill(NOVE_HESLO);
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await page.waitForURL('**/prehled');

  // ── změna e-mailu (proti mrtvé konfiguraci — dřív padala vždy) ──────────
  await page.goto('/nastaveni/ucet');
  const emailRow = await openDisclosure(page, /^E-mail/);
  await emailRow.getByLabel('Nový e-mail').fill('ucet-novy@danero.cz');
  await emailRow.getByLabel('Heslo (potvrzení)').fill(NOVE_HESLO);
  await emailRow.getByRole('button', { name: 'Změnit e-mail' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'E-mail změněn.' })).toBeVisible();
  // nová adresa je vidět v řádku účtu i u přihlášeného uživatele v panelu
  await expect(page.locator('summary').filter({ hasText: /^E-mail/ })).toContainText(
    'ucet-novy@danero.cz',
  );
  await expect(page.getByRole('complementary')).toContainText('ucet-novy@danero.cz');

  // surový endpoint Better Auth je vypnutý — bez něj by session cookie stačila
  // k přepsání identity účtu bez hesla; jediná cesta je akce s re-autentizací
  const rawChange = await page.request.post('/api/auth/change-email', {
    data: { newEmail: 'utocnik@danero.cz' },
  });
  expect(rawChange.status()).toBe(403);

  // ── export dat: JSON s transakcemi ───────────────────────────────────────
  await expect(page.getByRole('link', { name: 'Stáhnout moje data' })).toHaveAttribute(
    'href',
    '/api/export',
  );
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
  await page.goto('/nastaveni/ucet');
  // nevratná akce je za potvrzovacím dialogem — heslo a opsané slovo se
  // vyplňují až v něm
  const dialog = await openConfirmDialog(page, page.getByRole('button', { name: 'Smazat účet…' }));
  // Překlep v hesle: dialog se otevře znovu a řekne to u pole. Správné heslo
  // hned potom účet smaže — dřív jeden pokus stál dva zápisy do limitu, takže
  // druhý pokus narazil na strop a formulář k tomu tvrdil, že heslo nesedí.
  await dialog.getByLabel('Heslo', { exact: true }).fill('tohle-neni-moje-heslo');
  await dialog.getByLabel('Pro potvrzení napiš SMAZAT').fill('SMAZAT');
  await dialog.getByRole('button', { name: 'Smazat účet', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Heslo nesedí — účet se nesmazal.');
  await dialog.getByLabel('Heslo', { exact: true }).fill(NOVE_HESLO);
  await dialog.getByLabel('Pro potvrzení napiš SMAZAT').fill('SMAZAT');
  await dialog.getByRole('button', { name: 'Smazat účet', exact: true }).click();
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
 * Chyba u pole je výsledek akce z adresy a adresa se po zobrazení uklízí.
 * Dokud formuláře kreslil server jen podle ní, první obnovení stránky ze
 * serveru řádek zavřelo uživateli pod rukama: hláška zmizela a rozepsané
 * heslo s ní (naživo 11. 10. 2026). Obnovení tu vyvolá návrat stránky
 * z mezipaměti prohlížeče; že opravdu doběhlo, se pozná podle záznamu
 * v aktivitě, který mezitím přibyl z jiného zařízení.
 */
test('účet: chyba u pole a rozepsaný text přežijí obnovení stránky ze serveru', async ({
  page,
  browser,
}) => {
  await registerWithProfile(page, { name: 'E2E Chyba u pole', email: 'ucet-chyba@danero.cz' });
  await page.goto('/nastaveni/ucet');
  const activity = page.locator('summary').filter({ hasText: /^Poslední aktivita \(\d+\)$/ });
  const eventsBefore = Number((await activity.innerText()).match(/\d+/)![0]);

  // špatné současné heslo: řádek se otevře znovu a řekne to u pole
  const password = await openDisclosure(page, /^Heslo/);
  await password.getByLabel('Současné heslo').fill('tohle-neni-moje-heslo');
  await password.getByLabel('Nové heslo').fill(NOVE_HESLO);
  await password.getByRole('button', { name: 'Změnit heslo' }).click();
  const fieldError = page.getByRole('alert').filter({ hasText: 'Současné heslo nesedí' });
  await expect(fieldError).toBeVisible();
  await expect(page).toHaveURL(/\/nastaveni\/ucet$/);
  // uživatel začne opravovat; vedle má ručně otevřený a rozepsaný i e-mail
  const currentPassword = page.getByLabel('Současné heslo');
  await currentPassword.fill(HESLO);
  const emailRow = await openDisclosure(page, /^E-mail/);
  await emailRow.getByLabel('Nový e-mail').fill('rozepsany@danero.cz');

  // jiné zařízení téhož účtu mezitím změní profil → přibude záznam v aktivitě
  const elsewhere = await browser.newContext({ storageState: await page.context().storageState() });
  const other = await elsewhere.newPage();
  await other.goto('/nastaveni');
  await autoSaveForm(other);
  await other.getByLabel('Párování prodejů').selectOption('LIFO');
  await expect(other.getByRole('status').filter({ hasText: 'Uloženo.' })).toBeVisible();
  await elsewhere.close();

  // stránka se obnoví ze serveru (návrat z mezipaměti prohlížeče)
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );
  await expect(
    page.locator('summary').filter({ hasText: `Poslední aktivita (${eventsBefore + 1})` }),
  ).toBeVisible();

  // řádek zůstal otevřený i s hláškou a s tím, co je v něm napsané
  await expect(fieldError).toBeVisible();
  await expect(currentPassword).toHaveValue(HESLO);
  await expect(currentPassword).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Nový e-mail')).toHaveValue('rozepsany@danero.cz');

  // a oprava projde: řádek se zavře, pole jsou prázdná
  await page.getByLabel('Nové heslo').fill(NOVE_HESLO);
  await page.getByRole('button', { name: 'Změnit heslo' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Heslo změněno' })).toBeVisible();
  await expect(page.locator('summary').filter({ hasText: /^Heslo/ }).locator('xpath=..')).not.toHaveAttribute(
    'open',
  );
  await expect(fieldError).toHaveCount(0);
});

/**
 * Revize R8, M2 — kód výsledku se z adresy uklízel jen jednou. Druhá chyba
 * u pole v JINÉM formuláři téže stránky (špatné heslo u změny hesla, pak
 * u změny e-mailu) v adrese zůstala: stránka pak při každém obnovení ze
 * serveru vypadala jako čerstvý výsledek, řádky vznikly znovu a rozepsaný
 * text zmizel; obnovení stránky navíc ukázalo chybu znovu.
 */
test('účet: druhá chyba v jiném formuláři nenechá kód v adrese', async ({ page, browser }) => {
  await registerWithProfile(page, { name: 'E2E Dvě chyby', email: 'ucet-dve-chyby@danero.cz' });
  await page.goto('/nastaveni/ucet');
  const activity = page.locator('summary').filter({ hasText: /^Poslední aktivita \(\d+\)$/ });
  const eventsBefore = Number((await activity.innerText()).match(/\d+/)![0]);

  const password = await openDisclosure(page, /^Heslo/);
  await password.getByLabel('Současné heslo').fill('tohle-neni-moje-heslo');
  await password.getByLabel('Nové heslo').fill(NOVE_HESLO);
  await password.getByRole('button', { name: 'Změnit heslo' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Současné heslo nesedí' })).toBeVisible();
  await expect(page).toHaveURL(/\/nastaveni\/ucet$/);

  // hned potom chyba ve vedlejším formuláři — stránka se mezitím neobnovila
  const emailRow = await openDisclosure(page, /^E-mail/);
  await emailRow.getByLabel('Nový e-mail').fill('jiny@danero.cz');
  await emailRow.getByLabel('Heslo (potvrzení)').fill('tohle-taky-ne');
  await emailRow.getByRole('button', { name: 'Změnit e-mail' }).click();
  const emailError = page.getByRole('alert').filter({ hasText: 'Heslo nesedí — e-mail se nezměnil.' });
  await expect(emailError).toBeVisible();
  await expect(page).toHaveURL(/\/nastaveni\/ucet$/);

  // uživatel opravuje adresu; stránka se obnoví ze serveru (jiné zařízení něco uložilo)
  const newEmail = page.getByLabel('Nový e-mail');
  await newEmail.fill('rozepsany@danero.cz');
  const elsewhere = await browser.newContext({ storageState: await page.context().storageState() });
  const other = await elsewhere.newPage();
  await other.goto('/nastaveni');
  await autoSaveForm(other);
  await other.getByLabel('Párování prodejů').selectOption('LIFO');
  await expect(other.getByRole('status').filter({ hasText: 'Uloženo.' })).toBeVisible();
  await elsewhere.close();
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );
  await expect(
    page.locator('summary').filter({ hasText: `Poslední aktivita (${eventsBefore + 1})` }),
  ).toBeVisible();
  await expect(newEmail).toHaveValue('rozepsany@danero.cz');
  await expect(emailError).toBeVisible();

  // a obnovení stránky chybu neukáže znovu
  await page.reload();
  await expect(page.locator('summary').filter({ hasText: /^E-mail/ })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Heslo nesedí' })).toHaveCount(0);
});

/**
 * L12-04: odhlášení, které server nepotvrdil, nesmí ukázat přihlašovací
 * stránku. Dřív se po chybě 500 (výpadek databáze, strop požadavků) rovnou
 * přesměrovalo na /prihlaseni, ač relace platila dál — na sdíleném počítači
 * by si další člověk otevřel cizí data napsáním adresy.
 */
test('odhlášení: po chybě serveru i výpadku sítě zůstane na stránce s hláškou', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Odhlášení', email: 'odhlaseni@danero.cz' });
  const failureMessage = page.getByText('Odhlásit se nepodařilo — tvoje přihlášení dál platí.');
  // stránka, na které uživatel je (nový účet končí na Zdrojích dat)
  await page.goto('/prehled');
  await expect(page.getByRole('heading', { name: 'Přehled' })).toBeVisible();

  // ── server odpoví 500 ────────────────────────────────────────────────────
  await page.route('**/api/auth/sign-out', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }),
  );
  await (await signOutButton(page)).click();
  await expect(failureMessage).toBeVisible();
  await expect(page).toHaveURL(/\/prehled$/);
  // relace opravdu trvá — chráněný export ji pořád pustí
  expect((await page.request.get('/api/export')).status()).toBe(200);
  await page.unroute('**/api/auth/sign-out');

  // ── požadavek se vůbec nedoručí ──────────────────────────────────────────
  await page.reload();
  await expect(failureMessage).toHaveCount(0);
  await page.route('**/api/auth/sign-out', (route) => route.abort('failed'));
  await (await signOutButton(page)).click();
  await expect(failureMessage).toBeVisible();
  await expect(page).toHaveURL(/\/prehled$/);
  await page.unroute('**/api/auth/sign-out');

  // ── další pokus už projde: hláška zmizí a relace končí ───────────────────
  await page.getByRole('button', { name: 'Odhlásit se' }).click();
  await page.waitForURL('**/prihlaseni');
  expect((await page.request.get('/api/export')).status()).toBe(401);
});

/**
 * L7-01: na telefonu se nedalo odhlásit vůbec — jediné „Odhlásit se“ žilo
 * v patičce railu a ten se pod 768 px nevykresluje. Relace přitom platí 7 dní,
 * takže na půjčeném zařízení zůstala daňová data přístupná.
 *
 * Odhlášení je v každé šířce okna právě jedno a vždy u účtu ve skořápce:
 * v patičce postranního panelu, na telefonu v sheetu „Více“ spodní lišty.
 * Tlačítko na stránce Nastavení → Účet, které bylo na telefonu vidět vedle
 * toho v sheetu, je pryč (rozhodnuto 11. 10. 2026).
 */
test('odhlášení: v každé šířce právě jedno — na telefonu v sheetu „Více“', async ({ page }) => {
  const email = 'odhlaseni-telefon@danero.cz';
  await registerWithProfile(page, { name: 'E2E Telefon', email });
  await page.goto('/nastaveni/ucet');
  const signOutControl = page.getByRole('button', { name: 'Odhlásit se' });

  // počítač: jediné tlačítko je v patičce postranního panelu
  await expect(signOutControl).toHaveCount(1);
  await expect(page.getByRole('complementary').getByRole('button', { name: 'Odhlásit se' })).toBeVisible();

  // šířka telefonu: panel zmizel a stránka účtu vlastní odhlášení nemá
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('complementary')).toHaveCount(0);
  await expect(signOutControl).toHaveCount(0);

  // jediná cesta je sheet „Více“: ukáže, kdo je přihlášený, a nabídne odhlášení
  const tabBar = page.getByRole('navigation', { name: 'Hlavní navigace' });
  await (await hydrated(tabBar.getByRole('button', { name: 'Více' }))).click();
  const sheet = page.getByRole('dialog', { name: 'Další sekce' });
  await expect(sheet.getByText(email)).toBeVisible();
  await expect(signOutControl).toHaveCount(1);

  await sheet.getByRole('button', { name: 'Odhlásit se' }).click();
  await page.waitForURL('**/prihlaseni');
  expect((await page.request.get('/api/export')).status()).toBe(401);
});

/**
 * Danero je celé zdarma (podmínky 3.0): přihlášený uživatel má všechno
 * odemčené a nikde v aplikaci po něm nikdo nechce peníze. Do 8. 10. 2026 tu
 * stál test stránky Předplatné na instanci bez plateb.
 */
test('zdarma: nic není zamčené a staré stránky tarifů přesměrují', async ({ page }) => {
  await registerWithProfile(page, { name: 'E2E Zdarma', email: 'zdarma@danero.cz' });

  // v navigaci aplikace už položka Předplatné není
  await expect(page.getByRole('navigation', { name: 'Hlavní navigace' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Předplatné' })).toHaveCount(0);

  // napojení brokera nabízí rovnou formulář na klíč, ne výzvu k objednání
  await page.goto('/import');
  await expect(page.getByRole('heading', { name: 'Synchronizovat automaticky' })).toBeVisible();
  const brokers = page.getByRole('list', { name: 'Brokeři s automatickou synchronizací' });
  const trading212 = await openDisclosure(brokers, 'Trading 212');
  await expect(trading212.getByLabel('Tajný klíč')).toBeVisible();
  await expect(trading212.getByRole('button', { name: 'Připojit' })).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Objednat hlídání' })).toHaveCount(0);

  // hlídací e-maily jdou nastavit
  await page.goto('/nastaveni/upozorneni');
  await expect(page.getByRole('heading', { name: 'Odesílání' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Posílat e-maily' })).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Objednat hlídání' })).toHaveCount(0);

  // odkazy ze starých e-mailů (potvrzení objednávky, upomínka) nekončí na 404
  await page.goto('/predplatne');
  await expect(page).toHaveURL(/\/cenik$/);
  await page.goto('/predplatne/podklady');
  await expect(page).toHaveURL(/\/cenik$/);
  await page.goto('/odstoupeni');
  await expect(page).toHaveURL(/\/podminky$/);
});
