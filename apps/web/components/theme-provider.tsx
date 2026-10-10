'use client';

import { MotionConfig } from 'motion/react';
import { usePathname } from 'next/navigation';
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes';
import { useEffect } from 'react';
import { THEME_COLOR } from '@/components/theme-color';

/**
 * Barva lišty prohlížeče podle SKUTEČNÉHO vzhledu. Značky v hlavičce se řídí
 * jen systémem (`prefers-color-scheme`), takže po ruční volbě tmavého vzhledu
 * na světlém systému zůstával nad černou aplikací bílý stavový pruh. Po každé
 * změně vzhledu (a po navigaci, která značky vykreslí znovu) se proto obě
 * přepíšou na barvu plochy, která je opravdu vidět.
 */
function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  const pathname = usePathname();
  useEffect(() => {
    if (resolvedTheme !== 'light' && resolvedTheme !== 'dark') return;
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute('content', THEME_COLOR[resolvedTheme]);
    }
  }, [resolvedTheme, pathname]);
  return null;
}

/**
 * Vzhled (světlý/tmavý přes třídu `.dark`) a společné nastavení pohybu.
 * `reducedMotion="user"`: kdo má v systému omezený pohyb, tomu pružiny
 * nehýbou polohou ani měřítkem — průhlednost se prolíná dál.
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider {...props}>
      <ThemeColorSync />
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </NextThemesProvider>
  );
}
