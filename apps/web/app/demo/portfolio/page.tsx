import { PortfolioView } from '@/components/views/portfolio-view';
import { demoDataset, demoToday, DEMO_USER_ID } from '@/lib/demo-data';
import { analyzeForUserCached } from '@/lib/engine-cache';
import { availableYears } from '@/lib/portfolio';
import { firstParam, resolveTaxYear } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Demo: Portfolio — Danero' };

export default async function DemoPortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string | string[] }>;
}) {
  const today = demoToday();
  const { txs, profile, prices } = demoDataset(today);

  const currentYear = Number(today.slice(0, 4));
  const years = availableYears(txs, currentYear);
  const rok = firstParam((await searchParams).rok);
  const year = resolveTaxYear(rok, years, currentYear, '/demo/portfolio');
  const analysis = analyzeForUserCached(DEMO_USER_ID, txs, profile, year, today);

  return (
    <PortfolioView
      txs={txs}
      profile={profile}
      analysis={analysis}
      prices={prices}
      years={years}
      year={year}
      today={today}
      basePath="/demo"
    />
  );
}
