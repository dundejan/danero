import { existsSync, readFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';
import { EMAIL_LOG } from '../playwright.config';

/**
 * E-maily z testovacího výstupu (DANERO_EMAIL_LOG). Filtruje se podle adresáta,
 * takže na zbytcích z minulého běhu nezáleží — každý scénář má vlastní e-mail.
 */
function lastEmailFor(to: string): { subject: string; text: string } | null {
  if (!existsSync(EMAIL_LOG)) return null;
  const messages = readFileSync(EMAIL_LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { to: string; subject: string; text: string })
    .filter((message) => message.to === to);
  return messages.at(-1) ?? null;
}

/** Poslední e-mail pro adresáta; čeká, než ho server stihne zapsat. */
export async function waitForEmail(
  page: Page,
  to: string,
  matches: (message: { subject: string; text: string }) => boolean = () => true,
): Promise<{ subject: string; text: string }> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const message = lastEmailFor(to);
    if (message && matches(message)) return message;
    await page.waitForTimeout(250);
  }
  throw new Error(`E-mail pro ${to} nedorazil do ${EMAIL_LOG}`);
}

/** Odkaz z e-mailu; čeká, než ho server stihne zapsat. */
export async function linkFromEmail(page: Page, to: string): Promise<string> {
  const message = await waitForEmail(page, to, (m) => /https?:\/\/\S+/.test(m.text));
  return message.text.match(/https?:\/\/\S+/)![0];
}

/**
 * Registrace nového uživatele + potvrzení e-mailu odkazem ze zprávy. Končí
 * přihlášený v onboarding průvodci (`/vitejte`, krok 1) — účet ještě nemá
 * daňový profil, takže zbytek aplikace vede na Nastavení.
 */
export async function registerAccount(
  page: Page,
  { name, email }: { name: string; email: string },
): Promise<void> {
  await page.goto('/registrace');
  await page.getByLabel('Jméno').fill(name);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Heslo').fill('bezpecne-heslo-e2e');
  await page.getByRole('button', { name: 'Vytvořit účet' }).click();
  // registrace nepřihlašuje — účet čeká na potvrzení adresy
  await page.waitForURL('**/overeni-emailu**');

  // odkaz z e-mailu ověří adresu a přihlásí — tenhle prohlížeč o něj požádal
  // registrací, takže nese cookie, podle které ho server pozná (R1) —
  // a skončí v onboarding průvodci (G9a)
  await page.goto(await linkFromEmail(page, email));
  await page.waitForURL('**/vitejte');
}

/**
 * První uložení daňového profilu s defaulty (paušál, FIFO, jednotný kurz).
 *
 * Končí na `/import`: první uložení profilu účtu bez dat vede rovnou ke kroku 2
 * (přidat obchody), ne na prázdný přehled.
 */
export async function saveFirstProfile(page: Page): Promise<void> {
  await page.goto('/nastaveni');
  // režim nemá předvolbu (R8) — nový uživatel ho musí vybrat
  await page.getByLabel('Daňový režim').selectOption('PAUSAL');
  await page.getByRole('button', { name: 'Uložit profil' }).click();
  // adresa nese kód hlášky jen do chvíle, než ji hláška sama uklidí
  await page.waitForURL(/\/import(\?|$)/);
  await expect(page.getByText('Krok 2 ze 2 — přidej svoje obchody')).toBeVisible();
}

/**
 * Registrace + potvrzení e-mailu + uložení daňového profilu — společný
 * začátek všech scénářů. Končí na Zdrojích dat (`/import`) s výzvou ke kroku 2.
 */
export async function registerWithProfile(
  page: Page,
  account: { name: string; email: string },
): Promise<void> {
  await registerAccount(page, account);
  await saveFirstProfile(page);
}

/** Seznam „Historie importů“ na stránce Zdroje dat — jediné místo, kde je název souboru záznamem. */
export const importHistory = (page: Page): Locator =>
  page.getByRole('list', { name: 'Historie importů' });

/** Řádek historie importů patřící k souboru (název, platforma a počty). */
export const importHistoryRow = (page: Page, filename: string): Locator =>
  importHistory(page)
    .getByRole('listitem')
    .filter({ has: page.getByText(filename, { exact: true }) });

/**
 * Nahraje výpis na stránce Zdroje dat a počká, až se propíše do historie.
 *
 * Čeká se na nový ZÁZNAM v historii, ne na název souboru kdekoli na stránce:
 * ten krátce svítí i u samotného pole pro výběr, než ho server action
 * zresetuje, a další `setInputFiles` by pak závodil s překreslením stránky.
 */
