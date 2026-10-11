'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { readEarlyInput } from '@/lib/early-input';
import { CHANGED_FIELD } from '@/lib/form-baseline';
import {
  reconcileWithServerHtml,
  restoreServerHtml,
  type FormControlState,
} from '@/lib/form-changes';

const subscribeToNothing = (): (() => void) => () => {};

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
 * Bez JS se auto-save nekoná — komponenta proto vykresluje <noscript> tlačítko.
 */
export function AutoSubmit() {
  const ref = useRef<HTMLInputElement>(null);
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
