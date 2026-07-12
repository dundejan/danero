'use client';

import { Button } from '@/components/ui/button';

/** Tisk podkladů k přiznání — tiskové styly řeší globals.css (@media print). */
export function PrintButton() {
  return (
    <Button
      type="button"
      variant="secondary"
      className="print:hidden"
      onClick={() => window.print()}
    >
      Vytisknout / uložit PDF
    </Button>
  );
}
