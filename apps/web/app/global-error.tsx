'use client';

import { useEffect } from 'react';
import './globals.css';

/**
 * Poslední záchrana: pád v kořenovém layoutu (fonty, ThemeProvider) obejde
 * i `app/error.tsx`, protože layout se vůbec nevykreslí. Next v takovém
 * případě sáhne sem — a protože se nahrazuje celý dokument, komponenta si
 * musí vyrobit `<html>` i `<body>` sama (včetně `lang="cs"`).
 *
 * Styly proto nejedou z layoutu, ale z vlastního importu globals.css; žádné
 * další komponenty se sem netahají, ať tahle obrazovka nemůže spadnout taky.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[danero] chyba kořenového layoutu:', error);
  }, [error]);

  return (
    <html lang="cs">
      <body>
        <main className="mx-auto flex max-w-xl flex-col items-start gap-4 px-6 pt-24">
          <h1 className="font-display text-3xl font-bold">Danero se teď nepodařilo načíst</h1>
          <p className="text-inkoust-tlumeny">
            Chyba je na naší straně a tvoje data jsou v pořádku — každý výpočet se dělá znovu
            z uložených transakcí. Zkus to prosím ještě jednou.
          </p>
          {error.digest && (
            <p className="font-mono text-xs text-inkoust-tlumeny">Kód chyby: {error.digest}</p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center justify-center rounded-md bg-ruzova-syta px-4 py-2 text-sm font-semibold text-white"
            >
              Zkusit znovu
            </button>
            <a href="/" className="font-medium text-ruzova-text underline underline-offset-2">
              Zpět na úvodní stránku
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
