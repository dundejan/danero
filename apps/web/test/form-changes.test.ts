import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EarlyInput } from '@/lib/early-input';
import {
  applyFormValues,
  differsFromServerHtml,
  reconcileWithServerHtml,
  restoreServerHtml,
  type FormControlState,
} from '@/lib/form-changes';

/**
 * Změna v Nastavení provedená dřív, než se stránka hydratovala, se neuložila
 * a nic to neřeklo. První oprava po hydrataci odeslala každý rozdíl proti
 * HTML ze serveru — a tím i hodnotu, kterou do pole po F5 vrátil prohlížeč:
 * nastavení změněné na jiném zařízení se ve Firefoxu potichu přepsalo zpátky.
 * Tady je rozhodování pole po poli: odeslat jen to, co prokazatelně změnil
 * člověk, všechno ostatní vrátit na hodnotu ze serveru.
 */
const option = (selected: boolean, defaultSelected: boolean) => ({ selected, defaultSelected });

const select = (...options: Array<ReturnType<typeof option>>): FormControlState => ({
  tagName: 'SELECT',
  options,
});

const text = (value: string, defaultValue: string): FormControlState => ({
  tagName: 'INPUT',
  type: 'text',
  value,
  defaultValue,
});

const checkbox = (checked: boolean, defaultChecked: boolean): FormControlState => ({
  tagName: 'INPUT',
  type: 'checkbox',
  checked,
  defaultChecked,
});

const radio = (name: string, checked: boolean, defaultChecked: boolean): FormControlState => ({
  tagName: 'INPUT',
  type: 'radio',
  name,
  checked,
  defaultChecked,
});

/** Záznam vstupu před hydratací: která pole člověk upravil a která už ohlásila `change`. */
const early = ({
  edited = [],
  committed = [],
}: { edited?: object[]; committed?: object[] } = {}): EarlyInput => ({
  edited: new Set([...edited, ...committed]),
  committed: new Set(committed),
});

describe('rozdíl pole proti HTML ze serveru', () => {
  it('nedotčená pole se neliší', () => {
    for (const control of [
      select(option(true, true), option(false, false)),
      text('0', '0'),
      checkbox(false, false),
      { tagName: 'TEXTAREA', value: '', defaultValue: '' },
    ]) {
      expect(differsFromServerHtml(control)).toBe(false);
    }
  });

  it('pozná přepnutou nabídku, přepsané pole i přepnutý přepínač', () => {
    expect(differsFromServerHtml(select(option(false, true), option(true, false)))).toBe(true);
    expect(differsFromServerHtml(text('10 000', '0'))).toBe(true);
    expect(differsFromServerHtml(checkbox(true, false))).toBe(true);
    expect(differsFromServerHtml({ tagName: 'TEXTAREA', value: 'x', defaultValue: '' })).toBe(true);
  });

  it('nabídka bez výchozí položky v HTML se neposuzuje — první vybere prohlížeč sám', () => {
    expect(differsFromServerHtml(select(option(true, false), option(false, false)))).toBe(false);
  });

  it('skrytá, zakázaná a odesílací pole změnu nenesou', () => {
    for (const control of [
      { tagName: 'INPUT', type: 'hidden', value: 'a', defaultValue: 'b' },
      { tagName: 'INPUT', type: 'submit', value: 'a', defaultValue: 'b' },
      { tagName: 'INPUT', type: 'text', disabled: true, value: 'a', defaultValue: 'b' },
      { tagName: 'BUTTON', value: 'a', defaultValue: 'b' },
    ]) {
      expect(differsFromServerHtml(control)).toBe(false);
    }
  });
});

