import { ReportView } from '@/components/views/report-view';
import { demoDataset, demoToday } from '@/lib/demo-data';
import { availableYears } from '@/lib/portfolio';
import { firstParam } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Demo: Daňový report — Danero' };

export default async function DemoReportPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string | string[] }>;
}) {
  const today = demoToday();
  // syntetické denní kurzy → srovnání variant je kompletní jako v reálném reportu
  const { txs, profile, dailyRates } = demoDataset(today);

  const currentYear = Number(today.slice(0, 4));
  const years = availableYears(txs, currentYear);
  const rok = firstParam((await searchParams).rok);
  const year = years.includes(Number(rok)) ? Number(rok) : currentYear;

  return (
    <ReportView
      txs={txs}
      profile={profile}
      year={year}
      years={years}
      dailyRates={dailyRates}
      basePath="/demo"
      demo
    />
  );
}
