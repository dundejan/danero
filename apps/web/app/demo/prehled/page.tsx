import { OverviewView, type OverviewNotification } from '@/components/views/overview-view';
import { demoDataset, demoToday, DEMO_USER_ID } from '@/lib/demo-data';
import { analyzeForUserCached } from '@/lib/engine-cache';
import { computeNotificationCandidates } from '@/lib/notifications';
import { availableYears } from '@/lib/portfolio';
import { firstParam, resolveTaxYear } from '@/lib/utils';

// „dnešek“ dema se odvíjí od skutečného data — žádný prerender při buildu
export const dynamic = 'force-dynamic';

/**
 * Jediná stránka dema, která má být ve vyhledávání (a v sitemapě): vstup do
 * prohlídky. Vlastní popis proto, aby ve výsledcích nestál obecný popis webu;
 * ostatní podstránky dema mají `noindex` (smyšlená čísla mimo AI odpovědi).
 */
export const metadata = {
  title: 'Demo: Přehled — Danero',
  description:
    'Ukázka Danera nad smyšleným portfoliem: limit 100 000 Kč, limit paušální daně, tříleté časové testy a upozornění. Bez registrace, nic se neukládá.',
};

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
  const year = resolveTaxYear(rok, years, currentYear, '/demo/prehled');
  const analysis = analyzeForUserCached(DEMO_USER_ID, txs, profile, year, today);

  // „Poslední upozornění“ v demu: kandidáti hlídače nad demo výsledkem —
  // stejná čistá funkce, kterou plní reálné notifikace (jen bez DB)
  const notifications: OverviewNotification[] = computeNotificationCandidates({
    result: analysis.result,
    positions: analysis.positions,
    labels: analysis.labels,
    today,
  })
    .slice(0, 5)
    .map((candidate) => ({ ...candidate, createdAt: new Date(`${today}T00:00:00Z`) }));

  return (
    <OverviewView
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
