import { PrehledView, type PrehledNotification } from '@/components/views/prehled-view';
import { demoDataset, demoToday, DEMO_USER_ID } from '@/lib/demo-data';
import { analyzeForUserCached } from '@/lib/engine-cache';
import { computeNotificationCandidates } from '@/lib/notifications';
import { availableYears } from '@/lib/portfolio';
import { firstParam } from '@/lib/utils';

// „dnešek" dema se odvíjí od skutečného data — žádný prerender při buildu
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Demo: Přehled — Danero' };

export default async function DemoPrehledPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string | string[] }>;
}) {
  const today = demoToday();
  const { txs, profile, prices } = demoDataset(today);

  const currentYear = Number(today.slice(0, 4));
  const years = availableYears(txs, currentYear);
  const rok = firstParam((await searchParams).rok);
  const year = years.includes(Number(rok)) ? Number(rok) : currentYear;
  const analysis = analyzeForUserCached(DEMO_USER_ID, txs, profile, year, today);

  // „Poslední upozornění" v demu: kandidáti hlídače nad demo výsledkem —
  // stejná čistá funkce, kterou plní reálné notifikace (jen bez DB)
  const notifications: PrehledNotification[] = computeNotificationCandidates({
    result: analysis.result,
    positions: analysis.positions,
    labels: analysis.labels,
    today,
  })
    .slice(0, 5)
    .map((candidate) => ({ ...candidate, createdAt: new Date(`${today}T00:00:00Z`) }));

  return (
    <PrehledView
      txs={txs}
      analysis={analysis}
      prices={prices}
      years={years}
      year={year}
      today={today}
      notifications={notifications}
      basePath="/demo"
    />
  );
}
