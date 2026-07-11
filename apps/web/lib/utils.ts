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
