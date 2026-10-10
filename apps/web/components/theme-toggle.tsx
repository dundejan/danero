'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { SegmentedControl } from '@/components/ui/segmented-control';

const MODES = [
  { key: 'system', short: 'Auto', label: 'Podle systému' },
  { key: 'light', short: 'Světlý', label: 'Světlý' },
  { key: 'dark', short: 'Tmavý', label: 'Tmavý' },
] as const;

/**
 * Přepínač vzhledu: tři stavy systém/světlý/tmavý přes next-themes.
 * mounted-guard: server nezná uložené téma, aktivní stav se ukáže až po
 * hydrataci (jinak hydration mismatch). `withLabels` píše plné popisky
 * (v Nastavení); bez něj stačí krátké „Auto“ — plný název nese `aria-label`.
 */
export function ThemeToggle({
  withLabels = false,
  className,
}: {
  withLabels?: boolean;
  className?: string;
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const active = mounted ? (theme ?? 'system') : '';

  return (
    <SegmentedControl
      ariaLabel="Vzhled aplikace"
      value={active}
      onChange={setTheme}
      segments={MODES.map((mode) => ({
        key: mode.key,
        label: withLabels ? mode.label : mode.short,
        ariaLabel: mode.label,
      }))}
      className={className}
    />
  );
}
