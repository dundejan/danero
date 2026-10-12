'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { urlWithoutFeedback } from '@/components/toast';

/**
 * Uklidí z adresy kód výsledku (`?chyba=`, `?ulozeno=` a údaje k němu), když
 * ho stránka ukázala v toku stránky místo v toastu — chybu přímo u pole
 * (Nastavení → Účet), výsledek nahrání nad historií importů (Zdroje dat).
 * Jinak by ho obnovení stránky nebo tlačítko zpět ukázalo znovu. Toast si
 * totéž dělá sám.
 *
 * Uklízí po KAŽDÉM výsledku, ne jen po prvním: komponenta na stránce zůstává
 * stát a další akce jí přinese nový kód do téže adresy. Dokud uklízela jen při
 * vzniku, druhá chyba (v jiném formuláři téže stránky) v adrese zůstala —
 * stránka pak při každém obnovení ze serveru vypadala jako čerstvý výsledek,
 * řádky vznikly znovu a rozepsaný text zmizel (revize R8, M2). Proto se řídí
 * adresou: směrovač o jejím uklizení ví, takže po něm efekt nemá co dělat,
 * a nový kód ho spustí znovu.
 */
export function ClearFeedbackUrl() {
  const params = useSearchParams();
  useEffect(() => {
    const cleaned = urlWithoutFeedback(window.location.href);
    if (cleaned !== null) window.history.replaceState(null, '', cleaned);
  }, [params]);
  return null;
}
