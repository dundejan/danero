/**
 * Uložení formuláře, které zapíše jen to, co člověk v TOMHLE formuláři změnil.
 *
 * Nastavení se odesílá celé (auto-save i tlačítko Uložit). Formulář ale může
 * ukazovat starý stav — druhý panel, který zůstal otevřený, zatímco se jinde
 * měnilo. Změřeno 11. 10. 2026 na obou stránkách nastavení: v panelu 1 změna
 * párování, v panelu 2 (pořád ukazuje staré) změna kurzů → párování se
 * potichu vrátilo, protože panel 2 poslal i svoji starou hodnotu.
 *
 * Formulář proto nese ve skrytém poli stav, se kterým byl vykreslen, a server
 * zapíše jen pole, která se od něj liší — nad tím, co je v databázi právě
 * teď. Cizí změna jiného pole tak přežije, žádná chybová hláška není potřeba
 * a funguje to i bez JavaScriptu (skryté pole je v HTML ze serveru).
 *
 * Proč ne kontrola verze (`updatedAt`) s odmítnutím: auto-save odesílá každou
 * změnu zvlášť, takže dvě změny rychle po sobě by si verzi navzájem
 * zneplatnily a druhá by skončila chybou, kterou uživatel nezpůsobil. A i
 * oprávněné odmítnutí by po člověku chtělo obnovit stránku a změnu zopakovat,
 * přestože se s tou cizí vůbec nepotkala.
 *
 * Druhé skryté pole plní `AutoSubmit`: jméno pole, jehož změna odeslání
 * vyvolala. To se zapíše vždy. Bez něj by se ztratilo vrácení změny během
 * běžícího ukládání — přepínač zapnutý a hned vypnutý pošle podruhé totéž, co
 * stálo ve formuláři při vykreslení, a samotné srovnání by řeklo „beze změny“.
 * Jmen smí být víc: změny, které se sešly dřív, než odešlo předchozí uložení,
 * jdou jedním odesláním (`lib/save-queue.ts`).
 *
 * Čisté funkce bez DOM typů — sdílí je server (akce, stránka) i prohlížeč.
 */

/** Skryté pole se stavem, se kterým byl formulář vykreslen (`name` česky — pravidlo 1). */
export const BASELINE_FIELD = 'puvodni-stav';

/** Skryté pole se jmény polí, jejichž změna odeslání vyvolala (jen s auto-save). */
export const CHANGED_FIELD = 'zmenene-pole';

/**
 * Pořadí odeslání: `<označení formuláře>.<pořadové číslo>`. Přidává ho fronta
 * auto-save (`lib/save-queue.ts`), ne pole ve stránce.
 *
 * Odeslání téhož formuláře jdou za sebou — až na odchod ze stránky: co čeká,
 * jde hned a souběžně s tím, co ještě běží, a na server můžou dorazit
 * v opačném pořadí (revize R7, M3: přepnutí tam a zpět a zavření panelu skončilo
 * na starší volbě). Server si proto u řádku pamatuje poslední pořadí a starší
 * odeslání téhož formuláře už nezapíše.
 *
 * Zahodit starší odeslání smí jen proto, že to pozdější ho v sobě obsahuje —
 * a to neplyne ze stavu formuláře, který nese: server z něj zapíše jen pole
 * jmenovaná v `CHANGED_FIELD` a pole, která se liší od stavu při vykreslení,
 * takže změna vrácená na původní hodnotu by v něm nebyla. Fronta proto každému
 * odeslání přidává jména všech polí, jejichž změnu server ještě nepotvrdil
 * (revize R8, D1; `lib/save-queue.ts`).
 */
export const SUBMISSION_FIELD = 'poradi-odeslani';

/**
 * Označení účtu, kterému byl formulář vykreslen (`lib/owner-tag.ts`). Přidává
 * ho fronta auto-save a server podle něj odmítne odeslání, které dorazilo pod
 * přihlášením někoho jiného — formulář jednoho účtu nesmí zapsat do profilu
 * druhého (revize R8, M1).
 */
