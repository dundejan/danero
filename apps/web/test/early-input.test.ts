import { describe, expect, it } from 'vitest';
import { EARLY_INPUT_KEY, EARLY_INPUT_SCRIPT, readEarlyInput } from '@/lib/early-input';
import { CHANGED_FIELD } from '@/lib/form-baseline';

/**
 * Skript, který si před hydratací pamatuje, na která pole sáhl člověk.
 * `AutoSubmit` podle něj po hydrataci pozná změnu uživatele od hodnoty, kterou
 * do pole vrátil prohlížeč (F5 ve Firefoxu, návrat v historii, obnovený
 * panel) — tu odeslat nesmí, přepsala by nastavení potichu.
 *
 * Skript se tu spouští tak, jak přijde do stránky (jako text), nad
 * napodobeným dokumentem.
 */
type Listener = (event: { isTrusted: boolean; target?: object }) => void;

function runScript(scope: Record<string, unknown> = {}) {
  const listeners = new Map<string, { listener: Listener; capture: unknown }[]>();
  const document = {
    addEventListener(type: string, listener: Listener, capture: unknown) {
      listeners.set(type, [...(listeners.get(type) ?? []), { listener, capture }]);
    },
  };
  // tělo je konstanta z našeho modulu — přesně ten text, který jde do stránky
  new Function('document', 'window', EARLY_INPUT_SCRIPT)(document, scope);
  return {
    listeners,
    fire(type: string, event: { isTrusted: boolean; target?: object }) {
      for (const { listener } of listeners.get(type) ?? []) listener(event);
    },
    early: () => readEarlyInput(scope),
  };
}

describe('záznam vstupu před hydratací', () => {
  it('změnu po skutečném doteku člověka si zapamatuje jako jeho', () => {
    const page = runScript();
    const select = {};
    page.fire('pointerdown', { isTrusted: true });
    page.fire('input', { isTrusted: true, target: select });
    page.fire('change', { isTrusted: true, target: select });

    expect(page.early().edited.has(select)).toBe(true);
    expect(page.early().committed.has(select)).toBe(true);
  });

  it('rozepsané pole je upravené, ale ještě neohlášené — `change` přijde až s opuštěním', () => {
    const page = runScript();
    const input = {};
    page.fire('keydown', { isTrusted: true });
    page.fire('input', { isTrusted: true, target: input });

    expect(page.early().edited.has(input)).toBe(true);
    expect(page.early().committed.has(input)).toBe(false);
  });

  it('událost vyslanou skriptem (rozšíření, automat) za vstup člověka nepočítá', () => {
    const page = runScript();
    const select = {};
    page.fire('pointerdown', { isTrusted: true });
    page.fire('input', { isTrusted: false, target: select });
    page.fire('change', { isTrusted: false, target: select });

    expect(page.early().edited.has(select)).toBe(false);
    expect(page.early().committed.has(select)).toBe(false);
  });

  it('bez doteku člověka nepočítá ani důvěryhodnou událost — obnovení relace vysílá `input` samo', () => {
    const page = runScript();
    const input = {};
    page.fire('input', { isTrusted: true, target: input });
    page.fire('change', { isTrusted: true, target: input });
    // dotek vyslaný skriptem stránku neodemkne
    page.fire('click', { isTrusted: false });
    page.fire('change', { isTrusted: true, target: input });

    expect(page.early().edited.has(input)).toBe(false);
    expect(page.early().committed.has(input)).toBe(false);
  });

  it('dotekem je ukazatel, dotyk, klávesa i klepnutí (čtečka aktivuje prvek klepnutím)', () => {
    for (const gesture of ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'click']) {
      const page = runScript();
      const control = {};
      page.fire(gesture, { isTrusted: true });
      page.fire('change', { isTrusted: true, target: control });
      expect(page.early().committed.has(control), gesture).toBe(true);
    }
  });

  it('poslouchá ve fázi zachytávání, aby ho kód stránky nepředběhl zastavením události', () => {
    const { listeners } = runScript();
    const registered = [...listeners.values()].flat();
    expect(registered.length).toBeGreaterThan(0);
    expect(registered.every(({ capture }) => capture === true)).toBe(true);
  });

  it('vložený podruhé záznam nepřepíše', () => {
    const scope: Record<string, unknown> = {};
    const first = runScript(scope);
    const control = {};
    first.fire('keydown', { isTrusted: true });
    first.fire('change', { isTrusted: true, target: control });
    runScript(scope);

    expect(readEarlyInput(scope).committed.has(control)).toBe(true);
  });

  it('bez záznamu platí, že člověk na nic nesáhl', () => {
    const control = {};
    for (const scope of [{}, { [EARLY_INPUT_KEY]: 'cokoli' }, { [EARLY_INPUT_KEY]: { edited: 1 } }]) {
      const early = readEarlyInput(scope);
      expect(early.edited.has(control)).toBe(false);
      expect(early.committed.has(control)).toBe(false);
    }
  });

  it('formulář s auto-save prohlížeči odeslat nedovolí, jiné formuláře nechává být', () => {
    const page = runScript();
    const prevented: string[] = [];
    const submit = (name: string, elements: Record<string, unknown>) =>
      page.fire('submit', {
        isTrusted: true,
        target: { elements },
        preventDefault: () => prevented.push(name),
      } as never);
    // Enter v textovém poli před hydratací: změnu si skript zapamatoval,
    // odeslání prohlížečem by stránku načetlo znovu s poli v adrese
    submit('auto-save', { [CHANGED_FIELD]: {} });
    submit('přihlášení', { email: {} });
    expect(prevented).toEqual(['auto-save']);
  });

  it('skript nenese nic, co by ukončilo značku <script> nebo potřebovalo překlad', () => {
    expect(EARLY_INPUT_SCRIPT).not.toContain('<');
    expect(EARLY_INPUT_SCRIPT).not.toMatch(/=>|\bconst\b|\blet\b/);
  });
});
