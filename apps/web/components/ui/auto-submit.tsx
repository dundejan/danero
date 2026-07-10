'use client';

import { useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';

/**
 * Auto-save formuláře: vloží se DOVNITŘ <form> a každou změnu pole odešle
 * (form.requestSubmit() → server action). U textových polí prohlížeč spouští
 * `change` až při blur — přesně to chceme, žádný debounce není potřeba.
 *
 * Ochrana proti dvojímu odeslání: během pending se další change jen zapamatuje
 * a formulář se odešle znovu po dokončení — rychlé přepnutí dvou přepínačů se
 * tak neztratí ani neodešle dvakrát.
 *
 * Bez JS se auto-save nekoná — komponenta proto vykresluje <noscript> tlačítko.
 */
export function AutoSubmit() {
  const { pending } = useFormStatus();
  const ref = useRef<HTMLSpanElement>(null);
  const pendingRef = useRef(pending);
  const queuedRef = useRef(false);
  pendingRef.current = pending;

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
    return () => form.removeEventListener('change', onChange);
  }, []);

  return (
    <>
      <span ref={ref} hidden />
      <noscript>
        <button
          type="submit"
          className="rounded-md bg-ruzova-syta px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
        >
          Uložit
        </button>
      </noscript>
    </>
  );
}
