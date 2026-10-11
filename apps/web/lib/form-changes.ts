/**
 * Liší se formulář od toho, co přišlo v HTML ze serveru?
 *
 * Formulář s auto-save se odesílá skriptem — jenže stránka je vidět a dá se
 * ovládat dřív, než se skript načte. Kdo v té mezeře přepnul nabídku, viděl
 * novou volbu, ale nic se neuložilo a nic to neřeklo; po novém načtení byla
 * zpátky ta stará. Na pomalém připojení trvá mezera vteřiny. `AutoSubmit`
 * proto po hydrataci porovná pole s výchozím stavem z HTML a rozdíl odešle.
 *
 * Čistá funkce nad tím, co z pole potřebuje (ne nad DOM typy), aby šla
 * otestovat bez prohlížeče.
 */
export interface FormControlState {
  tagName: string;
  type?: string;
  disabled?: boolean;
  value?: string;
  defaultValue?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  options?: ArrayLike<{ selected: boolean; defaultSelected: boolean }>;
}

/** Typy `<input>`, které nenesou volbu uživatele (nebo ji prohlížeč nedovolí předvyplnit). */
const IGNORED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file']);

function controlChanged(control: FormControlState): boolean {
  if (control.disabled) return false;
  const tag = control.tagName.toLowerCase();
  if (tag === 'select') {
    const options = Array.from(control.options ?? []);
    // Nabídka bez výchozí položky v HTML: prohlížeč vybere první sám a od
    // „výchozí“ se liší, aniž kdo na cokoli sáhl — tu posoudit nejde.
    if (!options.some((option) => option.defaultSelected)) return false;
    return options.some((option) => option.selected !== option.defaultSelected);
  }
  if (tag === 'textarea') return control.value !== control.defaultValue;
  if (tag !== 'input') return false;
  const type = (control.type ?? 'text').toLowerCase();
  if (IGNORED_INPUT_TYPES.has(type)) return false;
  if (type === 'checkbox' || type === 'radio') return control.checked !== control.defaultChecked;
  return control.value !== control.defaultValue;
}

export function differsFromServerHtml(controls: Iterable<FormControlState>): boolean {
  for (const control of controls) {
    if (controlChanged(control)) return true;
  }
  return false;
}
