import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PortfolioView } from '@/components/views/portfolio-view';
import { getDb } from '@/db';
import { analyzeForUserCached } from '@/lib/engine-cache';
import {
  availableYears,
  dailyRatesForProfile,
  getProfile,
  loadTransactions,
} from '@/lib/portfolio';
import { loadInstrumentPrices } from '@/lib/prices';
import { requireUser } from '@/lib/session';

export const metadata = { title: 'Portfolio — Danero' };

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const profile = await getProfile(db, user.id);
  if (!profile) redirect('/nastaveni');

  const txs = await loadTransactions(db, user.id);
  if (txs.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="font-display text-3xl font-bold">Portfolio</h1>
        <p className="text-sm text-inkoust-tlumeny">
          Zatím žádná data —{' '}
          <Link href="/import" className="font-medium text-ruzova">
            naimportuj výpisy
          </Link>{' '}
          a Danero ukáže hodnotu portfolia, dividendy i výhled osvobozování.
        </p>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const currentYear = Number(today.slice(0, 4));
  const years = availableYears(txs, currentYear);
  const { rok } = await searchParams;
  const year = years.includes(Number(rok)) ? Number(rok) : currentYear;

  const dailyRates = await dailyRatesForProfile(db, txs, profile, currentYear);
  const analysis = analyzeForUserCached(user.id, txs, profile, year, today, dailyRates);
  const prices = await loadInstrumentPrices(db, user.id);

  return (
    <PortfolioView
      txs={txs}
      profile={profile}
      analysis={analysis}
      prices={prices}
      years={years}
      year={year}
      today={today}
      dailyRates={dailyRates}
    />
  );
}
