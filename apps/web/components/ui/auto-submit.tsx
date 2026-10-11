'use client';

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { readEarlyInput } from '@/lib/early-input';
import {
  describeFocus,
  findFocusTarget,
  handoffApplies,
  type FocusDescriptor,
  type FocusHandoff,
} from '@/lib/focus-handoff';
import { CHANGED_FIELD } from '@/lib/form-baseline';
import {
  reconcileWithServerHtml,
  restoreServerHtml,
  type FormControlState,
} from '@/lib/form-changes';

const subscribeToNothing = (): (() => void) => () => {};

/**
 * Kde byl fokus ve formuláři, který právě zanikl (`lib/focus-handoff.ts`).
 * Proměnná modulu, ne stav komponenty: uložení stránku vykreslí celou znovu
 * a stav komponenty s ní zanikne — modul zůstává.
 */
let focusHandoff: FocusHandoff | null = null;

/** Prvky formuláře, které přijmou fokus — pole i tlačítka vysvětlivek mezi nimi. */
const FOCUSABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

const focusablesOf = (form: HTMLFormElement): HTMLElement[] =>
  Array.from(form.querySelectorAll<HTMLElement>(FOCUSABLE));

const fieldOf = (element: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null =>
  element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element : null;

/**
 * Vrátí do pole text, který uživatel psal, když formulář zanikl, a pohlídá,
 * aby se uložil. Prohlížeč ohlásí `change` jen u textu, který se změnil psaním
 * — hodnotu vrácenou skriptem neohlásí, takže kdo by pole opustil bez dalšího
 * úhozu, viděl by text, který se nikdy neodeslal. Opuštění pole bez `change`
 * proto odešle formulář samo.
 */
function resumeDraft(
  field: HTMLInputElement | HTMLTextAreaElement,
  draft: NonNullable<FocusDescriptor['draft']>,
  submitChange: (name: string) => void,
): () => void {
  field.value = draft.value;
  try {
    field.setSelectionRange(draft.selectionStart, draft.selectionEnd);
  } catch {
    // typ pole výběr textu neumí (číslo, e-mail) — kurzor zůstane na konci
  }
  const stop = () => {
    field.removeEventListener('change', stop);
    field.removeEventListener('blur', onBlur);
  };
  const onBlur = () => {
    stop();
    if (field.value !== field.defaultValue) submitChange(field.name);
  };
  // `change` přijde před `blur`: uslyší ho formulář a odešle se obvyklou cestou
  field.addEventListener('change', stop);
  field.addEventListener('blur', onBlur);
  return stop;
}

/**
 * Atribut, který formulář dostane ve chvíli, kdy auto-save začne poslouchat.
 * Do té doby změna pole nic neodešle (a změnu vyslanou skriptem nikdo
 * nedožene) — čeká na něj E2E (`autoSaveForm` v `e2e/helpers.ts`).
 */
const READY_ATTRIBUTE = 'data-auto-submit';

/**
 * Auto-save formuláře: vloží se DOVNITŘ <form> a každou změnu pole odešle
 * (form.requestSubmit() → server action). U textových polí prohlížeč spouští
 * `change` až při blur — přesně to chceme, žádný debounce není potřeba.
 *
 * Každá změna se odešle HNED, i když předchozí uložení ještě běží. Dřív se
 * taková změna jen zapamatovala a formulář se měl odeslat po dokončení —
 * jenže dokončené uložení formulář vykreslí znovu ze stavu na serveru, takže
 * čekající změna z obrazovky zmizela a neodeslala se nikdy (změřeno
 * 11. 10. 2026: dvě nabídky přepnuté rychle po sobě, druhá se ztratila).
 * Odeslat každou zvlášť je bezpečné, protože server zapisuje jen pole, která
 * se liší od stavu při vykreslení (`lib/form-baseline.ts`): dvě odeslání se
 * nepřepíšou a server je zpracuje v pořadí, v jakém je člověk udělal.
 *
 * Jediné, co samotné srovnání nepozná, je změna vrácená během ukládání
 * (přepínač zapnutý a hned vypnutý — druhé odeslání nese totéž, co stálo ve
 * formuláři při vykreslení). Jméno pole, jehož změna odeslání vyvolala, proto
 * jde serveru ve skrytém poli `CHANGED_FIELD` a to pole se zapíše vždy.
 * Hodnotu skrytému poli nastavuje jen tenhle skript; React ho vykreslí bez
 * hodnoty a nikdy mu ji nepřepíše.
 *
 * Změna provedená DŘÍV, než se stránka hydratovala, událost `change` vyslala
 * do prázdna. Po hydrataci se proto formulář srovná s HTML ze serveru —
 * a rozhoduje, KDO rozdíl způsobil (`lib/form-changes.ts`):
 * - pole, které prokazatelně změnil člověk (`lib/early-input.ts`), se odešle;
 * - každý jiný rozdíl se vrátí na hodnotu ze serveru a NEODEŠLE se. Tak
 *   vypadá hodnota, kterou do pole vrátil prohlížeč (F5 ve Firefoxu, návrat
 *   v historii, obnovený panel) nebo vyplnilo rozšíření: odeslat ji by
 *   potichu přepsalo nastavení změněné mezitím jinde.
 * Jen po hydrataci — po vykreslení v prohlížeči (přechod odkazem) pole
 * teprve vznikla a není co srovnávat.
 *
 * Formulář s auto-save má mít `autoComplete="off"`: prohlížeč pak staré
 * hodnoty do polí nevrací vůbec (ani bez JavaScriptu, kde by je odeslalo
 * tlačítko Uložit). Srovnání výše je pojistka pro případy, kdy to nestačí.
 *
 * FOKUS: uložení končí přesměrováním s potvrzením v adrese a stránka se po
 * něm vykreslí celá znovu, takže pole s fokusem zanikne. Zanikající formulář
 * si proto zapamatuje, kde fokus byl, a nový ho tam vrátí — ve stejném
 * vykreslení, takže klávesa zmáčknutá těsně po uložení nejde do prázdna
 * (`lib/focus-handoff.ts`). Hodnoty polí se nepředávají, ty jsou vždy ze
 * serveru; výjimka je rozepsaný text, který by jinak uživateli zmizel pod
 * rukama (`resumeDraft`).
 *
 * Bez JS se auto-save nekoná — komponenta proto vykresluje <noscript> tlačítko.
 */
export function AutoSubmit() {
  const ref = useRef<HTMLInputElement>(null);
  /**
   * Pole s rozepsaným textem, které zanikající formulář právě předal dál.
   * Chromium při zániku takového pole ohlásí `change` — ještě během
   * vykreslování, kdy React odeslání nezachytí, takže formulář odešel
   * prohlížečem a stránka se načetla celá znovu (změřeno 11. 10. 2026: POST
   * bez polí Reactu, nový dokument). Text má v tu chvíli už nové pole, které
   * ho uloží obvyklou cestou, jakmile ho uživatel opustí; tohle `change` se
   * proto neodesílá.
   */
  const handedOffField = useRef<Element | null>(null);

  // Layout efekt: úklid běží, dokud zanikající pole ještě stojí v dokumentu
  // (běžný efekt by už viděl fokus na <body>), a nový formulář fokus vrátí
  // dřív, než prohlížeč cokoli vykreslí.
  useLayoutEffect(() => {
    const changedField = ref.current;
    const form = changedField?.form;
    if (!changedField || !form) return;
    // cesta z doby vzniku: při odchodu jinam už adresa může patřit nové stránce
    const { pathname } = window.location;
    const handoff = focusHandoff;
    focusHandoff = null;
    handedOffField.current = null;
    let stopDraft = (): void => {};
    if (handoffApplies(handoff, pathname, performance.now())) {
      const target = findFocusTarget(handoff.descriptor, focusablesOf(form));
      const active = document.activeElement;
      // fokus nikomu nebereme: vrací se jen tehdy, když zánikem pole spadl na stránku
      if (target && (active === null || active === document.body)) {
        target.focus({ preventScroll: true });
      }
      const field = target && document.activeElement === target ? fieldOf(target) : null;
      if (field && handoff.descriptor.draft) {
        stopDraft = resumeDraft(field, handoff.descriptor.draft, (name) => {
          changedField.value = name;
          form.requestSubmit();
        });
      }
    }
    return () => {
      stopDraft();
      const active = document.activeElement;
      if (active instanceof HTMLElement && form.contains(active)) {
        focusHandoff = {
          pathname,
          descriptor: describeFocus(active, focusablesOf(form)),
          at: performance.now(),
        };
        if (focusHandoff.descriptor.draft) handedOffField.current = active;
      }
    };
  }, []);

  // serverový snímek platí jen pro první vykreslení při hydrataci
  const hydratedFromServer = useRef(
    useSyncExternalStore(
      subscribeToNothing,
      () => false,
      () => true,
    ),
  );

  useEffect(() => {
    const changedField = ref.current;
    const form = changedField?.form;
    if (!changedField || !form) return;
    const onChange = (event: Event) => {
      if (event.target !== null && event.target === handedOffField.current) return;
      const name = (event.target as { name?: unknown } | null)?.name;
      changedField.value = typeof name === 'string' ? name : '';
      form.requestSubmit();
    };
    form.addEventListener('change', onChange);
    // jednou: vývojový režim Reactu pouští efekt dvakrát a druhé odeslání by
    // se s prvním pralo
    if (hydratedFromServer.current) {
      hydratedFromServer.current = false;
      const controls = Array.from(form.elements) as unknown as FormControlState[];
      const { revert, submit } = reconcileWithServerHtml(controls, readEarlyInput(window));
      // nejdřív vrátit, co není od člověka — server by rozdíl proti stavu při
      // vykreslení vzal jako změnu
      revert.forEach(restoreServerHtml);
      if (submit) form.requestSubmit();
    }
    form.setAttribute(READY_ATTRIBUTE, 'ready');
    return () => {
      form.removeEventListener('change', onChange);
      form.removeAttribute(READY_ATTRIBUTE);
    };
  }, []);

  return (
    <>
      <input ref={ref} type="hidden" name={CHANGED_FIELD} />
      <noscript>
        <button
          type="submit"
          className="rounded-md bg-accent-fill px-3 py-1.5 text-sm font-semibold text-white hover:brightness-95"
        >
          Uložit
        </button>
      </noscript>
    </>
  );
}