export async function uploadStatement(
  page: Page,
  file: string | { name: string; mimeType: string; buffer: Buffer },
): Promise<Locator> {
  const filename = typeof file === 'string' ? file.split(/[\\/]/).at(-1)! : file.name;
  const rows = importHistoryRow(page, filename);
  const before = await rows.count();
  await page.locator('input[name="soubory"]').setInputFiles(file);
  await page.getByRole('button', { name: 'Nahrát výpisy' }).click();
  await expect(rows).toHaveCount(before + 1, { timeout: 20_000 });
  // nejnovější import je v historii první
  return rows.first();
}

/**
 * Otevře rozbalovací řádek nebo detail (`<details>`) podle textu v jeho
 * záhlaví a vrátí ho. Už otevřený nechá být — druhé klepnutí by ho zavřelo
 * (řádek s chybou u pole otevírá server sám).
 */
export async function openDisclosure(
  scope: Page | Locator,
  summaryText: string | RegExp,
): Promise<Locator> {
  const summary = scope.locator('summary').filter({ hasText: summaryText });
  const details = summary.locator('xpath=..');
  // chybějící řádek má spadnout hned a jménem, ne viset do limitu testu
  await expect(summary).toBeVisible();
  if ((await details.getAttribute('open')) === null) await summary.click();
  await expect(details).toHaveAttribute('open', '');
  return details;
}

/**
 * Počká, až React prvku připojí handlery, a vrátí ho.
 *
 * Tlačítko je v HTML ze serveru dřív, než stránka hydratuje — klepnutí do té
 * mezery propadne beze stopy (dialog se neotevře, výběr se neodešle) a test
 * pak marně čeká na výsledek. React si při hydrataci na každý prvek zavěsí
 * vlastnost `__reactProps$…`; dokud tam není, prvek na události neodpovídá.
 * Nativní prvky (`<details>`, odkaz, formulář se server action) hydrataci
 * nepotřebují a tudy nechodí.
 */
export async function hydrated(locator: Locator): Promise<Locator> {
  // chybějící prvek má spadnout hned a jménem, ne viset do limitu testu
  await expect(locator).toBeVisible();
  await expect
    .poll(
      () =>
        locator.evaluate((element) =>
          Object.keys(element).some((key) => key.startsWith('__reactProps$')),
        ),
      { message: 'prvek se nehydratoval — React mu nepřipojil handlery' },
    )
    .toBe(true);
  return locator;
}

/**
 * Počká, až je stránka celá a živá: obsah dorazil, React naběhl a grafy se
 * nakreslily.
 *
 * Nahrazuje `waitForLoadState('networkidle')`, které čeká na půl vteřiny
 * síťového ticha — a to se nemusí dostavit nikdy: 9. 10. 2026 se audit
 * přístupnosti zasekl na `/portfolio` bez jediného běžícího dotazu a visel do
 * limitu testu (30 minut). Tady se čeká na stav, který jde pojmenovat, s vlastním
 * krátkým limitem; když nenastane, hláška řekne, co přesně chybí.
 *
 * - Stránky aplikace se streamují: nejdřív přijde kostra (`loading.tsx`), obsah
 *   až po ní. Dokud React segment nezařadí, leží v dokumentu jeho zástupka.
 * - Ovládací prvky jsou v HTML dřív, než jim React připojí handlery (viz
 *   `hydrated`).
 * - Grafy se kreslí až v prohlížeči, po změření šířky — hlídají se jen ty
 *   viditelné (graf ve skrytém pohledu se nenakreslí nikdy).
 */
export async function pageSettled(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const waiting: string[] = [];
          if (document.readyState !== 'complete') waiting.push('dokument se načítá');
          if (document.querySelector('template[id^="B:"], div[hidden][id^="S:"]')) {
            waiting.push('obsah se streamuje');
          }
          if (document.querySelector('[role="status"][aria-busy="true"]')) {
            waiting.push('je vidět kostra načítání');
          }
          const controls = document.querySelectorAll('button, input, select, textarea');
          const inert = [...controls].filter(
            (element) => !Object.keys(element).some((key) => key.startsWith('__reactProps$')),
          );
          if (inert.length > 0) waiting.push(`${inert.length} prvků bez handlerů Reactu`);
          for (const chart of document.querySelectorAll('.recharts-responsive-container')) {
            if (chart.getClientRects().length > 0 && !chart.querySelector('svg')) {
              waiting.push('graf se nenakreslil');
            }
          }
          return waiting;
        // stránka, která právě odchází jinam (přesměrování v prohlížeči), kontext zahodí
        }).catch(() => ['stránka přechází na jinou adresu']),
      { message: 'stránka se neustálila', timeout: 30_000 },
    )
    .toEqual([]);
}

