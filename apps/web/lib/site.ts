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

/**
 * Co Danero je, dvěma větami: titulek úvodní stránky a text obrázku pro
 * sdílení (`app/opengraph-image.tsx`). Na jednom místě proto, že se už jednou
 * rozešly — úvod dostal nové znění a sdílený odkaz dál nesl starý slogan
 * (nález R1A-02).
 *
 * Druhá věta mluví ke každému, kdo investuje, ne k vývojáři: do 10. 10. 2026
 * tu stálo „Je zdarma a má otevřený kód.“ a majitel to vyřadil — co je
 * otevřený kód, většina čtenářů neví. Veřejný kód zůstává důkazem na
 * stránkách `/bezpecnost`, `/cenik` a `/o-projektu`, ne heslem v titulku.
 */
export const SITE_TAGLINE = 'Hlídač daní z investic.';
export const SITE_TAGLINE_HOW = 'Bezpečně a zdarma.';

/**
 * Výchozí titulek dokumentu a popis obrázku pro sdílení: jméno a první věta
 * úvodu. Dostane ho každá stránka, která nemá vlastní `title`. Shodu s úvodem
 * hlídá `test/seo-metadata.test.ts`.
 */
export const SITE_TITLE = 'Danero — hlídač daní z investic';

/** Popis služby jednou větou: výchozí `description`, náhled odkazu i JSON-LD. */
export const SITE_DESCRIPTION =
  'Hlídač daní z investic pro české investory: limit 100 000 Kč, paušální daň, tříleté časové testy a podklady k přiznání. Bezpečně a zdarma.';

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
  title: SITE_TITLE,
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
