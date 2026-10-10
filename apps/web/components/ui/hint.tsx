'use client';

import { InfoPopover } from '@/components/ui/info-popover';

/**
 * Starší jméno vysvětlivky — dnes jen tenká obálka nad `InfoPopover`, aby
 * stránky, které ji ještě používají, dostaly stejné tlačítko „i“ a stejnou
 * bublinu. V novém kódu použij rovnou `InfoPopover`.
 */
export function Hint({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <InfoPopover label={label} className="ml-1">
      {children}
    </InfoPopover>
  );
}
