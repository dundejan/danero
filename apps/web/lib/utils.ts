import { redirect } from 'next/navigation';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Normalizace hodnoty z Next.js searchParams: opakovaný query parametr
 * (?cena=100&cena=200) přijde jako pole — bereme první hodnotu, ať kód
 * dál pracuje vždy se stringem a nespadne na `.replace` nad polem.
 */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Daňový rok z `?rok=` — a když je mimo rozsah, srovnej URL (H-3-20).
 *
 * Dřív se neplatná hodnota tiše nahradila běžným rokem, jenže v adresním
 * řádku zůstala: stránka pak ukazovala rok 2025 a URL tvrdila `?rok=1999`.
 * Kdo si takový odkaz uložil nebo poslal, dostal jiná čísla, než viděl.
 * Přesměrování na kanonickou adresu je levné a URL přestane lhát.
 *
 * Redirect se dělá jen tehdy, když parametr VŮBEC BYL — bez něj je běžný rok
 * legitimní výchozí stav a přesměrovávat není proč.
 */
export function resolveTaxYear(
  raw: string | string[] | undefined,
  years: readonly number[],
  currentYear: number,
  basePath: string,
): number {
  const rok = firstParam(raw);
  if (rok === undefined || rok === '') return currentYear;
  const parsed = Number(rok);
  if (years.includes(parsed)) return parsed;
  // `redirect()` vyhazuje výjimku, takže se sem už nic dalšího nedostane
  redirect(basePath);
}
