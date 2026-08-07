import { notFound } from 'next/navigation';
import { PositionView, positionHistory } from '@/components/views/position-view';
import { demoDataset, demoToday, DEMO_USER_ID } from '@/lib/demo-data';
import { analyzeForUserCached } from '@/lib/engine-cache';
import { instrumentLabels } from '@/lib/portfolio';

export const dynamic = 'force-dynamic';

/** Titulek z demo popisků (ticker/název); fallback na identifikátor. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ isin: string }>;
}): Promise<{ title: string }> {
  const { isin: rawIsin } = await params;
  const isin = decodeURIComponent(rawIsin).toUpperCase();
  const { txs } = demoDataset(demoToday());
  const label = instrumentLabels(txs).get(isin) ?? isin;
  return { title: `Demo: ${label} — Danero` };
}

export default async function DemoPositionDetailPage({
  params,
}: {
  params: Promise<{ isin: string }>;
}) {
  // bez ISIN regexu — demo obsahuje i krypto ('BTC'); existence se ověřuje z dat
  const { isin: rawIsin } = await params;
  const isin = decodeURIComponent(rawIsin).toUpperCase();

  const today = demoToday();
  const { txs, profile, prices } = demoDataset(today);
  const currentYear = Number(today.slice(0, 4));
  const analysis = analyzeForUserCached(DEMO_USER_ID, txs, profile, currentYear, today);

  const position = analysis.positions.find((p) => p.isin === isin);
  if (!position && positionHistory(txs, isin).length === 0) notFound();

  return (
    <PositionView
      isin={isin}
      txs={txs}
      analysis={analysis}
      prices={prices}
      today={today}
      basePath="/demo"
    />
  );
}
