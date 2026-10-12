import { OWNER_FIELD } from '@/lib/form-baseline';

/**
 * Označení účtu pro prohlížeč: krátký otisk, podle kterého stránka pozná, že
 * něco, co si odložila (rozepsaný text při odchodu, hláška o uložení, fronta
 * ukládání), patří právě přihlášenému účtu — a ne tomu, kdo byl v témže panelu
 * přihlášený před ním.
 *
 * Není to e-mail ani id uživatele a nic se s ním nedá udělat: je to HMAC id
 * tajemstvím serveru, zkrácený na 16 znaků. Server ho zpátky čte na jediném
 * místě a jen k porovnání — viz `isOwnSubmission`.
 *
 * Jen na serveru (čte tajemství).
 */
export async function ownerTag(userId: string): Promise<string> {
  const { createHmac } = await import('node:crypto');
  const { resolveSecret } = await import('@/lib/auth');
  return createHmac('sha256', resolveSecret()).update(`owner|${userId}`).digest('hex').slice(0, 16);
}

/**
 * Poslal formulář ten účet, kterému byl vykreslen?
 *
 * Auto-save k odeslání přidává označení účtu, pro který stránka formulář
 * vykreslila (`OWNER_FIELD`). Přihlášení se ale v prohlížeči může změnit, aniž
 * se stránka načte znovu: odhlášení a přihlášení jiného účtu v témže panelu,
 * nebo v jiném panelu téhož prohlížeče. Odeslání, které odešlo až potom, nese
 * hodnoty jednoho účtu a přihlašovací cookie druhého — a server ho bez téhle
 * kontroly zapsal do cizího profilu (revize R8, M1: změřeno s odesláním
 * pozdrženým přes odhlášení).
 *
 * Odeslání bez označení (první uložení tlačítkem, stránka vykreslená starší
 * verzí aplikace) se bere jako vlastní — tak se ukládalo vždycky.
 */
export async function isOwnSubmission(
  form: { get(name: string): unknown },
  userId: string,
): Promise<boolean> {
  const submitted = form.get(OWNER_FIELD);
  if (typeof submitted !== 'string' || submitted === '') return true;
  return submitted === (await ownerTag(userId));
}
