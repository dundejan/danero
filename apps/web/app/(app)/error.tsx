'use client';

import { useEffect } from 'react';
import { buttonVariants } from '@/components/ui/button';

/** Error boundary aplikačních stránek (G9b) — česky, s možností opakovat. */
export default function AppError({
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
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 pt-24">
      <h1 className="text-3xl font-bold">Něco se pokazilo</h1>
      <p className="text-ink-muted">
        Stránku se nepodařilo načíst. Tvoje data jsou v pořádku — výpočty se vždy provádějí
        znovu z uložených transakcí. Zkus to prosím ještě jednou.
      </p>
      {error.digest && (
        <p className="tabular-nums text-xs text-ink-muted">Kód chyby: {error.digest}</p>
      )}
      <button
        type="button"
        onClick={reset}
        className={buttonVariants({ variant: 'primary' })}
      >
        Zkusit znovu
      </button>
    </div>
  );
}
