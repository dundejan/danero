'use client';

import { useState } from 'react';

/**
 * `<details>`, který se otevře sám jen jednou — při prvním vykreslení.
 *
 * Atribut `open` z vlastnosti je řízený: když ho další vykreslení ze serveru
 * už nenese, React ho odebere a detail se zavře čtenáři pod rukama. Přesně to
 * se dělo dávce v historii importů: otevřela se podle adresy
 * (`?ulozeno=nahrano&davka=…`), adresa se hned uklidila, a jakmile se stránka
 * obnovila ze serveru (doběhla synchronizace, návrat z mezipaměti), řádek
 * s chybami se sbalil — hláška nad historií přitom zůstala a odkazovala na něj.
 *
 * Tady si komponenta první hodnotu pamatuje a dál ji nemění, takže o otevření
 * a zavření rozhoduje už jen uživatel.
 */
export function DetailsOnce({
  defaultOpen,
  ...props
}: Omit<React.ComponentProps<'details'>, 'open'> & { defaultOpen: boolean }) {
  const [initiallyOpen] = useState(defaultOpen);
  return <details open={initiallyOpen || undefined} {...props} />;
}
