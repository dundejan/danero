/**
 * Kódy chyb, které patří ke konkrétnímu formuláři stránky Účet. Formulář se
 * po neúspěchu otevře znovu a hlášku ukáže u pole, kterého se týká — ne
 * v toastu nad zavřeným řádkem.
 *
 * Samostatný soubor bez `'use client'`: seznamy čte stránka na serveru
 * (rozhoduje, jestli chybu ukáže toast) i formuláře v prohlížeči.
 */
export const PASSWORD_ERRORS = [
  'heslo',
  'heslo-bezne',
  'heslo-spatne',
  'heslo-limit',
  'heslo-selhalo',
];
export const EMAIL_ERRORS = [
  'email',
  'email-obsazeny',
  'email-ulozeni',
  'email-heslo',
  'email-limit',
];
export const DELETE_ERRORS = ['smazani', 'smazani-heslo', 'smazani-limit', 'smazani-selhalo'];

/** Chyba, kterou stránka ukazuje u pole, ne v toastu. */
export const isInlineAccountError = (code: string): boolean =>
  [PASSWORD_ERRORS, EMAIL_ERRORS, DELETE_ERRORS].some((codes) => codes.includes(code));
