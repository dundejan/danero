'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Tisk podkladů k přiznání — tiskové styly řeší globals.css (@media print).
 * Dialog tisku nabízí i uložení do PDF; říká to nápověda tlačítka, do popisku
 * v liště se to nevejde.
 */
export function PrintButton({ className }: { className?: string }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      title="Vytisknout nebo uložit jako PDF"
      className={cn('print:hidden', className)}
      onClick={() => window.print()}
    >
      Vytisknout
    </Button>
  );
}