describe('návrat pole na hodnotu ze serveru', () => {
  it('nabídka, textové pole i přepínač se vrátí na to, co přišlo v HTML', () => {
    const matching = select(option(false, true), option(true, false), option(false, false));
    const income = text('987', '0');
    const assets = checkbox(true, false);
    for (const control of [matching, income, assets]) {
      restoreServerHtml(control);
      expect(differsFromServerHtml(control)).toBe(false);
    }
    expect(Array.from(matching.options ?? []).map((item) => item.selected)).toEqual([
      true,
      false,
      false,
    ]);
    expect(income.value).toBe('0');
    expect(assets.checked).toBe(false);
  });

  it('polí, která se neposuzují, se nedotkne', () => {
    const hidden = { tagName: 'INPUT', type: 'hidden', value: 'a', defaultValue: 'b' };
    const withoutDefault = select(option(false, false), option(true, false));
    restoreServerHtml(hidden);
    restoreServerHtml(withoutDefault);
    expect(hidden.value).toBe('a');
    expect(Array.from(withoutDefault.options ?? []).map((item) => item.selected)).toEqual([
      false,
      true,
    ]);
  });
});

describe('formulář vykreslený znovu uprostřed ukládání', () => {
  /** Stav formuláře, jak odchází na server. */
  const sent = (entries: Array<[string, string]>) => {
    const data = new FormData();
    for (const [name, value] of entries) data.append(name, value);
    return data;
  };

  it('pole dostanou, co právě odchází — změna neskočí zpátky na stav ze serveru', () => {
    const matching = { ...select(option(true, true), option(false, false)), name: 'parovani', value: 'FIFO' };
    const urgent = { ...checkbox(true, true), name: 'nalehave', value: 'on' };
    const quiet = { ...checkbox(false, false), name: 'tiche', value: 'on' };
    const income = { ...text('0', '0'), name: 'prijmy' };
    const texts = applyFormValues(
      [matching, urgent, quiet, income],
      sent([
        ['parovani', 'LIFO'],
        ['tiche', 'on'],
        ['prijmy', '500'],
      ]),
    );
    expect(matching.value).toBe('LIFO');
    // odškrtnutý přepínač v odeslání chybí
    expect(urgent.checked).toBe(false);
    expect(quiet.checked).toBe(true);
    expect(income.value).toBe('500');
    // přepsaný text je odeslaný, ne rozepsaný
    expect(texts).toEqual([income]);
  });

  /**
   * Odeslání nese celý formulář. Panel se starým stavem by polem, na které
   * uživatel nesáhl, přepsal hodnotu, kterou nový formulář právě dostal ze
   * serveru (změna udělaná jinde) — a další změna by tu starou zapsala.
   */
  it('přebírá jen pole, která volající označí za změněná uživatelem', () => {
    const matching = { ...select(option(true, true), option(false, false)), name: 'parovani', value: 'LIFO' };
    const rates = { ...select(option(true, true), option(false, false)), name: 'kurzy', value: 'UNIFIED' };
    const income = { ...text('900', '900'), name: 'prijmy' };
    const texts = applyFormValues(
      [matching, rates, income],
      sent([
        ['parovani', 'FIFO'], // stará hodnota z panelu, který o změně jinde neví
        ['kurzy', 'CNB_DAILY'], // tohle uživatel změnil
        ['prijmy', '0'],
      ]),
      (name) => name === 'kurzy',
    );
    expect(matching.value).toBe('LIFO');
    expect(rates.value).toBe('CNB_DAILY');
    expect(income.value).toBe('900');
    expect(texts).toEqual([]);
  });

  it('skupina políček se řídí hodnotami, ne jménem', () => {
    const box = (value: string, checked: boolean) => ({
      ...checkbox(checked, checked),
      name: 'hranice',
      value,
    });
    const boxes = [box('50', false), box('75', true), box('100', true)];
    applyFormValues(
      boxes,
      sent([
        ['hranice', '50'],
        ['hranice', '100'],
      ]),
    );
    expect(boxes.map((item) => item.checked)).toEqual([true, false, true]);
  });

  it('pole, které v odeslání není, ani pole bez jména nemění', () => {
    const income = { ...text('7', '7'), name: 'prijmy' };
    const nameless = text('x', 'x');
    const kept = { ...select(option(true, true)), name: 'kurzy', value: 'UNIFIED' };
    expect(applyFormValues([income, nameless, kept], sent([['prijmy', '7']]))).toEqual([]);
    expect(income.value).toBe('7');
    expect(nameless.value).toBe('x');
    expect(kept.value).toBe('UNIFIED');
  });
});

