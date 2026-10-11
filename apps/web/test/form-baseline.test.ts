import { describe, expect, it } from 'vitest';
import {
  BASELINE_FIELD,
  changedFields,
  encodeBaseline,
  pickChanged,
  submittedState,
  CHANGED_FIELD,
} from '@/lib/form-baseline';

/**
 * Které pole formuláře člověk změnil: rozdíl proti stavu, se kterým byl
 * formulář vykreslen. Server podle toho zapisuje jen změněná pole, takže
 * panel se starým stavem nepřepíše, co se mezitím uložilo jinde.
 */
const NAMES = ['parovani', 'kurzy', 'majetek', 'hranice'] as const;

const RENDERED: Array<[string, string]> = [
  ['parovani', 'FIFO'],
  ['kurzy', 'UNIFIED'],
  ['hranice', '60'],
  ['hranice', '85'],
];

function form(
  entries: Array<[string, string]>,
  { baseline = RENDERED, changed }: { baseline?: Array<[string, string]> | null; changed?: string } = {},
): FormData {
  const data = new FormData();
  if (baseline) data.append(BASELINE_FIELD, encodeBaseline(baseline));
  if (changed !== undefined) data.append(CHANGED_FIELD, changed);
  for (const [name, value] of entries) data.append(name, value);
  return data;
}

describe('změněná pole formuláře', () => {
  it('neupravený formulář nemění nic', () => {
    expect([...changedFields(form(RENDERED), NAMES)]).toEqual([]);
  });

  it('pozná přepsanou hodnotu, zaškrtnuté i odškrtnuté pole', () => {
    expect([
      ...changedFields(
        form([
          ['parovani', 'LIFO'],
          ['kurzy', 'UNIFIED'],
          ['majetek', 'on'],
          ['hranice', '60'],
          ['hranice', '85'],
        ]),
        NAMES,
      ),
    ]).toEqual(['parovani', 'majetek']);

    // zaškrtnuté políčko, které ve formuláři po odškrtnutí chybí
    const withSwitch: Array<[string, string]> = [...RENDERED, ['majetek', 'on']];
    expect([...changedFields(form(RENDERED, { baseline: withSwitch }), NAMES)]).toEqual(['majetek']);
  });

  it('skupina políček je jedno pole a na pořadí nezáleží', () => {
    const reordered: Array<[string, string]> = [
      ['hranice', '85'],
      ['hranice', '60'],
      ['kurzy', 'UNIFIED'],
      ['parovani', 'FIFO'],
    ];
    expect([...changedFields(form(reordered), NAMES)]).toEqual([]);
    expect([...changedFields(form([...reordered, ['hranice', '100']]), NAMES)]).toEqual(['hranice']);
    expect([...changedFields(form(reordered.slice(1)), NAMES)]).toEqual(['hranice']);
  });

  it('pole, jehož změna odeslání vyvolala, se zapíše, i když se od vykresleného stavu neliší', () => {
    expect([...changedFields(form(RENDERED, { changed: 'kurzy' }), NAMES)]).toEqual(['kurzy']);
    // jméno, které formulář nezná, nic nepřidá
    expect([...changedFields(form(RENDERED, { changed: 'cizi' }), NAMES)]).toEqual([]);
    expect([...changedFields(form(RENDERED, { changed: '' }), NAMES)]).toEqual([]);
  });

  it('formulář bez výchozího stavu se bere celý', () => {
    expect([...changedFields(form(RENDERED, { baseline: null }), NAMES)]).toEqual([...NAMES]);
  });

  it('prázdný výchozí stav je platný: nic nebylo zaškrtnuté', () => {
    const data = new FormData();
    data.append(BASELINE_FIELD, '');
    data.append('majetek', 'on');
    expect([...changedFields(data, NAMES)]).toEqual(['majetek']);
  });

  it('hodnoty se zvláštními znaky projdou zakódováním beze změny', () => {
    const tricky: Array<[string, string]> = [
      ['parovani', 'a&b=c d+e'],
      ['kurzy', 'ČNB, denní'],
    ];
    expect([...changedFields(form(tricky, { baseline: tricky }), NAMES)]).toEqual([]);
  });
});

describe('stav odesílaného formuláře', () => {
  it('neupravený formulář odešle přesně to, co nese výchozí stav', () => {
    const data = form(RENDERED, { changed: '' });
    data.append('$ACTION_ID_abc', '');
    data.append('soubor', new File(['x'], 'vypis.csv'));
    expect(submittedState(data.entries())).toBe(String(data.get(BASELINE_FIELD)));
  });
});

describe('výběr sloupců k zápisu', () => {
  it('nechá jen sloupce, jejichž pole se změnilo', () => {
    const values = { matchingMethod: 'LIFO', fxMethod: 'UNIFIED', hasBusinessAssets: false };
    const fieldOf = { matchingMethod: 'parovani', fxMethod: 'kurzy', hasBusinessAssets: 'majetek' };
    expect(pickChanged(values, fieldOf, new Set(['parovani', 'majetek']))).toEqual({
      matchingMethod: 'LIFO',
      hasBusinessAssets: false,
    });
    expect(pickChanged(values, fieldOf, new Set())).toEqual({});
  });
});
