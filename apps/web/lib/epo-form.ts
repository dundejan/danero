import type { EpoDapTyp } from '@/lib/epo';

/**
 * Sdílené konstanty formuláře exportu XML — zvlášť od `lib/epo.ts`, aby je
 * mohla číst klientská komponenta formuláře i serverový report (tlačítko
 * v liště formulář odesílá přes atribut `form`), aniž by si klient přibalil
 * celý generátor XML.
 */
export const EPO_FORM_ID = 'epo-export';

/** Typy přiznání, u kterých podatelna vyžaduje den zjištění důvodů (§ 141 DŘ). */
const SUPPLEMENTARY_TYPES: readonly EpoDapTyp[] = ['D', 'E'];

export const isSupplementaryFiling = (type: string): boolean =>
  (SUPPLEMENTARY_TYPES as readonly string[]).includes(type);

/** Stav platnosti pole, jak ho hlásí prohlížeč (`ValidityState`) — jen co hláška potřebuje. */
export interface FieldValidity {
  valueMissing: boolean;
  typeMismatch: boolean;
}

/**
 * Česká hláška k neplatnému poli exportu. Bublina prohlížeče mluví jazykem
 * prohlížeče a u pole ve sbalené sekci se neukázala vůbec — „Stáhnout XML“
 * pak mlčky neudělalo nic (nález R4-03).
 *
 * @param fallback hláška prohlížeče pro případ, na který tu vlastní znění není
 */
export function epoFieldError(name: string, validity: FieldValidity, fallback: string): string {
  if (name === 'datum-zjisteni' && validity.valueMissing) {
    return 'U dodatečného přiznání vyplň den, kdy jsi zjistil důvody — bez něj ho podatelna nepřijme.';
  }
  if (name === 'email' && validity.typeMismatch) {
    return 'E-mail nemá správný tvar — zkontroluj zavináč a doménu, nebo pole nech prázdné.';
  }
  if (validity.valueMissing) return 'Tohle pole je potřeba vyplnit.';
  return fallback || 'Hodnota v tomhle poli nemá správný tvar.';
}
