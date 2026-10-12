import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { heldActionResult, type ActionResult } from '@/lib/action-result';
import {
  DELETE_ERRORS,
  EMAIL_ERRORS,
  isInlineAccountError,
  PASSWORD_ERRORS,
} from '@/app/(app)/nastaveni/ucet/inline-errors';

/**
 * Formuláře stránky Účet ukazují chybu u pole a výsledek akce si drží
 * v prohlížeči. Dřív je kreslil server jen podle adresy — a ta se po zobrazení
 * uklízí, takže první obnovení stránky ze serveru řádek s chybou zavřelo,
 * hlášku smazalo a rozepsaný text zahodilo (naživo 11. 10. 2026; stejně dopadl
 * i řádek otevřený ručně, protože klíč řádku byl při každém vykreslení jiný).
 */
const wrongPassword: ActionResult = { id: 'a', error: 'heslo-spatne' };

describe('výsledek akce, který formulář drží', () => {
  it('nový výsledek z adresy formulář převezme', () => {
    expect(heldActionResult(null, wrongPassword, true)).toBe(wrongPassword);
    const saved: ActionResult = { id: 'b', error: null };
    expect(heldActionResult(wrongPassword, saved, true)).toBe(saved);
  });

  it('obnovení stránky bez výsledku nic nemění — chyba i otevřený řádek zůstávají', () => {
    expect(heldActionResult(wrongPassword, null, false)).toBe(wrongPassword);
    expect(heldActionResult(null, null, false)).toBeNull();
  });

  it('tentýž výsledek podruhé je pořád tentýž objekt (řádek se nezakládá znovu)', () => {
    expect(heldActionResult(wrongPassword, { ...wrongPassword }, true)).toBe(wrongPassword);
  });

  it('stejná chyba po sobě je nový výsledek — pozná se podle id', () => {
    const again: ActionResult = { id: 'c', error: 'heslo-spatne' };
    expect(heldActionResult(wrongPassword, again, true)).toBe(again);
  });

  it('stránka vrácená z paměti směrovače starou chybu neukáže znovu', () => {
    // adresa výsledek nenese, i když ho vykreslení z paměti má
    expect(heldActionResult(null, wrongPassword, false)).toBeNull();
  });
});

describe('které chyby stránka Účet ukazuje u pole', () => {
  it('každá chyba formulářů je u pole, ostatní v toastu', () => {
    for (const code of [...PASSWORD_ERRORS, ...EMAIL_ERRORS, ...DELETE_ERRORS]) {
      expect(isInlineAccountError(code), code).toBe(true);
    }
    for (const code of ['fixace', 'rezim', 'prijmy', 'cokoli']) {
      expect(isInlineAccountError(code), code).toBe(false);
    }
  });

  it('seznamy se nepřekrývají — chyba patří právě jednomu formuláři', () => {
    const all = [...PASSWORD_ERRORS, ...EMAIL_ERRORS, ...DELETE_ERRORS];
    expect(new Set(all).size).toBe(all.length);
  });
});

/**
 * Vykreslit stránku v unit testu nejde (serverová komponenta nad relací
 * a databází), takže se hlídá zdroják — stejně jako `account-page-controls`.
 */
describe('stránka Účet neřídí rozbalení řádku z adresy', () => {
  const WEB_ROOT = resolve(import.meta.dirname, '..');
  const read = (path: string): string => readFileSync(resolve(WEB_ROOT, path), 'utf8');

  it('řádky nemají řízený atribut `open` ani klíč, který se mění při každém vykreslení', () => {
    const page = read('app/(app)/nastaveni/ucet/page.tsx');
    const forms = read('app/(app)/nastaveni/ucet/account-forms.tsx');
    for (const source of [page, forms]) {
      expect(source).not.toMatch(/<DisclosureRow[^>]*\sopen=/);
    }
    // formuláře jsou v prohlížeči a výsledek si drží samy
    expect(page).toContain('<CredentialRows');
    expect(page).toContain('<DeleteAccountDialog');
    expect(forms).toContain('heldActionResult');
    expect(forms.match(/defaultOpen=\{/g)?.length).toBe(3);
  });
});
