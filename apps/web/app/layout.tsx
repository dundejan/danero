import { Bricolage_Grotesque, Hanken_Grotesk, IBM_Plex_Mono } from 'next/font/google';
import { ThemeProvider } from '@/components/theme-provider';
import { SITE_METADATA } from '@/lib/site';
import './globals.css';

const bricolage = Bricolage_Grotesque({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-bricolage',
});

const hanken = Hanken_Grotesk({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-hanken',
});

const plexMono = IBM_Plex_Mono({
  // H-3-16: kód kombinuje `font-mono` s `font-semibold` (600) na desítkách
  // míst — bez načtené váhy 600 to prohlížeč dopočítá syntetickým tučným
  // řezem, který u čísel rozhazuje šířku a v tabulkách se to pozná.
  weight: ['400', '500', '600'],
  subsets: ['latin', 'latin-ext'],
  variable: '--font-plex-mono',
});

/**
 * Metadata pro celý web. Bydlí v `lib/site.ts`, protože tenhle soubor si kvůli
 * `next/font` mimo Next nikdo nenaimportuje — ani test.
 */
export const metadata = SITE_METADATA;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs" suppressHydrationWarning>
      <body
        className={`${bricolage.variable} ${hanken.variable} ${plexMono.variable} antialiased`}
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
