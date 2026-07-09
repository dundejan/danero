import type { Page } from '@playwright/test';

/**
 * Registrace nového uživatele + uložení daňového profilu s defaulty
 * (paušál, FIFO, jednotný kurz) — společný začátek všech scénářů.
 */
export async function registerWithProfile(
  page: Page,
  { name, email }: { name: string; email: string },
): Promise<void> {
  await page.goto('/registrace');
  await page.getByLabel('Jméno').fill(name);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Heslo').fill('bezpecne-heslo-e2e');
  await page.getByRole('button', { name: 'Vytvořit účet' }).click();
  // registrace vede do onboarding průvodce (G9a)
  await page.waitForURL('**/vitejte');

  await page.goto('/nastaveni');
  await page.getByRole('button', { name: 'Uložit profil' }).click();
  await page.waitForURL('**/prehled');
}
