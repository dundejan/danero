'use client';

import { useEffect } from 'react';

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
      <h1 className="font-display text-3xl font-bold">Něco se pokazilo</h1>
      <p className="text-inkoust-tlumeny">
        Stránku se nepodařilo načíst. Tvoje data jsou v pořádku — výpočty se vždy provádějí
        znovu z uložených transakcí. Zkus to prosím ještě jednou.
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-inkoust-tlumeny">Kód chyby: {error.digest}</p>
      )}
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-ruzova px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
      >
        Zkusit znovu
      </button>
    </div>
  );
}
