'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useFormStatus } from 'react-dom';
import { differsFromServerHtml, type FormControlState } from '@/lib/form-changes';

const subscribeToNothing = (): (() => void) => () => {};

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
 * do prázdna: nabídka ukazovala novou volbu, ale nic se neuložilo a nic to
 * neřeklo. Po hydrataci se proto formulář porovná s HTML ze serveru a rozdíl
 * se odešle. Jen po hydrataci — po vykreslení v prohlížeči (přechod odkazem)
 * pole teprve vznikla a není co dohánět.
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
    if (
      hydratedFromServer.current &&
      differsFromServerHtml(form.elements as Iterable<FormControlState>)
    ) {
      form.requestSubmit();
    }
    hydratedFromServer.current = false;
    return () => form.removeEventListener('change', onChange);
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
