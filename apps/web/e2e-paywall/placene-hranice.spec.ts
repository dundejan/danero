import { expect, test } from '@playwright/test';
import { registerWithProfile } from '../e2e/helpers';

/**
 * Placené hranice očima uživatele BEZ předplatného (`DANERO_BILLING=stripe`).
 *
 * Pravidlo: zamčená funkce se musí poznat DŘÍV, než do ní uživatel investuje
 * práci. Napojení brokera přes API to porušovalo — formulář se tvářil dostupně,
 * uživatel si u brokera vygeneroval klíč, vyplnil ho a teprve odeslání skončilo
 * hláškou, že je to placené. Hlídá se tu i to, že zdarma věci zůstávají zdarma.
 */
test.describe('uživatel bez předplatného', () => {
  /**
   * Vlastní adresa per scénář — registrace je jednorázová a `linkFromEmail`
   * bere POSLEDNÍ e-mail pro danou adresu, takže sdílená adresa by druhému
   * testu podstrčila už spotřebovaný ověřovací odkaz.
   */
  const registruj = (page: Parameters<typeof registerWithProfile>[0], kdo: string) =>
    registerWithProfile(page, { name: `E2E Paywall ${kdo}`, email: `paywall-${kdo}@danero.cz` });

  test('napojení brokera je vidět jako placené, ne až po odeslání formuláře', async ({ page }) => {
    await registruj(page, 'broker');
    await page.goto('/import');

    // formulářová pole pro klíče se vůbec nenabízejí
    await expect(page.locator('input[name="tajny-klic"]')).toHaveCount(0);
    await expect(page.locator('input[name="token"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Připojit' })).toHaveCount(0);

    // místo nich je jasně řečeno, že jde o součást předplatného, a kam dál.
    // Hlídá se CÍL odkazu, ne jeho popisek: text se přepisuje, ale skončit
    // musí tam, kde se dá koupit — do 9. 8. 2026 vedl na veřejný ceník,
    // který přihlášenému nabízí akorát registraci.
    await expect(page.getByText(/Součást hlídání za/).first()).toBeVisible();
    await expect(page.locator('a[href="/predplatne"]').first()).toBeVisible();
  });

  test('hlídací e-maily se nenabízejí, když je stejně nikdo neodešle', async ({ page }) => {
    // Rozesílku dělá /api/cron/notify jen platícím. Dokud tu stály funkční
    // přepínače, uživatel zdarma si zapnul „Posílat e-maily“, vybral frekvenci
    // i typy — a pak čekal na e-mail, který nikdy nepřišel, bez jediné zmínky proč.
    await registruj(page, 'notifikace');
    await page.goto('/nastaveni#notifikace');

    await expect(page.getByLabel('Posílat e-maily')).toHaveCount(0);
    await expect(page.getByText('denní souhrn')).toHaveCount(0);
    await expect(page.getByText(/Součást hlídání za/).first()).toBeVisible();
    // v aplikaci se upozornění počítají dál a stránka to musí říct
    await expect(page.getByText(/Upozornění v aplikaci vidíš i bez předplatného/)).toBeVisible();
  });

  test('ruční nahrání výpisů zůstává zdarma', async ({ page }) => {
    await registruj(page, 'import');
    await page.goto('/import');
    await expect(page.locator('input[name="soubory"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Nahrát výpisy' })).toBeVisible();
  });

  test('server action odmítne napojení i při přímém volání', async ({ page }) => {
    // UI formulář schovává, ale action jde zavolat přímo — hranice musí držet
    // na serveru (actions.ts → requireBrokerSync), ne jen v šabloně
    await registruj(page, 'action');
    await page.goto('/import');
    const response = await page.request.post('/import', {
      form: { 'id-klice': 'abc', 'tajny-klic': 'tajny-klic-dost-dlouhy' },
    });
    // ať už odpoví čímkoli, klíč se nesmí uložit a sync se nesmí objevit
    expect(response.status()).toBeLessThan(500);
    await page.reload();
    await expect(page.getByText('Připojeno.')).toHaveCount(0);
  });
});
