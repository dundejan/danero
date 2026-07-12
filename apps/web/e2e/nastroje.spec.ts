import { expect, test } from '@playwright/test';

/**
 * Veřejné mikro-nástroje (docs/12): kalkulačka časového testu a Paušálmetr —
 * čistě klientská logika bez ukládání. Stránka Bezpečnost je statická.
 */

test('/casovy-test: starý nákup je osvobozený, čerstvý ukáže datum a kalendář', async ({
  page,
}) => {
  await page.goto('/casovy-test');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Kdy můžu prodat bez daně?',
  );

  // nákup před více než 3 lety → lhůta uplynula
  await page.locator('#ct-nakup').fill('2020-01-15');
  await expect(page.getByText('Bez daně můžeš prodat od 16. ledna 2023.')).toBeVisible();
  await expect(page.getByText(/lhůta už uplynula/)).toBeVisible();

  // čerstvý nákup → zbývající dny + tlačítko na ICS
  const nedavno = new Date();
  nedavno.setDate(nedavno.getDate() - 30);
  await page.locator('#ct-nakup').fill(nedavno.toISOString().slice(0, 10));
  await expect(page.getByText(/^Zbývá \d+ (den|dny|dní)\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Přidat do kalendáře (.ics)' })).toBeVisible();
});

test('/pausalmetr: součet polí a verdikt prolomení limitu', async ({ page }) => {
  await page.goto('/pausalmetr');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('50 000 Kč');

  // Intl cs-CZ odděluje tisíce nezlomitelnou mezerou → \s v regexech
  await page.locator('#pm-dividendy').fill('30 000');
  await expect(page.getByText(/30\s000 Kč z 50\s000 Kč/)).toBeVisible();
  await expect(page.getByText(/Do limitu ti zbývá 20\s000 Kč/)).toBeVisible();

  await page.locator('#pm-prodeje').fill('25000');
  await expect(page.getByText(/55\s000 Kč z 50\s000 Kč/)).toBeVisible();
  await expect(page.getByText(/Limit je prolomený/)).toBeVisible();
});

test('/jak-pocitame a průvodce se vykreslí s obsahem', async ({ page }) => {
  await page.goto('/jak-pocitame');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Každé pravidlo má svůj paragraf',
  );
  await expect(page.getByText('Sporné výklady přiznáváme')).toBeVisible();

  await page.goto('/pruvodce');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('link', { name: /objem prodejů, ne zisk|Limit 100 000/ }).first().click();
  await page.waitForURL('**/pruvodce/limit-100-000-kc');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('100 000');
});

test('/bezpecnost a ICS kalendář jsou dostupné', async ({ page, request }) => {
  await page.goto('/bezpecnost');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Bereme to vážně');
  await expect(page.getByText('API klíče jen pro čtení', { exact: true })).toBeVisible();

  const ics = await request.get('/api/kalendar');
  expect(ics.status()).toBe(200);
  expect(ics.headers()['content-type']).toContain('text/calendar');
  const body = await ics.text();
  expect(body).toContain('BEGIN:VCALENDAR');
  expect(body).toContain('RRULE:FREQ=YEARLY');
});