describe('formulář po hydrataci', () => {
  it('nedotčený formulář se neodesílá a nic se nevrací', () => {
    const controls = [select(option(true, true), option(false, false)), text('0', '0')];
    expect(reconcileWithServerHtml(controls, early())).toEqual({ revert: [], submit: false });
  });

  it('hodnota, kterou do pole vrátil prohlížeč, se NEODEŠLE a pole se vrátí na stav ze serveru', () => {
    // F5 ve Firefoxu po změně na jiném zařízení: server posílá LIFO, prohlížeč
    // do nabídky vrátil FIFO; o rozdílu nevíme nic — člověk na pole nesáhl
    const matching = select(option(true, false), option(false, true));
    const assets = checkbox(true, false);
    const income = text('1234', '0');
    const result = reconcileWithServerHtml([matching, assets, income], early());

    expect(result.submit).toBe(false);
    expect(result.revert).toEqual([matching, assets, income]);
  });

  it('pole, které člověk před hydratací změnil, se odešle', () => {
    const matching = select(option(false, true), option(true, false));
    const result = reconcileWithServerHtml([matching], early({ committed: [matching] }));

    expect(result).toEqual({ revert: [], submit: true });
  });

  it('se změnou člověka se neodešle stará hodnota, kterou do sousedního pole vrátil prohlížeč', () => {
    const changedByUser = checkbox(true, false);
    const restoredByBrowser = select(option(true, false), option(false, true));
    const result = reconcileWithServerHtml(
      [changedByUser, restoredByBrowser],
      early({ committed: [changedByUser] }),
    );

    expect(result.submit).toBe(true);
    expect(result.revert).toEqual([restoredByBrowser]);
  });

  it('rozepsané pole zůstane, jak je, a zatím se neodešle — `change` přijde s opuštěním pole', () => {
    const income = text('12', '0');
    const result = reconcileWithServerHtml([income], early({ edited: [income] }));

    expect(result).toEqual({ revert: [], submit: false });
  });

  it('důkaz o změně, která se od serveru neliší, nic neodešle', () => {
    // člověk přepnul tam a zpátky — není co ukládat
    const assets = checkbox(false, false);
    expect(reconcileWithServerHtml([assets], early({ committed: [assets] }))).toEqual({
      revert: [],
      submit: false,
    });
  });

  it('přepínací tlačítka téhož jména jsou jedna volba — odškrtnuté se nevrací', () => {
    // člověk klepl na druhé tlačítko; první se odškrtlo samo a událost nedostalo
    const first = radio('kurzy', false, true);
    const second = radio('kurzy', true, false);
    const other = radio('jine', true, false);
    const result = reconcileWithServerHtml([first, second, other], early({ committed: [second] }));

    expect(result.submit).toBe(true);
    expect(result.revert).toEqual([other]);
  });
});

describe('formuláře s auto-save', () => {
  /** Všechny soubory `.tsx` pod adresářem. */
  const sources = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.tsx'))
      .map((entry) => join(entry.parentPath, entry.name));

  it('každý formulář s <AutoSubmit> zakazuje prohlížeči vracet do polí staré hodnoty', () => {
    // Bez `autoComplete="off"` Firefox po F5 vrátí do nabídek a přepínačů
    // hodnoty z doby před načtením. `AutoSubmit` je sice neodešle, ale do
    // hydratace jsou vidět.
    const root = join(import.meta.dirname, '..');
    const withAutoSubmit = [...sources(join(root, 'app')), ...sources(join(root, 'components'))]
      .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
      .filter(({ source }) => /<AutoSubmit\b/.test(source));

    expect(withAutoSubmit.length).toBeGreaterThan(0);
    for (const { path, source } of withAutoSubmit) {
      const forms = source.match(/<form\b[^>]*>/g) ?? [];
      const autoSaveForms = forms.filter((tag) => /autoComplete=/.test(tag));
      expect(autoSaveForms.length, path).toBeGreaterThan(0);
    }
  });
});
