import { existsSync, readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
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

/** Odkaz z e-mailu; čeká, než ho server stihne zapsat. */
export async function linkFromEmail(page: Page, to: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const url = lastEmailFor(to)?.text.match(/https?:\/\/\S+/)?.[0];
    if (url) return url;
    await page.waitForTimeout(250);
  }
  throw new Error(`E-mail pro ${to} nedorazil do ${EMAIL_LOG}`);
}

/**
 * Registrace nového uživatele + potvrzení e-mailu + uložení daňového profilu
 * s defaulty (paušál, FIFO, jednotný kurz) — společný začátek všech scénářů.
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
  // registrace nepřihlašuje — účet čeká na potvrzení adresy
  await page.waitForURL('**/overeni-emailu**');

  // odkaz z e-mailu ověří adresu, přihlásí (autoSignInAfterVerification)
  // a skončí v onboarding průvodci (G9a)
  await page.goto(await linkFromEmail(page, email));
  await page.waitForURL('**/vitejte');

  await page.goto('/nastaveni');
  await page.getByRole('button', { name: 'Uložit profil' }).click();
  await page.waitForURL('**/prehled');
}
