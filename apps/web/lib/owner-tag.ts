/**
 * Označení účtu pro prohlížeč: krátký otisk, podle kterého stránka pozná, že
 * něco, co si odložila (rozepsaný text při odchodu, hláška o uložení), patří
 * právě přihlášenému účtu — a ne tomu, kdo byl v témže panelu přihlášený
 * před ním.
 *
 * Není to e-mail ani id uživatele a nic se s ním nedá udělat: je to HMAC id
 * tajemstvím serveru, zkrácený na 16 znaků. Server ho nikdy nečte zpátky —
 * slouží jen k porovnání dvou hodnot v prohlížeči.
 *
 * Jen na serveru (čte tajemství).
 */
export async function ownerTag(userId: string): Promise<string> {
  const { createHmac } = await import('node:crypto');
  const { resolveSecret } = await import('@/lib/auth');
  return createHmac('sha256', resolveSecret()).update(`owner|${userId}`).digest('hex').slice(0, 16);
}
