'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { SegmentedControl } from '@/components/ui/segmented-control';

const MODES = [
  { key: 'system', label: 'Podle systému' },
  { key: 'light', label: 'Světlý' },
  { key: 'dark', label: 'Tmavý' },
] as const;

/**
 * Přepínač vzhledu: tři stavy systém/světlý/tmavý přes next-themes.
 * mounted-guard: server nezná uložené téma, aktivní stav se ukáže až po
 * hydrataci (jinak hydration mismatch).
 *
 * Popisky jsou všude stejné („Podle systému / Světlý / Tmavý“) — dřív měl
 * přepínač v patičce dema zkrácené „Auto“ a tentýž prvek se na dvou místech
 * jmenoval jinak. Vlastnost `withLabels`, která je rozlišovala, je bez účinku.
 *
 * Změna vzhledu stránku prolne (150 ms, `::view-transition` v globals.css):
 * skok z bílé do černé je náraz jasu. S omezeným pohybem a v prohlížeči, který
 * přechody pohledů neumí, se přepne rovnou.
 */
export function ThemeToggle({
  className,
}: {
  /** @deprecated Bez účinku — popisky jsou plné vždy. */
  withLabels?: boolean;
  className?: string;
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const active = mounted ? (theme ?? 'system') : '';

  const change = (key: string) => {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still || typeof document.startViewTransition !== 'function') {
      setTheme(key);
      return;
    }
    document.startViewTransition(async () => {
      flushSync(() => setTheme(key));
      // třídu `.dark` přepíná next-themes až v efektu — snímek nového stavu
      // se smí pořídit teprve po něm
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  return (
    <SegmentedControl
      ariaLabel="Vzhled aplikace"
      value={active}
      onChange={change}
      segments={MODES.map((mode) => ({ key: mode.key, label: mode.label }))}
      fit="content"
      className={className}
    />
  );
}
