'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { TextLink } from '@/components/ui/link';

/**
 * Kořenový error boundary — chytá marketingové i přihlašovací stránky
 * (`app/(auth)`), které vlastní `error.tsx` neměly. Bez něj by tam pád skončil
 * v anglické defaultní obrazovce Nextu, a to hned na první stránce, kterou
 * návštěvník vidí. Aplikační a demo část mají vlastní, konkrétnější hlášku.
 *
 * Obrazovka odpovídá na čtyři otázky: kde jsem (značka), co se stalo (jedna
 * věta), co s tím (zkusit znovu) a jak ven (úvodní stránka). Kód chyby je
 * tichý řádek dole — je pro toho, kdo chybu hlásí, ne pro čtení.
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
    <main className="wrap-wide flex min-h-svh flex-col justify-center py-16">
      <div className="measure">
        <Link
          href="/"
          aria-label="Danero — úvodní stránka"
          className="inline-flex min-h-11 items-center"
        >
          <Logo className="text-[1.0625rem]" />
        </Link>
        <h1 className="type-title-1 mt-8 text-balance">Něco se pokazilo</h1>
        <p className="type-body mt-3 text-pretty text-ink-muted">
          Stránku se nepodařilo načíst. Zkus to znovu, a kdyby to nepomohlo, vrať se za chvíli.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2">
          <Button onClick={reset}>Zkusit znovu</Button>
          <TextLink href="/" chevron>
            Úvodní stránka
          </TextLink>
        </div>
        {error.digest && (
          <p className="type-caption mt-10 tabular-nums text-ink-muted">
            Kód chyby: {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
