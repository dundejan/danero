'use client';

import { useEffect } from 'react';
import { urlWithoutFeedback } from '@/components/toast';

/**
 * Uklidí z adresy kód výsledku (`?chyba=`, `?ulozeno=` a údaje k němu), když
 * ho stránka ukázala v toku stránky místo v toastu — chybu přímo u pole
 * (Nastavení → Účet), výsledek nahrání nad historií importů (Zdroje dat).
 * Jinak by ho obnovení stránky nebo tlačítko zpět ukázalo znovu. Toast si
 * totéž dělá sám.
 */
export function ClearFeedbackUrl() {
  useEffect(() => {
    const cleaned = urlWithoutFeedback(window.location.href);
    if (cleaned !== null) window.history.replaceState(null, '', cleaned);
  }, []);
  return null;
}
