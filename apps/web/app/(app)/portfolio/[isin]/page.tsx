import { analyzeForUserCached } from '@/lib/engine-cache';
import { notFound, redirect } from 'next/navigation';
import { PoziceView, positionHistory } from '@/components/views/pozice-view';
import { getDb } from '@/db';
import { dailyRatesForProfile, getProfile, loadTransactions } from '@/lib/portfolio';
import { loadInstrumentPrices } from '@/lib/prices';
import { requireUser } from '@/lib/session';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { getAuth } from '@/lib/auth';
import { transactions } from '@/db/schema';

/** Titulek s labelem instrumentu (ticker/název z transakcí), fallback ISIN. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ isin: string }>;
}): Promise<{ title: string }> {
  const { isin: rawIsin } = await params;
  const isin = decodeURIComponent(rawIsin).toUpperCase();
  try {
    const requestHeaders = await headers();
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (session) {
      const db = await getDb();
      const rows = await db
        .select({ payload: transactions.payload })
        .from(transactions)
        .where(and(eq(transactions.userId, session.user.id), eq(transactions.isin, isin)))
        .limit(20);
      for (const row of rows) {
        const payload = row.payload as { ticker?: string; name?: string };
        const label = payload.ticker ?? payload.name;
        if (label) return { title: `${label} — Danero` };
      }
    }
  } catch {
    // titulek nikdy nesmí shodit stránku — fallback na ISIN níže
  }
  return { title: `${isin} — Danero` };
}

export default async function PositionDetailPage({
  params,
}: {
  params: Promise<{ isin: string }>;
}) {
  const { isin: rawIsin } = await params;
  const isin = decodeURIComponent(rawIsin).toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) notFound();

  const user = await requireUser();
  const db = await getDb();
  const profile = await getProfile(db, user.id);
  if (!profile) redirect('/nastaveni');

  const txs = await loadTransactions(db, user.id);
  const today = new Date().toISOString().slice(0, 10);
  const currentYear = Number(today.slice(0, 4));
  const dailyRates = await dailyRatesForProfile(db, txs, profile, currentYear);
  const analysis = analyzeForUserCached(user.id, txs, profile, currentYear, today, dailyRates);

  const position = analysis.positions.find((p) => p.isin === isin);
  if (!position && positionHistory(txs, isin).length === 0) notFound();

  const prices = await loadInstrumentPrices(db, user.id);

  return <PoziceView isin={isin} txs={txs} analysis={analysis} prices={prices} today={today} />;
}
