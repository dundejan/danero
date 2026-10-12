import type { EarlyInput } from '@/lib/early-input';

/**
 * Srovnání formuláře s HTML ze serveru po hydrataci.
 *
 * Formulář s auto-save se odesílá skriptem — jenže stránka je vidět a dá se
 * ovládat dřív, než se skript načte. Kdo v té mezeře přepnul nabídku, viděl
 * novou volbu, ale nic se neuložilo a nic to neřeklo; po novém načtení byla
 * zpátky ta stará. Na pomalém připojení trvá mezera vteřiny.
 *
 * První oprava (11. 10. 2026) po hydrataci odeslala KAŽDÝ rozdíl proti HTML
 * ze serveru. Jenže rozdíl nemusí pocházet od člověka: Firefox při F5 vrací
 * do polí hodnoty z doby před načtením — i do pole, na které nikdo nesáhl —
 * a totéž dělá návrat v historii. Změřeno ve Firefoxu: nastavení změněné na
 * jiném zařízení se po F5 v prvním panelu potichu přepsalo zpátky starou
 * hodnotou (nabídka, přepínač i zaškrtávací políčko, na obou stránkách
 * nastavení). U daňového nastavení je tichý přepis horší než původní chyba.
 *
 * Proto se rozdíl posuzuje pole po poli podle toho, co o něm víme
 * (`lib/early-input.ts`):
 * - člověk pole změnil a prohlížeč to ohlásil (`change`) → hodnota je jeho,
 *   formulář se odešle;
 * - člověk do pole píše a ještě ho neopustil → hodnota zůstane, odešle se až
 *   s `change`, které už uslyší `AutoSubmit`;
 * - o rozdílu nevíme nic → pole se vrátí na hodnotu ze serveru. Neuloží se
 *   nic a obrazovka ukazuje, co opravdu platí.
 *
 * Čisté funkce nad tím, co z pole potřebují (ne nad DOM typy), aby šly
 * otestovat bez prohlížeče.
 */
export interface FormControlState {
  tagName: string;
  type?: string;
  name?: string;
  disabled?: boolean;
  value?: string;
  defaultValue?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  options?: ArrayLike<{ selected: boolean; defaultSelected: boolean }>;
}

/** Typy `<input>`, které nenesou volbu uživatele (nebo ji prohlížeč nedovolí předvyplnit). */
const IGNORED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file']);

type ControlKind = 'select' | 'text' | 'toggle' | 'none';

function kindOf(control: FormControlState): ControlKind {
  if (control.disabled) return 'none';
  const tag = control.tagName.toLowerCase();
  if (tag === 'select') {
    // Nabídka bez výchozí položky v HTML: prohlížeč vybere první sám a od
    // „výchozí“ se liší, aniž kdo na cokoli sáhl — tu posoudit nejde.
    const hasDefault = Array.from(control.options ?? []).some((option) => option.defaultSelected);
    return hasDefault ? 'select' : 'none';
  }
  if (tag === 'textarea') return 'text';
  if (tag !== 'input') return 'none';
  const type = (control.type ?? 'text').toLowerCase();
  if (IGNORED_INPUT_TYPES.has(type)) return 'none';
  return type === 'checkbox' || type === 'radio' ? 'toggle' : 'text';
}

/** Liší se pole od toho, co přišlo v HTML ze serveru? */
export function differsFromServerHtml(control: FormControlState): boolean {
  switch (kindOf(control)) {
    case 'select':
      return Array.from(control.options ?? []).some(
        (option) => option.selected !== option.defaultSelected,
      );
    case 'toggle':
      return control.checked !== control.defaultChecked;
    case 'text':
      return control.value !== control.defaultValue;
    case 'none':
      return false;
  }
}

/** Vrátí pole na hodnotu z HTML ze serveru (bez událostí — nic se tím neodesílá). */
export function restoreServerHtml(control: FormControlState): void {
  switch (kindOf(control)) {
    case 'select': {
      const options = Array.from(control.options ?? []);
      // nejdřív vybrat výchozí, až pak odebrat ostatní: jinak by si nabídka
      // s jedinou volbou mezitím sama vybrala první položku
      for (const option of options) if (option.defaultSelected) option.selected = true;
      for (const option of options) if (!option.defaultSelected) option.selected = false;
      return;
    }
    case 'toggle':
      control.checked = control.defaultChecked;
      return;
    case 'text':
      control.value = control.defaultValue;
      return;
    case 'none':
  }
}

/**
 * Nastaví pole podle stavu formuláře, který právě odchází na server (bez
 * událostí — nic se tím neodesílá). Formulář vykreslený znovu, zatímco se
 * ukládá, dostal od serveru stav z doby před tím uložením: přepínač, který
 * člověk právě přepnul, by na chvíli skočil zpátky. Vrací textová pole, která
 * přepsal — jejich text je odeslaný, ne rozepsaný.
 */
export function applyFormValues<Control extends FormControlState>(
  controls: Iterable<Control>,
  values: { getAll(name: string): unknown[] },
): Control[] {
  const texts: Control[] = [];
  for (const control of controls) {
    const kind = kindOf(control);
    if (kind === 'none' || !control.name) continue;
    const sent = values
      .getAll(control.name)
      .filter((value): value is string => typeof value === 'string');
    if (kind === 'toggle') {
      control.checked = sent.includes(control.value ?? 'on');
      continue;
    }
    // nabídka a text nesou jednu hodnotu; pole, které v odeslání není, zůstává
    const [value] = sent;
    if (value === undefined || value === control.value) continue;
    control.value = value;
    if (kind === 'text') texts.push(control);
  }
  return texts;
}

/**
 * Co s formulářem po hydrataci: která pole vrátit na hodnotu ze serveru
 * a jestli formulář odeslat.
 *
 * Odesílá se CELÝ formulář, takže se před odesláním vracejí i pole, o jejichž
 * rozdílu nic nevíme — jinak by se s jednou změnou uživatele uložila i stará
 * hodnota, kterou do sousedního pole vrátil prohlížeč.
 */
export function reconcileWithServerHtml<Control extends FormControlState>(
  controls: Iterable<Control>,
  early: EarlyInput,
): { revert: Control[]; submit: boolean } {
  const all = Array.from(controls);
  const revert: Control[] = [];
  let submit = false;
  for (const control of all) {
    if (!differsFromServerHtml(control)) continue;
    const group = radioGroupOf(control, all);
    if (group.some((member) => early.committed.has(member))) submit = true;
    else if (!group.some((member) => early.edited.has(member))) revert.push(control);
  }
  return { revert, submit };
}

const isRadio = (control: FormControlState): boolean =>
  control.tagName.toLowerCase() === 'input' && control.type?.toLowerCase() === 'radio';

/**
 * Přepínací tlačítka téhož jména jsou jedna volba: klepnutí na jedno odškrtne
 * druhé, a to o sobě žádnou událost nedostane. Důkaz o změně proto platí pro
 * celou skupinu — jinak by se odškrtnuté tlačítko vrátilo na hodnotu ze
 * serveru a volbu uživatele tím zrušilo.
 */
function radioGroupOf<Control extends FormControlState>(control: Control, all: Control[]): Control[] {
  if (!isRadio(control) || !control.name) return [control];
  return all.filter((other) => isRadio(other) && other.name === control.name);
}
