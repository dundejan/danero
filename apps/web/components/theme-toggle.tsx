'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const MODES = [
  { key: 'system', icon: '○', label: 'Podle systému' },
  { key: 'light', icon: '☀', label: 'Světlý' },
  { key: 'dark', icon: '☾', label: 'Tmavý' },
] as const;

/**
 * Přepínač vzhledu (H4): tři stavy systém/světlý/tmavý přes next-themes.
 * mounted-guard: server nezná uložené téma, aktivní stav se ukáže až po
 * hydrataci (jinak hydration mismatch). `withLabels` ukáže vedle ikon i text
 * (v Nastavení) — samotné glyfy vysvětluje jen title/aria-label.
 */
export function ThemeToggle({ withLabels = false }: { withLabels?: boolean }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const active = mounted ? (theme ?? 'system') : null;

  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Vzhled aplikace">
      {MODES.map((mode) => (
        <button
          key={mode.key}
          type="button"
          aria-label={mode.label}
          title={mode.label}
          aria-pressed={active === mode.key}
          onClick={() => setTheme(mode.key)}
          className={cn(
            'flex items-center justify-center rounded-md text-sm',
            withLabels ? 'gap-1.5 px-3 py-1.5' : 'h-7 w-7',
            active === mode.key
              ? 'bg-pozadi font-semibold text-ruzova'
              : 'text-inkoust-tlumeny hover:text-inkoust',
          )}
        >
          <span aria-hidden>{mode.icon}</span>
          {withLabels && <span>{mode.label}</span>}
        </button>
      ))}
    </div>
  );
}
