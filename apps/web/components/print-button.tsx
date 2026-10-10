'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
