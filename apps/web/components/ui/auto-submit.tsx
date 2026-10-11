'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useFormStatus } from 'react-dom';
import { readEarlyInput } from '@/lib/early-input';
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
 * Ochrana proti dvojímu odeslání: během pending se další change jen zapamatuje
 * a formulář se odešle znovu po dokončení — rychlé přepnutí dvou přepínačů se
 * tak neztratí ani neodešle dvakrát.
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
  const { pending } = useFormStatus();
  const ref = useRef<HTMLSpanElement>(null);
  const pendingRef = useRef(pending);
  const queuedRef = useRef(false);
  pendingRef.current = pending;
  // serverový snímek platí jen pro první vykreslení při hydrataci
  const hydratedFromServer = useRef(
    useSyncExternalStore(
      subscribeToNothing,
      () => false,
      () => true,
    ),
  );

  // změna nastřádaná během běžícího uložení → odeslat hned po dokončení
  useEffect(() => {
    if (!pending && queuedRef.current) {
      queuedRef.current = false;
      ref.current?.closest('form')?.requestSubmit();
    }
  }, [pending]);

  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const onChange = () => {
      if (pendingRef.current) {
        queuedRef.current = true;
        return;
      }
      form.requestSubmit();
    };
    form.addEventListener('change', onChange);
    // jednou: vývojový režim Reactu pouští efekt dvakrát a druhé odeslání by
    // se s prvním pralo
    if (hydratedFromServer.current) {
      hydratedFromServer.current = false;
      const controls = Array.from(form.elements) as unknown as FormControlState[];
      const { revert, submit } = reconcileWithServerHtml(controls, readEarlyInput(window));
      // nejdřív vrátit, co není od člověka — odesílá se celý formulář
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
      <span ref={ref} hidden />
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
