'use client';

import { useActionState } from 'react';
import { joinWaitlistAction, type WaitlistState } from '@/app/waitlist-actions';

/**
 * Formulář waitlistu (docs/12, P0) — jedno pole, žádná registrace.
 * Souhlas dle zákona 480/2004 Sb. je omezený na jednorázové oznámení
 * o otevření; říká to text pod polem.
 */
export function WaitlistForm() {
  const [state, formAction, pending] = useActionState<WaitlistState, FormData>(
    joinWaitlistAction,
    {},
  );

  if (state.ok) {
    return (
      <p role="status" className="rounded-md border border-zelena/40 bg-zelena/5 px-4 py-3 text-sm">
        {state.ok}
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <div className="flex flex-wrap gap-3">
        <label htmlFor="waitlist-email" className="sr-only">
          E-mail
        </label>
        <input
          id="waitlist-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="tvuj@email.cz"
          // žádné outline-none: rušilo by globální růžový fokusový ring
          // (:focus-visible v globals.css) a pole by při procházení klávesnicí
          // nebylo poznat
          className="w-full min-w-0 flex-1 rounded-md border border-inkoust/25 bg-plocha px-4 py-3 text-sm shadow-sm focus:border-ruzova sm:w-auto"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-ruzova-syta px-6 py-3 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-60"
        >
          {pending ? 'Ukládám…' : 'Dát vědět, až otevřeme'}
        </button>
      </div>
      {state.chyba && (
        <p role="alert" className="text-sm text-cervena">
          {state.chyba}
        </p>
      )}
      <p className="text-xs text-inkoust-tlumeny">
        Pošleme ti jediný e-mail — že Danero otevírá. Žádný newsletter, adresu pak smažeme.
      </p>
    </form>
  );
}
