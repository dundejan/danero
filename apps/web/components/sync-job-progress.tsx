'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Group, Row } from '@/components/ui/list';
import type { SyncProgress, SyncYearProgress } from '@/lib/broker-sync';
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
 * Ukazatel běžící práce: tiché šedé kolečko. Barvu stavu nenese (nic se
 * nestalo, jen se pracuje) a akcentní modrá patří ovládání. S omezeným
 * pohybem se netočí, jen pomalu pulzuje.
 */
function Spinner() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className="size-4 shrink-0 animate-spin text-ink-muted motion-reduce:animate-pulse"
    >
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
      <path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Co se s jedním rokem stalo — stejná slova jako souhrn dávky v historii. */
function YearResult({ year }: { year: SyncYearProgress }) {
  if (year.status === 'running') {
    return <span className="text-ink-muted">generuje se export…</span>;
  }
  if (year.status === 'empty') {
    return <span className="text-ink-muted">žádné transakce</span>;
  }
  const added = year.added ?? 0;
  const duplicates = year.duplicates ?? 0;
  return (
    <>
      {added} {plural(added, 'nová', 'nové', 'nových')} · {duplicates}{' '}
      {plural(duplicates, 'duplicita', 'duplicity', 'duplicit')}
      {year.errors ? (
        <span className="text-danger">
          {' '}
          · {year.errors} {plural(year.errors, 'chyba', 'chyby', 'chyb')}
        </span>
      ) : null}
    </>
  );
}

/**
 * Živý průběh sync jobu jednoho účtu u brokera: polluje /api/jobs/latest,
 * ukazuje stav po letech a po dokončení obnoví stránku (výsledek pak ukazuje
 * serverová část /import).
 *
 * Je to klidná obrazovka: jedna věta o tom, co se právě děje, jedna o tom,
 * co čekat (`hint`), a pod nimi roky. Čtečce se hlásí jen změna fáze — seznam
 * let se mění každých pár vteřin a předčítat ho celý by rušilo.
 */
export function SyncJobProgress({
  initialJob,
  accountId,
  broker,
  hint,
}: {
  initialJob: SyncJobView;
  accountId: string;
  /** Název brokera pro texty fází (např. „Trading 212“). */
  broker?: string;
  /** Jedna věta o tom, co čekat (jak dlouho to trvá, že jde odejít). */
  hint?: string;
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
  // čekající job s průběhem = plná historie, která se stahuje po částech
  // a právě je mezi nimi (lib/jobs.ts, `pauseJob`)
  const betweenParts = job.status === 'pending' && Boolean(progress?.years?.length);
  const phaseLabel =
    job.status === 'pending'
      ? betweenParts
        ? 'Navazuji další částí historie…'
        : 'Synchronizace čeká ve frontě…'
      : progress
        ? phaseText(progress.phase, broker)
        : 'Synchronizace běží…';

  return (
    <div>
      <p role="status" className="type-callout flex items-center gap-2 font-medium">
        <Spinner />
        {phaseLabel}
      </p>
      {hint && <p className="type-footnote mt-1.5 text-pretty text-ink-muted">{hint}</p>}
      {progress?.years && progress.years.length > 0 && (
        <Group className="mt-3" aria-label="Průběh po letech">
          {progress.years.map((year) => (
            <Row key={year.year} label={year.year} className="type-callout">
              <YearResult year={year} />
            </Row>
          ))}
        </Group>
      )}
    </div>
  );
}
