'use client';

import { useEffect } from 'react';
import { AppState } from '@/components/app-state';
import { Button } from '@/components/ui/button';
import { TextLink } from '@/components/ui/link';

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
    <AppState
      title="Něco se pokazilo"
      actions={
        <>
          <Button type="button" onClick={reset}>
            Zkusit znovu
          </Button>
          <TextLink href="/prehled" chevron>
            Přehled
          </TextLink>
        </>
      }
      note={error.digest ? `Kód chyby: ${error.digest}` : undefined}
    >
      Stránku se nepodařilo načíst. Tvoje data jsou v pořádku.
    </AppState>
  );
}
