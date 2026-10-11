import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { differsFromServerHtml, type FormControlState } from '@/lib/form-changes';

/**
 * Změna v Nastavení provedená dřív, než se stránka hydratovala, se neuložila
 * a nic to neřeklo: nabídka ukazovala novou volbu, po novém načtení tu starou.
 * Našlo to E2E po redesignu (`zaklad.spec.ts` měnil párování hned po načtení
 * stránky a potvrzení „Uloženo“ nepřišlo). `AutoSubmit` proto po hydrataci
 * porovná formulář s HTML ze serveru — tady je to porovnání.
 */
const option = (selected: boolean, defaultSelected: boolean) => ({ selected, defaultSelected });

const select = (...options: Array<ReturnType<typeof option>>): FormControlState => ({
  tagName: 'SELECT',
  options,
});

describe('formulář změněný před hydratací', () => {
  it('nedotčený formulář se od HTML ze serveru neliší', () => {
    expect(
      differsFromServerHtml([
        select(option(true, true), option(false, false)),
        { tagName: 'INPUT', type: 'text', value: '0', defaultValue: '0' },
        { tagName: 'INPUT', type: 'checkbox', checked: false, defaultChecked: false },
        { tagName: 'TEXTAREA', value: '', defaultValue: '' },
      ]),
    ).toBe(false);
  });

  it('přepnutá nabídka se pozná: vybraná je jiná položka než výchozí', () => {
    expect(differsFromServerHtml([select(option(false, true), option(true, false))])).toBe(true);
  });

  it('pozná přepsané pole i přepnutý přepínač', () => {
    expect(
      differsFromServerHtml([{ tagName: 'INPUT', type: 'text', value: '10 000', defaultValue: '0' }]),
    ).toBe(true);
    expect(
      differsFromServerHtml([
        { tagName: 'INPUT', type: 'checkbox', checked: true, defaultChecked: false },
      ]),
    ).toBe(true);
    expect(differsFromServerHtml([{ tagName: 'TEXTAREA', value: 'x', defaultValue: '' }])).toBe(true);
  });

  it('nabídka bez výchozí položky v HTML se neposuzuje — první vybere prohlížeč sám', () => {
    expect(differsFromServerHtml([select(option(true, false), option(false, false))])).toBe(false);
  });

  it('skrytá, zakázaná a odesílací pole změnu nenesou', () => {
    expect(
      differsFromServerHtml([
        { tagName: 'INPUT', type: 'hidden', value: 'a', defaultValue: 'b' },
        { tagName: 'INPUT', type: 'submit', value: 'a', defaultValue: 'b' },
        { tagName: 'INPUT', type: 'text', disabled: true, value: 'a', defaultValue: 'b' },
        { tagName: 'BUTTON', value: 'a', defaultValue: 'b' },
      ]),
    ).toBe(false);
  });

  it('AutoSubmit rozdíl odešle jen po hydrataci, ne po vykreslení v prohlížeči', () => {
    // Po vykreslení v prohlížeči (přechod odkazem) pole teprve vznikla a není
    // co dohánět — a odeslání by tam při každém příchodu na stránku ukázalo
    // „Uloženo“. Rozlišuje to serverový snímek `useSyncExternalStore`.
    const source = readFileSync(
      join(import.meta.dirname, '..', 'components', 'ui', 'auto-submit.tsx'),
      'utf8',
    );
    expect(source).toContain('useSyncExternalStore');
    expect(source).toMatch(/hydratedFromServer\.current\s*&&\s*differsFromServerHtml\(/);
  });
});
