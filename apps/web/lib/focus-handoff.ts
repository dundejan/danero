/**
 * Fokus přes nové vykreslení formuláře s auto-save.
 *
 * Uložení nastavení končí přesměrováním s potvrzením v adrese a stránka se po
 * něm vykreslí celá znovu — pole, na kterém uživatel stál, zanikne a s ním
 * i fokus. Klávesnice tak po každé změně začínala od začátku stránky, a kdo
 * stihl přejít na další pole těsně před doběhem uložení, zmáčkl mezerník do
 * prázdna (změřeno 11. 10. 2026 v Chromiu i Firefoxu: změna druhého pole se
 * neprovedla vůbec).
 *
 * Zanikající formulář si proto zapamatuje, kde fokus byl, a nový ho tam
 * vrátí. Hodnot polí se to netýká — ty jsou vždy ze serveru — s jedinou
 * výjimkou: rozepsaný text, který uživatel ještě nepotvrdil (`change`
 * u textového pole přijde až s opuštěním pole). Bez něj by po návratu fokusu
 * psal dál do staré hodnoty.
 *
 * Čisté funkce nad tím, co z prvku potřebují (ne nad DOM typy), aby šly
 * otestovat bez prohlížeče — stejně jako `lib/form-changes.ts`.
 */

/** Co o prvku potřebujeme vědět, abychom ho po novém vykreslení našli. */
export interface FocusableState {
  tagName: string;
  id?: string;
  name?: string;
  type?: string;
  value?: string;
  defaultValue?: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
}

/** Popis místa, kde byl fokus. */
export interface FocusDescriptor {
  tagName: string;
  id: string;
  name: string;
  /** Hodnota jen u políček a přepínacích tlačítek — rozlišuje členy skupiny téhož jména. */
  memberValue: string | null;
  /** Pořadí mezi prvky formuláře, které fokus přijmou — poslední záchrana. */
  index: number;
  /** Rozepsaný a nepotvrzený text (textové pole, které se liší od hodnoty ze serveru). */
  draft: { value: string; selectionStart: number | null; selectionEnd: number | null } | null;
}

const tagOf = (element: FocusableState): string => element.tagName.toLowerCase();

const isGroupMember = (element: FocusableState): boolean =>
  tagOf(element) === 'input' && /^(checkbox|radio)$/i.test(element.type ?? '');

/**
 * Typy `<input>`, do kterých se píše — jen u nich má smysl nést rozepsaný text.
 * Heslo mezi nimi schválně není: rozepsané heslo se nikam neodkládá.
 */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'tel', 'url', 'email', 'number']);

/** Pole, do kterého se píše (a jehož změnu prohlížeč ohlásí až s opuštěním pole). */
export const isTextEntry = (element: FocusableState): boolean =>
  tagOf(element) === 'textarea' ||
  (tagOf(element) === 'input' && TEXT_INPUT_TYPES.has((element.type ?? 'text').toLowerCase()));

/**
 * Popis prvku s fokusem; `focusables` jsou všechny prvky formuláře, které fokus
 * přijmou. `confirmedValue` je hodnota, kterou pole už odeslalo k uložení —
 * rozepsaný je jen text, který se liší od ní (výchozí je hodnota ze serveru).
 */
export function describeFocus<Element extends FocusableState>(
  element: Element,
  focusables: readonly Element[],
  confirmedValue: string = element.defaultValue ?? '',
): FocusDescriptor {
  const editing =
    isTextEntry(element) && typeof element.value === 'string' && element.value !== confirmedValue;
  return {
    tagName: tagOf(element),
    id: element.id ?? '',
    name: element.name ?? '',
    memberValue: isGroupMember(element) ? (element.value ?? '') : null,
    index: focusables.indexOf(element),
    draft: editing
      ? {
          value: element.value ?? '',
          selectionStart: element.selectionStart ?? null,
          selectionEnd: element.selectionEnd ?? null,
        }
      : null,
  };
}

/**
 * Tentýž prvek v nově vykresleném formuláři: podle `id`, jinak podle jména
 * (u skupiny políček i hodnoty), jinak podle pořadí — a vždy jen prvek téhož
 * druhu. Když si nejsme jistí, fokus se nevrací nikam (`null`): špatně
 * vrácený fokus je horší než žádný.
 */
export function findFocusTarget<Element extends FocusableState>(
  descriptor: FocusDescriptor,
  focusables: readonly Element[],
): Element | null {
  const sameKind = focusables.filter((element) => tagOf(element) === descriptor.tagName);
  if (descriptor.id) {
    const byId = sameKind.find((element) => element.id === descriptor.id);
    if (byId) return byId;
  }
  if (descriptor.name) {
    const byName = sameKind.filter(
      (element) =>
        element.name === descriptor.name &&
        (descriptor.memberValue === null || element.value === descriptor.memberValue),
    );
    if (byName.length === 1) return byName[0]!;
    // jméno neurčilo prvek jednoznačně — pořadí by mohlo trefit jiné pole
    if (byName.length > 1) return null;
  }
  // prvek bez jména (tlačítko vysvětlivky) nebo s `id`, které se s novým
  // vykreslením změnilo: totéž místo v témže formuláři, je-li tam totéž
  const byIndex = focusables[descriptor.index];
  return byIndex &&
    tagOf(byIndex) === descriptor.tagName &&
    (byIndex.name ?? '') === descriptor.name
    ? byIndex
    : null;
}

/** Jak dlouho po zániku formuláře smí nový fokus převzít (ms). */
export const FOCUS_HANDOFF_TTL_MS = 1000;

/** Předávka mezi zanikajícím a novým formulářem. */
export interface FocusHandoff {
  /** Cesta stránky — fokus se nevrací do formuláře jiné stránky. */
  pathname: string;
  descriptor: FocusDescriptor;
  at: number;
}

/** Platí předávka pro formulář na téhle stránce a v tuhle chvíli? */
export function handoffApplies(
  handoff: FocusHandoff | null,
  pathname: string,
  now: number,
): handoff is FocusHandoff {
  return (
    handoff !== null &&
    handoff.pathname === pathname &&
    now - handoff.at >= 0 &&
    now - handoff.at <= FOCUS_HANDOFF_TTL_MS
  );
}
