import { analyzeForUserCached } from '@/lib/engine-cache';
import { EngineErrorCard, engineErrorMessage } from '@/lib/fx-error';
import { notFound, redirect } from 'next/navigation';
import { PositionView, positionHistory } from '@/components/views/position-view';
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
      // H-3-09: žádná transakce = stránka za chvíli skončí `notFound()`,
      // takže titulek nesmí tvrdit, že pozice existuje. Záložka jinak nese
      // ISIN, který uživatel nikdy neměl (a klidně cizí překlep z odkazu).
      if (rows.length === 0) return { title: 'Pozice nenalezena — Danero' };
      for (const row of rows) {
        const payload = row.payload as { ticker?: string; name?: string };
        const label = payload.ticker ?? payload.name;
        if (label) return { title: `${label} — Danero` };
      }
      return { title: `${isin} — Danero` };
    }
  } catch {
    // titulek nikdy nesmí shodit stránku — fallback níž
  }
  // nepřihlášený požadavek (stránka přesměruje na přihlášení) nebo výpadek DB
  return { title: 'Pozice — Danero' };
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
  let analysis;
  try {
    analysis = analyzeForUserCached(user.id, txs, profile, currentYear, today, dailyRates);
  } catch (error) {
    // chybějící kurz (EngineError) = srozumitelná karta, ne pád do error boundary
    const message = engineErrorMessage(error);
    if (!message) throw error;
    return <EngineErrorCard message={message} />;
  }

  const position = analysis.positions.find((p) => p.isin === isin);
  if (!position && positionHistory(txs, isin).length === 0) notFound();

  const prices = await loadInstrumentPrices(db, user.id);

  return <PositionView isin={isin} txs={txs} analysis={analysis} prices={prices} today={today} />;
}
