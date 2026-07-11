import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { notifications } from '@/db/schema';
import { PrehledView } from '@/components/views/prehled-view';
import { getDb } from '@/db';
import { loadInstrumentPrices } from '@/lib/prices';
import { analyzeForUserCached } from '@/lib/engine-cache';
import {
  availableYears,
  dailyRatesForProfile,
  getProfile,
  loadTransactions,
} from '@/lib/portfolio';
import { requireUser } from '@/lib/session';
import { firstParam } from '@/lib/utils';

export const metadata = { title: 'Přehled — Danero' };

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string | string[] }>;
}) {
  const user = await requireUser();
  const db = await getDb();

  const profile = await getProfile(db, user.id);
  if (!profile) redirect('/nastaveni');

  const txs = await loadTransactions(db, user.id);
  if (txs.length === 0) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-start gap-4 pt-24">
        <h1 className="font-display text-3xl font-bold">Zatím žádná data</h1>
        <p className="text-inkoust-tlumeny">
          Připoj brokera nebo nahraj výpis a Danero pohlídá zbytek — časové testy, limity i podklady
          k přiznání.
        </p>
        <Link
          href="/vitejte"
          className="rounded-md bg-ruzova-syta px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Otevřít průvodce
        </Link>
      </div>
    );
  }

  const recentNotifications = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(5);

  const today = new Date().toISOString().slice(0, 10);
  const currentYear = Number(today.slice(0, 4)); // rok z téhož okamžiku (UTC) jako today
  const years = availableYears(txs, currentYear);
  const rok = firstParam((await searchParams).rok);
  const year = years.includes(Number(rok)) ? Number(rok) : currentYear;
  const dailyRates = await dailyRatesForProfile(db, txs, profile, currentYear);
  const analysis = analyzeForUserCached(user.id, txs, profile, year, today, dailyRates);
  const prices = await loadInstrumentPrices(db, user.id);

  return (
    <PrehledView
      txs={txs}
      analysis={analysis}
      prices={prices}
      years={years}
      year={year}
      today={today}
      notifications={recentNotifications}
    />
  );
}
