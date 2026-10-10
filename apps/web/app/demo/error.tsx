'use client';

import { useEffect } from 'react';
import { buttonVariants } from '@/components/ui/button';

/** Error boundary demo stránek — bez něj by pád skončil v anglické defaultní
    chybě Nextu, přesně u veřejné vstupní brány pro nové návštěvníky. */
export default function DemoError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[danero] chyba demo stránky:', error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 pt-24">
      <h1 className="text-3xl font-bold">Něco se pokazilo</h1>
      <p className="text-ink-muted">
        Demo se nepodařilo načíst. Zkus to prosím ještě jednou — a kdyby to
        nepomohlo, vrať se za chvíli.
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
