import { SimulatorView, type SimParams } from '@/components/views/simulator-view';
import { demoDataset, demoToday } from '@/lib/demo-data';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Demo: Simulátor prodeje — Danero' };

export default async function DemoSimulatorPage({
  searchParams,
}: {
  searchParams: Promise<SimParams>;
}) {
  const today = demoToday();
  const { txs, profile } = demoDataset(today);
  const params = await searchParams;

  return (
    <SimulatorView txs={txs} profile={profile} today={today} params={params} basePath="/demo" />
  );
}
