import Link from 'next/link';

/**
 * 404 v demo prohlídce (audit H2-03) — stejný důvod jako u `(app)/not-found.tsx`:
 * bez něj se `notFound()` z demo stránky vykreslil marketingovým shellem uvnitř
 * demo layoutu (dva `<main>`, dvě `id="obsah"`). Rozcestník míří zpátky do dema,
 * ne na marketing — návštěvník je uprostřed prohlídky.
 */
export default function DemoNotFound() {
  return (
    <div className="max-w-xl pt-12">
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova-text">
        Chyba 404
      </p>
      <h1 className="mt-3 text-balance font-display text-3xl font-bold leading-tight tracking-tight">
        Tahle stránka v ukázce není
      </h1>
      <p className="mt-4 text-inkoust-tlumeny">
        Demo běží nad pevným ukázkovým portfoliem, takže adresa mimo něj nikam nevede.
        Zkus se vrátit do prohlídky:
      </p>
      <ul className="mt-6 space-y-2 text-inkoust-tlumeny">
        <li>
          <Link
            href="/demo/prehled"
            className="font-medium text-ruzova-text underline underline-offset-2"
          >
            Přehled
          </Link>{' '}
          — limity, termíny a orientační daň
        </li>
        <li>
          <Link
            href="/demo/portfolio"
            className="font-medium text-ruzova-text underline underline-offset-2"
          >
            Portfolio
          </Link>{' '}
          — ukázkové pozice i jejich časové testy
        </li>
        <li>
          <Link
            href="/registrace"
            className="font-medium text-ruzova-text underline underline-offset-2"
          >
            Založit účet zdarma
          </Link>{' '}
          — a počítat nad vlastními daty
        </li>
      </ul>
    </div>
  );
}