/**
 * Počká, až formulář s auto-save začne poslouchat, a vrátí ho.
 *
 * Auto-save odesílá skript. Změnu, kterou do pole před hydratací udělá
 * ČLOVĚK, `AutoSubmit` po hydrataci dožene — pozná ji podle důvěryhodných
 * událostí (`lib/early-input.ts`). Změna vyslaná skriptem (`selectOption`,
 * `fill`) důvěryhodná není: vypadá stejně jako hodnota, kterou do pole vrátil
 * prohlížeč, a ta se schválně neodesílá, pole se vrátí na stav ze serveru.
 * Test proto čeká na signál aplikace (`data-auto-submit="ready"`), ne na
 * štěstí. Skutečný vstup před hydratací hlídá `nastaveni.spec.ts`.
 */
export async function autoSaveForm(page: Page): Promise<Locator> {
  const form = page.locator('form[data-auto-submit="ready"]');
  await expect(form, 'formulář s auto-save ještě neposlouchá').toHaveCount(1);
  return form;
}

/**
 * Pozdrží všechny skripty stránky — HTML ze serveru je vidět a dá se
 * ovládat, ale React ještě nenaběhl (pomalé připojení). Vrácená funkce skripty
 * pustí. Stránku je potřeba načítat s `waitUntil: 'commit'`: událost `load`
 * na pozdržené skripty čeká.
 */
export async function holdScripts(page: Page): Promise<() => void> {
  let release = (): void => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() === 'script') await released;
    // požadavek mohl mezitím zaniknout (stránka odešla jinam)
    await route.continue().catch(() => {});
  });
  return release;
}

/**
 * Tlačítko „Odhlásit se“, připravené ke klepnutí. Hledá se v celé stránce,
 * ne jen v postranním panelu: v širokém okně smí být na stránce jediné
 * a druhé (viditelné) by tady shodilo strict režim.
 */
export const signOutButton = (page: Page): Promise<Locator> =>
  hydrated(page.getByRole('button', { name: 'Odhlásit se' }));

/** Odhlásí se a počká na přihlašovací stránku. */
export async function signOut(page: Page): Promise<void> {
  await (await signOutButton(page)).click();
  await page.waitForURL('**/prihlaseni');
}

/** Otevře potvrzovací dialog nevratné akce a vrátí ho (dialog může mít vlastní pole). */
export async function openConfirmDialog(page: Page, trigger: Locator): Promise<Locator> {
  await (await hydrated(trigger)).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * Nevratná akce za potvrzovacím dialogem: klepne na spouštěč a dialog potvrdí
 * tlačítkem `confirmLabel` (opakuje sloveso akce — „Vrátit import zpět“).
 */
export async function confirmInDialog(
  page: Page,
  trigger: Locator,
  confirmLabel: string,
): Promise<void> {
  const dialog = await openConfirmDialog(page, trigger);
  await dialog.getByRole('button', { name: confirmLabel, exact: true }).click();
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Vybere limit v seznamu na přehledu a vrátí jeho detail (inspektor vedle
 * seznamu). V řádku je jen jméno limitu, čerpání a stav; celé znění s částkou
 * („Limit paušální daně — 50 000 Kč“), graf a výklad nese až detail.
 */
export async function selectLimit(page: Page, name: string): Promise<Locator> {
  const row = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}`) });
  await (await hydrated(row)).click();
  const detail = page.getByRole('region', { name: new RegExp(`^${escapeRegExp(name)}\\s—\\s`) });
  await expect(detail).toBeVisible();
  return detail;
}

/**
 * Zadá prodej do simulátoru a počká na výsledek.
 *
 * Formulář nemá odesílací tlačítko: výběr pozice se odešle hned, psaní po
 * krátké pauze. Čeká se proto na adresu s parametry a na to, až oblast
 * výsledku přestane být `aria-busy`.
 */
export async function simulateSale(
  page: Page,
  {
    position,
    quantity,
    price,
  }: { position: string | { index: number }; quantity: string; price: string },
): Promise<void> {
  const select = await hydrated(page.getByRole('combobox', { name: 'Pozice' }));
  await select.selectOption(position);
  await expect(page).toHaveURL(/[?&]isin=[^&]+/);
  await page.getByRole('textbox', { name: 'Počet kusů' }).fill(quantity);
  await page.getByRole('textbox', { name: /^Cena za kus/ }).fill(price);
  await expect(page).toHaveURL(
    new RegExp(`[?&]kusy=${escapeRegExp(quantity)}&cena=${escapeRegExp(price)}(&|$)`),
  );
  await expect(page.locator('[aria-busy]')).toHaveAttribute('aria-busy', 'false');
}
