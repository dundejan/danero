import { describe, expect, it } from 'vitest';
import {
  describeFocus,
  findFocusTarget,
  FOCUS_HANDOFF_TTL_MS,
  handoffApplies,
  type FocusableState,
  type FocusHandoff,
} from '@/lib/focus-handoff';

/**
 * Po každém auto-save v Nastavení se stránka vykreslí znovu a pole s fokusem
 * zanikne — klávesnice přišla o místo a mezerník zmáčknutý těsně po uložení
 * šel do prázdna. Zanikající formulář proto popíše, kde fokus byl, a nový ho
 * podle popisu najde. Tady je to hledání: najít TOTÉŽ pole, a když jistota
 * není, nevracet fokus nikam.
 */
const select = (id: string): FocusableState => ({ tagName: 'SELECT', id, name: id, value: 'A' });
const toggle = (id: string): FocusableState => ({
  tagName: 'INPUT',
  type: 'checkbox',
  id,
  name: id,
  value: 'on',
});
const chip = (name: string, value: string): FocusableState => ({
  tagName: 'INPUT',
  type: 'checkbox',
  id: '',
  name,
  value,
});
const infoButton = (id: string): FocusableState => ({ tagName: 'BUTTON', id, name: '' });
const text = (id: string, value: string, defaultValue: string): FocusableState => ({
  tagName: 'INPUT',
  type: 'text',
  id,
  name: id,
  value,
  defaultValue,
  selectionStart: value.length,
  selectionEnd: value.length,
});

/** Formulář tak, jak ho vykreslí stránka: pole proložená tlačítky vysvětlivek. */
const form = (buttonIds: [string, string] = ['r1', 'r2']): FocusableState[] => [
  select('frekvence'),
  infoButton(buttonIds[0]),
  toggle('nalehave'),
  infoButton(buttonIds[1]),
  chip('hranice', '60'),
  chip('hranice', '85'),
  chip('hranice', '100'),
  text('prijmy', '0', '0'),
];

describe('fokus po novém vykreslení formuláře', () => {
  it('nabídka a přepínač se najdou podle id', () => {
    const before = form();
    const after = form();
    for (const index of [0, 2]) {
      const target = findFocusTarget(describeFocus(before[index]!, before), after);
      expect(target).toBe(after[index]);
    }
  });

  it('políčko ze skupiny se najde podle jména a hodnoty, ne podle pořadí', () => {
    const before = form();
    // nové vykreslení má skupinu v jiném pořadí
    const after = [
      ...form().slice(0, 4),
      chip('hranice', '100'),
      chip('hranice', '60'),
      chip('hranice', '85'),
    ];
    const target = findFocusTarget(describeFocus(before[5]!, before), after);
    expect(target).toBe(after[6]);
    expect(target?.value).toBe('85');
  });

  it('tlačítko vysvětlivky s novým id se najde na stejném místě', () => {
    const before = form(['R-a', 'R-b']);
    const after = form(['r-1', 'r-2']);
    expect(findFocusTarget(describeFocus(before[3]!, before), after)).toBe(after[3]);
  });

  it('když na stejném místě stojí jiný druh prvku, fokus se nevrací nikam', () => {
    const before = form(['R-a', 'R-b']);
    // řádek přibyl: na místě tlačítka je teď pole
    const after = [select('nove'), ...form(['r-1', 'r-2'])];
    expect(findFocusTarget(describeFocus(before[1]!, before), after)).toBeNull();
  });

  it('pole, které po vykreslení chybí, fokus nedostane náhradou jiné', () => {
    const before = form();
    const after = form().filter((element) => element.id !== 'nalehave');
    expect(findFocusTarget(describeFocus(before[2]!, before), after)).toBeNull();
  });

  it('dvě pole téhož jména bez hodnoty, která by je rozlišila, znamenají „nevím“', () => {
    const before: FocusableState[] = [
      { tagName: 'INPUT', type: 'text', id: '', name: 'pole', value: 'a' },
    ];
    const after: FocusableState[] = [
      { tagName: 'INPUT', type: 'text', id: '', name: 'pole', value: 'a' },
      { tagName: 'INPUT', type: 'text', id: '', name: 'pole', value: 'b' },
    ];
    expect(findFocusTarget(describeFocus(before[0]!, before), after)).toBeNull();
  });
});

describe('rozepsaný text', () => {
  it('nese se jen text, který se liší od hodnoty ze serveru', () => {
    const untouched = text('prijmy', '0', '0');
    expect(describeFocus(untouched, [untouched]).draft).toBeNull();

    const typing = { ...text('prijmy', '125', '0'), selectionStart: 2, selectionEnd: 3 };
    expect(describeFocus(typing, [typing]).draft).toEqual({
      value: '125',
      selectionStart: 2,
      selectionEnd: 3,
    });
  });

  it('rozepsané heslo se nepředává', () => {
    const password = { ...text('heslo', 'tajne', ''), type: 'password' };
    expect(describeFocus(password, [password]).draft).toBeNull();
  });

  it('hodnota nabídky ani přepínače se nepředává nikdy — ta je vždy ze serveru', () => {
    const changedSelect = { ...select('frekvence'), value: 'B', defaultValue: 'A' };
    const changedToggle = { ...toggle('nalehave'), defaultValue: 'off' };
    for (const element of [changedSelect, changedToggle]) {
      expect(describeFocus(element, [element]).draft).toBeNull();
    }
  });
});

describe('platnost předávky', () => {
  const handoff = (pathname: string, at: number): FocusHandoff => {
    const element = select('frekvence');
    return { pathname, at, descriptor: describeFocus(element, [element]) };
  };

  it('platí pro tutéž stránku hned po zániku formuláře', () => {
    expect(handoffApplies(handoff('/nastaveni', 1000), '/nastaveni', 1000)).toBe(true);
    expect(
      handoffApplies(handoff('/nastaveni', 1000), '/nastaveni', 1000 + FOCUS_HANDOFF_TTL_MS),
    ).toBe(true);
  });

  it('formulář jiné stránky fokus nepřebírá', () => {
    expect(handoffApplies(handoff('/nastaveni', 1000), '/nastaveni/upozorneni', 1001)).toBe(false);
  });

  it('po chvíli už fokus nikam neskáče', () => {
    expect(
      handoffApplies(handoff('/nastaveni', 1000), '/nastaveni', 1001 + FOCUS_HANDOFF_TTL_MS),
    ).toBe(false);
    expect(handoffApplies(null, '/nastaveni', 1000)).toBe(false);
  });
});
