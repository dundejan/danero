import Link from 'next/link';
import { MarketingPage } from '@/components/marketing-page';

/** Česká 404 v marketingovém shellu — žádný mrtvý konec bez navigace. */
export default function NotFound() {
  return (
    <MarketingPage>
      <title>Stránka nenalezena — Danero</title>
      <div className="py-24 md:py-32">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova-text">
          Chyba 404
        </p>
        <h1 className="mt-3 max-w-2xl text-balance font-display text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
          Tahle stránka neexistuje
        </h1>
        <p className="mt-5 max-w-xl text-lg text-inkoust-tlumeny">
          Buď se odkaz změnil, nebo v adrese něco přebývá. Nejspíš hledáš jedno z tohohle:
        </p>
        <ul className="mt-6 space-y-2 text-inkoust-tlumeny">
          <li>
            <Link href="/" className="font-medium text-ruzova-text underline underline-offset-2">
              Úvodní stránka
            </Link>{' '}
            — co Danero hlídá a jak funguje
          </li>
          <li>
            <Link
              href="/platformy"
              className="font-medium text-ruzova-text underline underline-offset-2"
            >
              Platformy
            </Link>{' '}
            — podporovaní brokeři a návody k výpisům
          </li>
          <li>
            <Link
              href="/kalkulacka"
              className="font-medium text-ruzova-text underline underline-offset-2"
            >
              Kalkulačka
            </Link>{' '}
            — musíš kvůli investicím podat přiznání?
          </li>
        </ul>
        <div className="mt-10">
          <Link
            href="/demo/prehled"
            className="inline-block rounded-md bg-ruzova-syta px-6 py-3 font-semibold text-white hover:opacity-90"
          >
            Vyzkoušet demo — bez registrace
          </Link>
        </div>
      </div>
    </MarketingPage>
  );
}
