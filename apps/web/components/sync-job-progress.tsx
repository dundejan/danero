'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SyncProgress } from '@/lib/broker-sync';
import { plural } from '@/lib/format';

/** Serializovaný stav jobu pro klienta (RSC → props i /api/jobs/latest). */
export interface SyncJobView {
  status: string;
  progress: SyncProgress | null;
}

const POLL_MS = 3_000;

/** Popisek fáze s názvem brokera (bez něj obecný pád „brokerovi/brokerem“). */
const phaseText = (phase: SyncProgress['phase'], broker?: string): string => {
  switch (phase) {
    case 'connecting':
      return `Připojuji se k ${broker ?? 'brokerovi'}…`;
    case 'exporting':
      return 'Stahuji transakce…';
    case 'reconciling':
      return `Porovnávám pozice s ${broker ?? 'brokerem'}…`;
  }
};

/**
 * Živý průběh sync jobu jednoho účtu u brokera: polluje /api/jobs/latest,
 * ukazuje stav po letech a po dokončení obnoví stránku (výsledek pak ukazuje
 * serverová část /import).
 */
export function SyncJobProgress({
  initialJob,
  accountId,
  broker,
}: {
  initialJob: SyncJobView;
  accountId: string;
  /** Název brokera pro texty fází (např. „Trading 212“). */
  broker?: string;
}) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);

  const active = job.status === 'pending' || job.status === 'running';

  useEffect(() => {
    if (!active) {
      // hotovo — server ví víc (rekonciliace, historie importů), překreslíme RSC
      router.refresh();
      return;
    }
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/latest?account=${encodeURIComponent(accountId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { job: SyncJobView | null };
        if (data.job) setJob(data.job);
      } catch {
        // výpadek pollingu není chyba syncu — příští tick to zkusí znovu
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, router, accountId]);

  const progress = job.progress;
  const phaseLabel =
    job.status === 'pending'
      ? 'Synchronizace čeká ve frontě…'
      : progress
        ? phaseText(progress.phase, broker)
        : 'Synchronizace běží…';

  return (
    <div className="space-y-2" aria-live="polite">
      <p className="flex items-center gap-2 text-sm font-medium text-inkoust">
        <span className="inline-block size-2 animate-pulse rounded-full bg-ruzova" aria-hidden />
        {phaseLabel}
      </p>
      {progress?.mode === 'full' && (
        <p className="text-xs text-inkoust-tlumeny">
          První synchronizace prochází všechny roky od založení účtu — kvůli limitům
          Trading 212 může trvat i deset minut. Klidně odejdi, poběží dál.
        </p>
      )}
      {progress?.years && progress.years.length > 0 && (
        <ul className="space-y-1 border-t border-linka pt-2">
          {progress.years.map((year) => (
            <li key={year.year} className="flex items-baseline gap-3 font-mono text-xs">
              <span className="font-semibold text-inkoust">{year.year}</span>
              {year.status === 'running' ? (
                <span className="text-inkoust-tlumeny">Trading 212 generuje export…</span>
              ) : year.status === 'empty' ? (
                <span className="text-inkoust-tlumeny">žádné transakce</span>
              ) : (
                <span className="text-zelena">
                  {year.added ?? 0} {plural(year.added ?? 0, 'nová', 'nové', 'nových')} ·{' '}
                  {year.duplicates ?? 0} {plural(year.duplicates ?? 0, 'duplicita', 'duplicity', 'duplicit')}
                  {year.errors ? (
                    <span className="text-cervena">
                      {' '}· {year.errors} {plural(year.errors, 'chyba', 'chyby', 'chyb')}
                    </span>
                  ) : null}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
