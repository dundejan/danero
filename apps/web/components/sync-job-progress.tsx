'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SyncProgress } from '@/lib/broker-sync';

/** Serializovaný stav jobu pro klienta (RSC → props i /api/jobs/latest). */
export interface SyncJobView {
  status: string;
  progress: SyncProgress | null;
}

const POLL_MS = 3_000;

const PHASE_LABELS: Record<SyncProgress['phase'], string> = {
  connecting: 'Připojuji se k Trading212…',
  exporting: 'Stahuji transakce…',
  reconciling: 'Porovnávám pozice s Trading212…',
};

/**
 * Živý průběh sync jobu jednoho broker účtu: polluje /api/jobs/latest, ukazuje
 * stav po letech a po dokončení obnoví stránku (výsledek pak ukazuje serverová
 * část /import).
 */
export function SyncJobProgress({
  initialJob,
  accountId,
}: {
  initialJob: SyncJobView;
  accountId: string;
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
        ? PHASE_LABELS[progress.phase]
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
          Trading212 může trvat i deset minut. Klidně odejdi, poběží dál.
        </p>
      )}
      {progress?.years && progress.years.length > 0 && (
        <ul className="space-y-1 border-t border-linka pt-2">
          {progress.years.map((year) => (
            <li key={year.year} className="flex items-baseline gap-3 font-mono text-xs">
              <span className="font-semibold text-inkoust">{year.year}</span>
              {year.status === 'running' ? (
                <span className="text-inkoust-tlumeny">Trading212 generuje export…</span>
              ) : year.status === 'empty' ? (
                <span className="text-inkoust-tlumeny">žádné transakce</span>
              ) : (
                <span className="text-zelena">
                  {year.added ?? 0} nových · {year.duplicates ?? 0} duplicit
                  {year.errors ? <span className="text-cervena"> · {year.errors} chyb</span> : null}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
