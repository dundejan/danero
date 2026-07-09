'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const MODES = [
  { key: 'system', icon: '○', label: 'Vzhled podle systému' },
  { key: 'light', icon: '☀', label: 'Světlý vzhled' },
  { key: 'dark', icon: '☾', label: 'Tmavý vzhled' },
] as const;

/**
 * Přepínač vzhledu (H4): tři stavy systém/světlý/tmavý přes next-themes.
 * mounted-guard: server nezná uložené téma, aktivní stav se ukáže až po
 * hydrataci (jinak hydration mismatch).
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const active = mounted ? (theme ?? 'system') : null;

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Vzhled aplikace">
      {MODES.map((mode) => (
        <button
          key={mode.key}
          type="button"
          aria-label={mode.label}
          title={mode.label}
          aria-pressed={active === mode.key}
          onClick={() => setTheme(mode.key)}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md text-sm',
            active === mode.key
              ? 'bg-pozadi font-semibold text-ruzova'
              : 'text-inkoust-tlumeny hover:text-inkoust',
          )}
        >
          <span aria-hidden>{mode.icon}</span>
        </button>
      ))}
    </div>
  );
}
