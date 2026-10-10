import type { Viewport } from 'next';
import { THEME_COLOR } from '@/components/theme-color';
import { ThemeProvider } from '@/components/theme-provider';
import { SITE_METADATA } from '@/lib/site';
import './globals.css';

/**
 * Písmo je systémové (zásobník `--font-sans` v globals.css) — žádné webové
 * fonty se nestahují, takže odpadá `next/font` i jeho proměnné na `<body>`.
 *
 * Metadata pro celý web dál bydlí v `lib/site.ts`: čte je i test
 * (`test/seo-metadata.test.ts`) a soubor rozložení si mimo Next nikdo
 * nenaimportuje kvůli importu CSS.
 */
export const metadata = SITE_METADATA;

/**
 * `viewport-fit=cover` pustí stránku pod výřez a domovský indikátor telefonu —
 * bez něj vrací `env(safe-area-inset-*)` nulu a spodní lišta aplikace by si
 * neuměla nechat místo. Barva lišty prohlížeče odpovídá ploše úplně nahoře
 * na stránce (--surface) v obou režimech. Zoom se nezakazuje.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // softwarová klávesnice zmenší rozložení (ne jen překryje stránku), takže
  // `dvh` a spodní lišta na Androidu reagují stejně jako na iOS
  interactiveWidget: 'resizes-content',
  // výchozí podle systému; po ruční volbě vzhledu je přepíše `ThemeProvider`
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLOR.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLOR.dark },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
