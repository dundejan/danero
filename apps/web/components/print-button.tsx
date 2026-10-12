'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { openForPrint } from '@/lib/print-details';
import { cn } from '@/lib/utils';

/**
 * Tisk v prohlížeči, který neumí `::details-content`.
 *
 * Rozbalení (rozpad prodeje na nákupy — auditní stopa podkladu) otevírá pro
 * tisk styl v globals.css. Pseudoprvek ale znají až Chromium 131, Safari 18.4
 * a Firefox 143; starší prohlížeč rozbalení vytiskl zavřená a na papíře tak
 * mlčky chyběla část podkladu. Tam je před tiskem otevře skript a po tisku
 * vrátí do stavu, v jakém je uživatel nechal. Kde to styl umí, nedělá nic.
 */
export function OpenDetailsForPrint() {
  useEffect(() => {
    if (CSS.supports('selector(::details-content)')) return;
    let closeAgain: (() => void) | undefined;
    const open = (): void => {
      // dvě `beforeprint` po sobě bez `afterprint` mezi nimi: první vrácení se neztratí
      const earlier = closeAgain;
      const latest = openForPrint(document.querySelectorAll('details'));
      closeAgain = () => {
        latest();
        earlier?.();
      };
    };
    const restore = (): void => {
      closeAgain?.();
      closeAgain = undefined;
    };
    window.addEventListener('beforeprint', open);
    window.addEventListener('afterprint', restore);
    return () => {
      window.removeEventListener('beforeprint', open);
      window.removeEventListener('afterprint', restore);
    };
  }, []);
  return null;
}

/**
 * Tisk podkladů k přiznání — tiskové styly řeší globals.css (@media print).
 * Dialog tisku nabízí i uložení do PDF. V liště se to do popisku nevejde
 * a říká to nápověda tlačítka; tam, kde místo je (`long` — tlačítko na konci
 * stránky na telefonu, kde se nápověda neukáže vůbec), to říká popisek sám
 * (R5-13).
 */
export function PrintButton({ className, long = false }: { className?: string; long?: boolean }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      title={long ? undefined : 'Vytisknout nebo uložit jako PDF'}
      className={cn('print:hidden', className)}
      onClick={() => window.print()}
    >
      {long ? 'Vytisknout nebo uložit PDF' : 'Vytisknout'}
    </Button>
  );
}
