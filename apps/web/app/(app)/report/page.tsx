import { redirect } from 'next/navigation';
import { ReportView } from '@/components/views/report-view';
import { getDb } from '@/db';
import {
  availableYears,
  getProfile,
  loadDailyRates,
  loadTransactions,
} from '@/lib/portfolio';
import { requireUser } from '@/lib/session';

export const metadata = { title: 'Daňový report — Danero' };

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const profile = await getProfile(db, user.id);
  if (!profile) redirect('/nastaveni');

  const txs = await loadTransactions(db, user.id);
  if (txs.length === 0) redirect('/prehled');

  const currentYear = Number(new Date().toISOString().slice(0, 4)); // UTC, konzistentně s today
  const years = availableYears(txs, currentYear);
  const { rok } = await searchParams;
  const year = years.includes(Number(rok)) ? Number(rok) : currentYear;

  // denní kurzy ČNB (R-06b): s nimi srovnání variant zahrnuje jednotný × denní
  const dailyRates = await loadDailyRates(db, txs, currentYear);

  return (
    <ReportView txs={txs} profile={profile} year={year} years={years} dailyRates={dailyRates} />
  );
}
