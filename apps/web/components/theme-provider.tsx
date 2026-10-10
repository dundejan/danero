'use client';

import { MotionConfig } from 'motion/react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

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
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </NextThemesProvider>
  );
}
