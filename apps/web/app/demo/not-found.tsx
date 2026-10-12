import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { TextLink } from '@/components/ui/link';

/**
 * 404 v demo prohlídce (audit H2-03) — stejný důvod jako u `(app)/not-found.tsx`:
 * bez něj se `notFound()` z demo stránky vykreslil marketingovým shellem uvnitř
 * demo layoutu (dva `<main>`, dvě `id="obsah"`). Cesta ven míří zpátky do dema,
 * ne na marketing — návštěvník je uprostřed prohlídky.
 */
export default function DemoNotFound() {
  return (
    <EmptyState
      headingAs="h1"
      title="Tahle stránka v ukázce není"
      action={
        <>
          <Link href="/demo/prehled" className={buttonVariants()}>
            Zpět do ukázky
          </Link>
          <TextLink href="/demo/portfolio" chevron>
            Portfolio
          </TextLink>
        </>
      }
    >
      Demo běží nad pevným ukázkovým portfoliem, takže adresa mimo něj nikam nevede.
    </EmptyState>
  );
}
