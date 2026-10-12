/**
 * Na co uživatel sáhl DŘÍV, než se stránka hydratovala.
 *
 * Formulář s auto-save (`AutoSubmit`) odesílá skript, jenže stránka je vidět
 * a dá se ovládat dřív, než se načte. Změna provedená v té mezeře vyšle
 * `change` do prázdna. Po hydrataci je proto potřeba poznat, která pole změnil
 * ČLOVĚK — samotný rozdíl proti HTML ze serveru to neříká: stejně vypadá pole,
 * do kterého prohlížeč po F5 nebo návratu v historii vrátil starou hodnotu
 * (Firefox to dělá i u pole, na které nikdo nesáhl), obnovený zavřený panel
 * i vyplnění rozšířením. Odeslat takový rozdíl znamená potichu přepsat
 * nastavení hodnotou, kterou nikdo nezadal.
 *
 * Důkaz sbírá krátký skript vložený do stránky před veškerý obsah
 * (`app/layout.tsx`): pamatuje si pole, na kterých proběhla DŮVĚRYHODNÁ
 * událost `input` nebo `change` (`isTrusted` — ne vyslaná skriptem), a to až
 * poté, co člověk na stránku opravdu sáhl (ukazatel, dotek, klávesa).
 * Obnovení formuláře prohlížečem žádnou z těch událostí nevyvolá; obnovení
 * relace ve Firefoxu sice vyšle `input`, ale bez doteku člověka.
 *
 * CSP aplikace (`next.config.ts`) vložené skripty dovoluje — nonce nemá.
 */

/** Jméno vlastnosti `window`, pod kterou skript záznam nechává. */
export const EARLY_INPUT_KEY = '__daneroEarlyInput';

/** Záznam o polích, na která uživatel sáhl před hydratací. */
export interface EarlyInput {
  /** Pole, do kterých člověk psal nebo je přepnul — jejich hodnota je jeho. */
  edited: { has(control: object): boolean };
  /** Pole, u kterých prohlížeč změnu už ohlásil (`change`) — čekají na uložení. */
  committed: { has(control: object): boolean };
}

/**
 * Skript jako text, ne funkce převedená přes `toString()`: do stránky musí
 * přijít stejný v každém sestavení a nesmí záviset na tom, co s tělem funkce
 * udělá překladač. Posluchače jsou ve fázi zachytávání, takže je kód stránky
 * nemůže předběhnout zastavením události.
 *
 * Poslední posluchač drží formulář s auto-save na stránce: ten se neodesílá
 * prohlížečem nikdy (ukládá ho skript, pozná se podle skrytého pole
 * `CHANGED_FIELD`). Enter v textovém poli zmáčknutý před hydratací by ho jinak
 * odeslal jako obyčejný formulář a stránka by se načetla znovu s jeho poli
 * v adrese. Změnu, kterou Enter potvrdil, si skript zapamatoval o řádek výš
 * a `AutoSubmit` ji po hydrataci uloží.
 *
 * Celý text je jediná neměnná konstanta bez interpolace: do stránky jde jako
 * surové HTML a `JSON.stringify` neescapuje `</script>` ani U+2028, takže
 * skládat ho z hodnot by znamenalo ručit za každou z nich. Jméno vlastnosti
 * (`EARLY_INPUT_KEY`) i skrytého pole (`CHANGED_FIELD` z `lib/form-baseline`)
 * jsou proto na konci zapsané doslova; že se s konstantami nerozešly, hlídá
 * `test/early-input.test.ts`.
 */
export const EARLY_INPUT_SCRIPT = `(function(d,w,k,s){if(w[k])return;var g=false,e=new WeakSet(),c=new WeakSet();w[k]={edited:e,committed:c};function t(v){if(v.isTrusted)g=true}["pointerdown","mousedown","touchstart","keydown","click"].forEach(function(n){d.addEventListener(n,t,true)});d.addEventListener("input",function(v){if(v.isTrusted&&g&&v.target)e.add(v.target)},true);d.addEventListener("change",function(v){if(v.isTrusted&&g&&v.target){e.add(v.target);c.add(v.target)}},true);d.addEventListener("submit",function(v){var f=v.target;if(f&&f.elements&&f.elements[s])v.preventDefault()},true)})(document,window,"__daneroEarlyInput","zmenene-pole")`;

const NOTHING_RECORDED: EarlyInput = {
  edited: { has: () => false },
  committed: { has: () => false },
};

const isRecord = (value: unknown): value is { has(control: object): boolean } =>
  typeof value === 'object' && value !== null && typeof (value as { has?: unknown }).has === 'function';

/**
 * Záznam, který skript nechal na `window`. Když chybí (skript se nevložil,
 * někdo vlastnost přepsal), platí, že člověk na nic nesáhl — bezpečná strana:
 * nic se samo neodešle.
 */
export function readEarlyInput(scope: object): EarlyInput {
  const record = (scope as Record<string, unknown>)[EARLY_INPUT_KEY] as
    | Partial<EarlyInput>
    | undefined;
  if (!record || !isRecord(record.edited) || !isRecord(record.committed)) return NOTHING_RECORDED;
  return { edited: record.edited, committed: record.committed };
}
