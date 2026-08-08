'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { joinWaitlistAction, type WaitlistState } from '@/app/waitlist-actions';
import { OPERATOR } from '@/lib/contact';

/**
 * Formulář waitlistu (docs/12, P0) — jedno pole, žádná registrace.
 *
 * Souhlas dle § 7 odst. 2 zákona 480/2004 Sb. je omezený na jednorázové
 * oznámení o otevření. Text pod polem proto musí unést i informační povinnost
 * podle čl. 13 GDPR: kdo je správce, k čemu adresa slouží, kde jsou celé
 * zásady a že souhlas jde odvolat (čl. 7 odst. 3) — registrace to má, waitlist
 * do 7. 8. 2026 ne (nález E-35).
 *
 * Neslibuje se tu automatické smazání: žádný kód e-maily z waitlistu nemaže,
 * takže by to byl slib bez opory. Odvolání souhlasu je ruční krok a tak se
 * i popisuje.
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
          className="w-full min-w-0 flex-1 rounded-md border border-linka-ovladaci bg-plocha px-4 py-3 text-sm shadow-sm focus:border-ruzova sm:w-auto"
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
        Pošleme ti jediný e-mail — že Danero otevírá. Žádný newsletter, žádné předávání
        dál. Správcem adresy je {OPERATOR.name}, IČO {OPERATOR.ico}; souhlas můžeš kdykoli
        odvolat na{' '}
        <a href={`mailto:${OPERATOR.email}`} className="font-medium text-ruzova-text">
          {OPERATOR.email}
        </a>{' '}
        a adresu ze seznamu smažeme. Podrobnosti a tvoje práva:{' '}
        <Link href="/soukromi" className="font-medium text-ruzova-text">
          ochrana soukromí
        </Link>
        .
      </p>
    </form>
  );
}