export const OWNER_FIELD = 'ucet-formulare';

/** Služební pole, která do stavu formuláře nepatří (React si k akci přidává vlastní). */
const isServiceField = (name: string): boolean =>
  name === BASELINE_FIELD ||
  name === CHANGED_FIELD ||
  name === SUBMISSION_FIELD ||
  name === OWNER_FIELD ||
  name.startsWith('$ACTION');

/** Pořadí odeslání: který formulář (panel) ho poslal a kolikáté to bylo. */
export interface SubmissionMark {
  instance: string;
  sequence: number;
}

/**
 * Pořadí odeslání z formuláře; `null`, když chybí nebo nemá správný tvar
 * (první uložení tlačítkem, požadavek mimo naše UI) — pak se ukládá bez něj.
 */
export function submissionMark(form: { get(name: string): unknown }): SubmissionMark | null {
  const raw = form.get(SUBMISSION_FIELD);
  if (typeof raw !== 'string') return null;
  const match = /^([A-Za-z0-9-]{1,64})\.([1-9][0-9]{0,8})$/.exec(raw);
  return match ? { instance: match[1]!, sequence: Number(match[2]) } : null;
}

/**
 * Stav formuláře jako text: dvojice jméno–hodnota tak, jak by je neupravený
 * formulář odeslal (nezaškrtnuté políčko v něm není vůbec).
 */
export function encodeBaseline(entries: Iterable<readonly [string, string]>): string {
  return new URLSearchParams(
    Array.from(entries, ([name, value]) => [name, value] as [string, string]),
  ).toString();
}

/** Co z odeslaného formuláře potřebujeme: přečíst hodnoty pole podle jména. */
interface FormValues {
  has(name: string): boolean;
  get(name: string): unknown;
  getAll(name: string): unknown[];
}

/** Hodnoty pole bez ohledu na pořadí (skupina zaškrtávacích políček). */
const valuesOf = (source: { getAll(name: string): unknown[] }, name: string): string[] =>
  source.getAll(name).map(String).sort();

const sameValues = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Která z polí `names` má server zapsat: ta, jejichž odeslaná hodnota se liší
 * od stavu při vykreslení, a ta, jejichž změna odeslání vyvolala.
 *
 * Formulář bez výchozího stavu (stránka vykreslená starší verzí aplikace,
 * požadavek mimo naše UI) se bere celý — tak se ukládalo vždycky.
 */
export function changedFields(form: FormValues, names: readonly string[]): Set<string> {
  if (!form.has(BASELINE_FIELD)) return new Set(names);
  const baseline = new URLSearchParams(String(form.get(BASELINE_FIELD)));
  const triggers = new Set(form.getAll(CHANGED_FIELD).map(String));
  return new Set(
    names.filter(
      (name) => triggers.has(name) || !sameValues(valuesOf(form, name), valuesOf(baseline, name)),
    ),
  );
}

/**
 * Stav, který formulář právě odesílá, ve stejném tvaru jako `encodeBaseline`
 * (bez souborů a služebních polí). Hlídač shody: u neupraveného formuláře se
 * musí rovnat tomu, co stránka zapsala do `BASELINE_FIELD`.
 */
export function submittedState(entries: Iterable<readonly [string, unknown]>): string {
  return encodeBaseline(
    Array.from(entries).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && !isServiceField(entry[0]),
    ),
  );
}

/** Vybere z `values` jen sloupce, jejichž pole formuláře se změnilo. */
export function pickChanged<Values extends Record<string, unknown>>(
  values: Values,
  fieldOf: { readonly [Column in keyof Values]: string },
  changed: ReadonlySet<string>,
): Partial<Values> {
  return Object.fromEntries(
    Object.entries(values).filter(([column]) => changed.has(fieldOf[column as keyof Values])),
  ) as Partial<Values>;
}
