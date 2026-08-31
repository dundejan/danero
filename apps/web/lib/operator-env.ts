import { type EnvSource, missingOperatorContactEnv, operatorFromEnv } from '@/lib/contact';

/**
 * Předletová kontrola prostředí pro nástroje provozovatele, které posílají
 * e-mail uživateli (`scripts/failed-imports.ts`).
 *
 * Nástroj se spouští ručně proti produkci a jeho návod jmenoval jen
 * `DATABASE_URL`. Databáze ale o odchozím e-mailu nerozhoduje: identifikaci
 * provozovatele bere `lib/contact.ts` z `DANERO_OPERATOR_*` a odkaz do aplikace
 * skládá `lib/email.ts` z `BETTER_AUTH_URL`. Bez nich odejde uživateli zpráva
 * podepsaná „Danero — nenastaveno, IČO nenastaveno" s odkazem na
 * `http://localhost:3000` — tedy něco, co je k nerozeznání od phishingu
 * (naměřeno ve 4. auditu, nález K2-04).
 *
 * Kontrola schválně **není** v `lib/email.ts`: v běžícím serveru by shodila
 * odchozí poštu, a tam je zástupný text ještě pořád lepší než neodeslaná
 * obnova hesla. Nástroj spouštěný ručně se naopak zastavit má — než odešle
 * první e-mail.
 */

/** Nenastavené proměnné, bez kterých nemá odchozí e-mail uživateli smysl posílat. */
export function missingEmailEnv(env: EnvSource = process.env): string[] {
  const missing = missingOperatorContactEnv(operatorFromEnv(env));
  // `appUrl()` v lib/email.ts padá bez téhle proměnné na localhost — odkaz
  // v e-mailu pak vede do počítače příjemce
  if (!env.BETTER_AUTH_URL?.trim()) missing.push('BETTER_AUTH_URL');
  return missing;
}

/** Hláška nástroje: co chybí a proč se kvůli tomu nic neodeslalo. */
export function emailEnvError(missing: string[]): string {
  return [
    `Chybí nastavení prostředí: ${missing.join(', ')}.`,
    'Bez něj by uživateli odešel e-mail bez identifikace provozovatele a s odkazem',
    'na http://localhost:3000. Doplň proměnné (proti produkci tytéž hodnoty jako',
    've Vercelu — vedle DATABASE_URL) a spusť příkaz znovu.',
  ].join('\n');
}
