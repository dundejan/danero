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
 * Tlačítko a odkaz jsou proto psané třídami, ne přes `Button` a `TextLink`
 * (vzhled drží stejný: kapsle s odezvou při stisku, odkaz se šipkou).
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
      <body className="bg-surface text-ink antialiased">
        <main className="wrap flex min-h-svh flex-col justify-center py-16">
          <div className="measure">
            <h1 className="type-title-1 text-balance">Danero se teď nepodařilo načíst</h1>
            <p className="type-body mt-3 text-pretty text-ink-muted">
              Chyba je na naší straně. Tvoje data jsou v pořádku — každý výpočet se dělá znovu z
              uložených transakcí.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2">
              <button
                type="button"
                onClick={reset}
                className="pressable inline-flex h-9 items-center justify-center rounded-full bg-accent-fill px-4 text-sm font-medium text-white hover:brightness-95 pointer-coarse:h-11 pointer-coarse:px-5"
              >
                Zkusit znovu
              </button>
              {/* obyčejný odkaz, ne `next/link`: router po pádu layoutu nemusí žít */}
              <a
                href="/"
                className="inline-flex min-h-11 items-center font-medium text-accent-text hover:underline md:min-h-0"
              >
                Úvodní stránka
                <span aria-hidden className="ml-1">
                  ›
                </span>
              </a>
            </div>
            {error.digest && (
              <p className="type-caption mt-10 tabular-nums text-ink-muted">
                Kód chyby: {error.digest}
              </p>
            )}
          </div>
        </main>
      </body>
    </html>
  );
}
