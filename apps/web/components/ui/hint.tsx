'use client';

import { useId, useState } from 'react';

/**
 * Vysvětlivka k popisku — dostupná myší, dotykem i klávesnicí (H-3-08).
 *
 * Do 9. 8. 2026 žila podstatná vysvětlení výhradně v atributu `title=`: ten se
 * na dotykovém displeji nezobrazí vůbec a klávesnicí se k němu nedostaneš, což
 * u jediného výkladu sloupce „Nerealizovaný zisk/ztráta" nebo u přepínačů
 * v Nastavení znamená, že se uživatel význam nedozví. Tohle je obyčejné
 * tlačítko, které text rozbalí pod popiskem — žádný hover, žádná past.
 */
export function Hint({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={id}
        // cíl 24 × 24 px (SC 2.5.8); popisek nese, čeho se vysvětlivka týká
        aria-label={`Vysvětlení: ${label}`}
        className="ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-linka-ovladaci text-xs font-semibold text-inkoust-tlumeny hover:text-inkoust"
      >
        ?
      </button>
      {open && (
        <span id={id} className="mt-1 block text-xs font-normal text-inkoust-tlumeny">
          {children}
        </span>
      )}
    </>
  );
}
