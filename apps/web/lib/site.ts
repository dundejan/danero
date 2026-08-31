import type { Metadata } from 'next';

/**
 * Veřejná adresa instance a jméno služby — jediný zdroj pro `robots.txt`,
 * sitemapu, `metadataBase` (a přes něj kanonické adresy i OG náhledy) a JSON-LD.
 *
 * Fallback je schválně produkční doména, ne localhost: sitemapu ani OG obrázek
 * nikdo nečte z devu, takže je lepší mít správnou adresu i bez nastavení.
 * Vlastní instance si ji přepíše přes `NEXT_PUBLIC_APP_URL`.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://danero.cz';

/**
 * Jméno služby v náhledu odkazu a v JSON-LD. Je to **značka, ne identifikace
 * provozovatele** — jméno, IČO, adresa a kontakty patří výhradně do
 * `DANERO_OPERATOR_*` / `DANERO_CONTACT_*` (`lib/contact.ts`, pravidlo 8).
 */
export const SITE_NAME = 'Danero';

/** Popis služby jednou větou: výchozí `description`, náhled odkazu i JSON-LD. */
export const SITE_DESCRIPTION =
  'Hlídač časových testů a daňových limitů pro české investory. Limit 100 000 Kč, paušální daň, podklady k přiznání.';

/**
 * Metadata pro celý web (K8-04). Sdílený odkaz na Danero byl do 31. 8. 2026
 * holý text: nula `og:*`, nula `twitter:*`, žádná kanonická adresa.
 *
 * Všechno je schválně **jen tady v kořeni** a stránky si to nepřepisují:
 *
 * - `alternates.canonical` je **instance `URL`, ne řetězec** — Next ji bere
 *   jako základ a doplní k ní cestu právě renderované stránky
 *   (`resolveAlternateUrl` v `next/dist/lib/metadata/resolvers/resolve-basics`).
 *   Řetězec `'/'` by naopak nakanonizoval **každou** stránku na úvodní.
 * - `openGraph.url: './'` se stejným způsobem přeloží na cestu stránky.
 * - `openGraph` **nemá `title` ani `description`** — Next je na konci doplní
 *   z titulku a popisu konkrétní stránky. Kdyby tu byly, zdědil by je celý web
 *   a každý sdílený odkaz by se tvářil jako úvodní stránka.
 * - `openGraph` nemá ani `images`: náhledový obrázek dodává soubor
 *   `app/opengraph-image.tsx`. Ten se dědí jen do stránek, které si `openGraph`
 *   nepřepisují — proto se `openGraph` v jednotlivých stránkách nedeklaruje.
 *
 * Chování obou „základů" i dědění ověřuje `test/seo-metadata.test.ts` proti
 * skutečným resolverům Nextu — je to jediné místo, kde se pozná, že upgrade
 * Nextu zkanonizoval celý web na úvodní stránku.
 */
export const SITE_METADATA: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Danero — daně z investic pohlídané celý rok',
  description: SITE_DESCRIPTION,
  alternates: { canonical: new URL(SITE_URL) },
  openGraph: {
    type: 'website',
    locale: 'cs_CZ',
    siteName: SITE_NAME,
    url: './',
  },
  twitter: { card: 'summary_large_image' },
};
