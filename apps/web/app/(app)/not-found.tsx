import Link from 'next/link';
import { AppState } from '@/components/app-state';
import { buttonVariants } from '@/components/ui/button';
import { TextLink } from '@/components/ui/link';

/**
 * 404 uvnitř přihlášené části (audit H2-03).
 *
 * Bez tohohle souboru spadl `notFound()` z aplikační stránky (typicky
 * `/portfolio/<cizí ISIN>`) až na kořenový `app/not-found.tsx`, který se
 * vykresluje marketingovým shellem — a ten se vložil DOVNITŘ aplikačního
 * layoutu. Výsledek: dva `<main>`, dvakrát `id="obsah"` (neplatné HTML,
 * skip-link mířil na dvojznačnou kotvu) a přihlášený uživatel dostal vedle
 * svého postranního panelu marketingová CTA „Přihlásit se“ a „Vyzkoušet demo“.
 *
 * Vnořený `not-found.tsx` se vykresluje uvnitř layoutu svého segmentu, takže
 * tenhle obsah sedí do `<main id="obsah">` z `(app)/layout.tsx` — panel
 * zůstane, landmarky jsou po jednom a cesta ven míří do aplikace.
 *
 * Žádný `<title>`: `not-found.tsx` nemá `generateMetadata` a `<title>`
 * v JSX se do hlavičky sice vloží, ale AŽ ZA titulek z `generateMetadata`
 * stránky, která `notFound()` vyhodila — prohlížeč bere ten první, takže by
 * tu jen přibyl třetí neplatný `<title>`. Titulek 404 musí vzniknout
 * v `generateMetadata` té stránky (audit H2-06).
 */
export default function AppNotFound() {
  return (
    <AppState
      title="Tahle stránka neexistuje"
      actions={
        <>
          <Link href="/prehled" className={buttonVariants()}>
            Přejít na přehled
          </Link>
          {/* nejčastější příčina: detail pozice, kterou evidence nezná */}
          <TextLink href="/import" chevron>
            Zdroje dat
          </TextLink>
        </>
      }
    >
      Odkaz se změnil, nebo pozice v evidenci chybí — historie se sem dostane až z výpisu nebo
      z napojeného účtu.
    </AppState>
  );
}
