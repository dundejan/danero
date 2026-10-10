'use client';

import { useEffect } from 'react';
import { urlWithoutFeedback } from '@/components/toast';

/**
 * Uklidí z adresy kód výsledku (`?chyba=`), když ho stránka ukázala přímo
 * u pole místo v toastu — jinak by ho obnovení stránky nebo tlačítko zpět
 * ukázalo znovu. Toast si totéž dělá sám.
 */
export function ClearFeedbackUrl() {
  useEffect(() => {
    const cleaned = urlWithoutFeedback(window.location.href);
    if (cleaned !== null) window.history.replaceState(null, '', cleaned);
  }, []);
  return null;
}
