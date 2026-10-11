import { isAPIError } from 'better-auth/api';

/**
 * Proč operace s účtem v Better Authu selhala (změna hesla, smazání účtu).
 *
 * Server actions v Nastavení každé selhání hlásily jako „heslo nesedí“ —
 * i zásah limitu pokusů a výpadek databáze. Člověk se správným heslem pak
 * zkoušel jiná nebo si ho šel obnovovat, a přitom stačilo počkat. Každá
 * příčina chce jinou radu, stejně jako u přihlášení (`lib/auth-errors.ts`).
 *
 * `limit` zůstává jako pojistka: server action si strop hlídá sama a háček
 * Better Authu její volání nepočítá (`limitSensitiveAccountOperations`), ale
 * kdyby se to někdy změnilo, nesmí se z toho znovu stát „heslo nesedí“.
 */
export type AccountFailure = 'password' | 'limit' | 'other';

/** Kódy Better Authu, které znamenají „tohle heslo k účtu nepatří“. */
const PASSWORD_CODES = new Set(['INVALID_PASSWORD', 'CREDENTIAL_ACCOUNT_NOT_FOUND']);

export function accountFailure(error: unknown): AccountFailure {
  if (!isAPIError(error)) return 'other';
  if (error.statusCode === 429) return 'limit';
  const code = (error.body as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' && PASSWORD_CODES.has(code) ? 'password' : 'other';
}
