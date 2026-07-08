'use client';

/** Tisk podkladů k přiznání — tiskové styly řeší globals.css (@media print). */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print:hidden rounded-md border border-linka bg-plocha px-4 py-2 text-sm font-semibold text-inkoust hover:border-inkoust-tlumeny"
    >
      Vytisknout / uložit PDF
    </button>
  );
}
