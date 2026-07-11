import { redirect } from 'next/navigation';
import { SimulatorView, type SimParams } from '@/components/views/simulator-view';
import { getDb } from '@/db';
import { dailyRatesForProfile, getProfile, loadTransactions } from '@/lib/portfolio';
import { loadInstrumentPrices } from '@/lib/prices';
import { requireUser } from '@/lib/session';

export const metadata = { title: 'Simulátor prodeje — Danero' };

export default async function SimulatorPage({
  searchParams,
}: {
  searchParams: Promise<SimParams>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const profile = await getProfile(db, user.id);
  if (!profile) redirect('/nastaveni');

  const txs = await loadTransactions(db, user.id);
  if (txs.length === 0) redirect('/prehled');

  const today = new Date().toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4)); // rok z téhož okamžiku (UTC) jako today
  const dailyRates = await dailyRatesForProfile(db, txs, profile, year);
  const prices = await loadInstrumentPrices(db, user.id);
  const params = await searchParams;

  return (
    <SimulatorView
      txs={txs}
      profile={profile}
      today={today}
      params={params}
      dailyRates={dailyRates}
      prices={prices}
    />
  );
}
