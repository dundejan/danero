'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { TextLink } from '@/components/ui/link';

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
    <EmptyState
      headingAs="h1"
      title="Něco se pokazilo"
      action={
        <>
          <Button type="button" onClick={reset}>
            Zkusit znovu
          </Button>
          <TextLink href="/" chevron>
            Zpět na úvod
          </TextLink>
        </>
      }
      note={error.digest ? `Kód chyby: ${error.digest}` : undefined}
    >
      Demo se nepodařilo načíst. Kdyby to nepomohlo, vrať se za chvíli.
    </EmptyState>
  );
}
