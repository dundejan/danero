'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

/**
 * Kořenový error boundary — chytá marketingové i přihlašovací stránky
 * (`app/(auth)`), které vlastní `error.tsx` neměly. Bez něj by tam pád skončil
 * v anglické defaultní obrazovce Nextu, a to hned na první stránce, kterou
 * návštěvník vidí. Aplikační a demo část mají vlastní, konkrétnější hlášku.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[danero] chyba stránky:', error);
  }, [error]);

  return (
    <main className="mx-auto flex max-w-xl flex-col items-start gap-4 px-6 pt-24">
      <h1 className="text-3xl font-bold">Něco se pokazilo</h1>
      <p className="text-ink-muted">
        Stránku se nepodařilo načíst. Zkus to prosím ještě jednou — a kdyby to nepomohlo,
        vrať se za chvíli.
      </p>
      {error.digest && (
        <p className="tabular-nums text-xs text-ink-muted">Kód chyby: {error.digest}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={reset} className={buttonVariants({ variant: 'primary' })}>
          Zkusit znovu
        </button>
        <Link href="/" className="font-medium text-accent-text underline underline-offset-2">
          Zpět na úvodní stránku
        </Link>
      </div>
    </main>
  );
}
