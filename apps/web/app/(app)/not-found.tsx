import Link from 'next/link';

/**
 * 404 uvnitř přihlášené části (audit H2-03).
 *
 * Bez tohohle souboru spadl `notFound()` z aplikační stránky (typicky
 * `/portfolio/<cizí ISIN>`) až na kořenový `app/not-found.tsx`, který se
 * vykresluje marketingovým shellem — a ten se vložil DOVNITŘ aplikačního
 * layoutu. Výsledek: dva `<main>`, dvakrát `id="obsah"` (neplatné HTML,
 * skip-link mířil na dvojznačnou kotvu) a přihlášený uživatel dostal vedle
 * svého navigačního railu marketingová CTA „Přihlásit se“ a „Vyzkoušet demo“.
 *
 * Vnořený `not-found.tsx` se vykresluje uvnitř layoutu svého segmentu, takže
 * tenhle obsah sedí do `<main id="obsah">` z `(app)/layout.tsx` — rail zůstane,
 * landmarky jsou po jednom a rozcestník míří do aplikace, ne na marketing.
 */
export default function AppNotFound() {
  return (
    <div className="max-w-xl pt-12">
      {/* Žádný `<title>`: `not-found.tsx` nemá `generateMetadata` a `<title>`
          v JSX se do hlavičky sice vloží, ale AŽ ZA titulek z `generateMetadata`
          stránky, která `notFound()` vyhodila — prohlížeč bere ten první,
          takže by tu jen přibyl třetí neplatný `<title>`. Titulek 404 musí
          vzniknout v `generateMetadata` té stránky (audit H2-06). */}
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova-text">
        Chyba 404
      </p>
      <h1 className="mt-3 text-balance font-display text-3xl font-bold leading-tight tracking-tight">
        Tahle stránka neexistuje
      </h1>
      <p className="mt-4 text-inkoust-tlumeny">
        Buď se odkaz změnil, nebo v adrese něco přebývá. Pokud jsi mířil na detail pozice,
        kterou v evidenci nemáš, může chybět import — historie se do Danera dostane až
        z výpisu nebo z napojeného účtu.
      </p>
      <ul className="mt-6 space-y-2 text-inkoust-tlumeny">
        <li>
          <Link
            href="/prehled"
            className="font-medium text-ruzova-text underline underline-offset-2"
          >
            Přehled
          </Link>{' '}
          — limity, termíny a co tě letos čeká
        </li>
        <li>
          <Link
            href="/portfolio"
            className="font-medium text-ruzova-text underline underline-offset-2"
          >
            Portfolio
          </Link>{' '}
          — všechny pozice, které Danero eviduje
        </li>
        <li>
          <Link
            href="/import"
            className="font-medium text-ruzova-text underline underline-offset-2"
          >
            Zdroje dat
          </Link>{' '}
          — nahrát výpis nebo napojit účet u brokera
        </li>
      </ul>
    </div>
  );
}
