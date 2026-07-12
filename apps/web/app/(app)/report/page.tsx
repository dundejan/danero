import { redirect } from 'next/navigation';
import { analyzeTaxYear, compareVariants } from '@danero/engine';
import { ReportView } from '@/components/views/report-view';
import { EngineErrorCard, engineErrorMessage } from '@/lib/fx-error';
import { getDb } from '@/db';
import {
  availableYears,
  engineInputForUser,
  getProfile,
  loadDailyRates,
  loadTransactions,
} from '@/lib/portfolio';
import { requireUser } from '@/lib/session';
import { firstParam } from '@/lib/utils';

export const metadata = { title: 'Daňový report — Danero' };

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string | string[] }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const profile = await getProfile(db, user.id);
  if (!profile) redirect('/nastaveni');

  const txs = await loadTransactions(db, user.id);
  if (txs.length === 0) redirect('/prehled');

  const currentYear = Number(new Date().toISOString().slice(0, 4)); // UTC, konzistentně s today
  const years = availableYears(txs, currentYear);
  const rok = firstParam((await searchParams).rok);
  const year = years.includes(Number(rok)) ? Number(rok) : currentYear;

  // denní kurzy ČNB (R-06b): s nimi srovnání variant zahrnuje jednotný × denní
  const dailyRates = await loadDailyRates(db, txs, currentYear);

  // EngineError (chybějící kurz) chytáme tady — pád ve view by skončil
  // v generickém error boundary; výsledky se předávají dál (žádný dvojí běh)
  let precomputed: { result: ReturnType<typeof analyzeTaxYear>; comparison: ReturnType<typeof compareVariants> };
  try {
    const input = engineInputForUser(txs, profile, year, dailyRates);
    precomputed = { result: analyzeTaxYear(input), comparison: compareVariants(input) };
  } catch (error) {
    const message = engineErrorMessage(error);
    if (!message) throw error;
    return <EngineErrorCard message={message} />;
  }

  return (
    <ReportView
      txs={txs}
      profile={profile}
      year={year}
      years={years}
      dailyRates={dailyRates}
      precomputed={precomputed}
    />
  );
}
