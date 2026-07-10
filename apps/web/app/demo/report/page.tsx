import { ReportView } from '@/components/views/report-view';
import { demoDataset, demoToday } from '@/lib/demo-data';
import { availableYears } from '@/lib/portfolio';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Demo: Daňový report — Danero' };

export default async function DemoReportPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string }>;
}) {
  const today = demoToday();
  const { txs, profile } = demoDataset(today);

  const currentYear = Number(today.slice(0, 4));
  const years = availableYears(txs, currentYear);
  const { rok } = await searchParams;
  const year = years.includes(Number(rok)) ? Number(rok) : currentYear;

  return (
    <ReportView txs={txs} profile={profile} year={year} years={years} basePath="/demo" demo />
  );
}
