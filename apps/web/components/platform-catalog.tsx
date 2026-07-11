import Link from 'next/link';
import {
  PLATFORM_GROUPS,
  PLATFORMS,
  UNIVERSAL_INFO,
  type PlatformInfo,
} from '@/lib/brokers-catalog';

/**
 * Monogramová dlaždice platformy — jednotný vizuál místo cizích log (CSP self,
 * ochranné známky). Barva je orientační barva značky; `ink: 'dark'` řeší
 * světlé dlaždice (žlutá RB).
 */
export function PlatformTile({
  platform,
  className = 'h-8 w-8 text-xs',
}: {
  platform: Pick<PlatformInfo, 'name' | 'color' | 'ink' | 'monogram'>;
  className?: string;
}) {
  const monogram = platform.monogram ?? platform.name.slice(0, 1).toUpperCase();
  return (
    <span
      aria-hidden
      className={`flex shrink-0 select-none items-center justify-center rounded-md font-mono font-bold ring-1 ring-inset ring-inkoust/10 dark:ring-white/20 ${
        platform.ink === 'dark' ? 'text-black/80' : 'text-white'
      } ${className}`}
      style={{ backgroundColor: platform.color }}
    >
      {monogram}
    </span>
  );
}

/** Kompaktní mřížka pro landing: dlaždice + jméno, u živých API štítek. */
export function PlatformGrid() {
  const ordered = [...PLATFORMS].sort((a, b) =>
    a.method === 'api' && b.method !== 'api' ? -1 : b.method === 'api' && a.method !== 'api' ? 1 : 0,
  );
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {ordered.map((platform) => (
        <li
          key={platform.id}
          className="flex items-center gap-2.5 rounded-lg border border-linka bg-plocha px-3 py-2.5"
        >
          <PlatformTile platform={platform} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{platform.name}</span>
            {platform.method === 'api' && (
              <span className="font-mono text-[11px] font-semibold text-ruzova">
                {METHOD_BADGE.api.label}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

const METHOD_BADGE: Record<PlatformInfo['method'], { label: string; className: string }> = {
  api: { label: 'živě přes API', className: 'bg-ruzova/10 text-ruzova font-semibold' },
  file: { label: 'výpis — poznáme sami', className: 'bg-pozadi text-inkoust-tlumeny' },
  template: { label: 'výpis přes šablonu', className: 'bg-pozadi text-inkoust-tlumeny' },
};

/** Plný katalog pro Zdroje dat: skupiny → rozbalovací návod per platforma. */
export function PlatformCatalog() {
  return (
    <div className="space-y-5">
      {PLATFORM_GROUPS.map((group) => (
        <div key={group.key}>
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wide text-inkoust-tlumeny">
            {group.label}
          </h3>
          <ul className="mt-2 divide-y divide-linka/60">
            {PLATFORMS.filter((platform) => platform.group === group.key).map((platform) => (
              <li key={platform.id}>
                <details className="group py-1.5">
                  <summary className="flex cursor-pointer list-none items-center gap-3 py-1 [&::-webkit-details-marker]:hidden">
                    <PlatformTile platform={platform} className="h-7 w-7 text-[11px]" />
                    <span className="flex-1 text-sm font-medium">{platform.name}</span>
                    {platform.formats && (
                      <span className="hidden font-mono text-[11px] text-inkoust-tlumeny sm:inline">
                        {platform.formats}
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${METHOD_BADGE[platform.method].className}`}
                    >
                      {METHOD_BADGE[platform.method].label}
                    </span>
                    <span
                      aria-hidden
                      className="text-inkoust-tlumeny transition-transform group-open:rotate-90"
                    >
                      ›
                    </span>
                  </summary>
                  <div className="space-y-1.5 pb-2 pl-10 text-sm text-inkoust-tlumeny">
                    <p>{platform.guide}</p>
                    {platform.method === 'template' && (
                      <p>
                        Stažený výpis přepiš do{' '}
                        <a href="/api/sablona" className="font-medium text-ruzova" download>
                          univerzální šablony
                        </a>{' '}
                        (formát je popsaný přímo v souboru) a nahraj ji tady. Vlastní čtečku
                        tohohle výpisu připravujeme — pošli nám anonymizovaný vzorek na{' '}
                        <a href="mailto:podpora@danero.cz" className="font-medium text-ruzova">
                          podpora@danero.cz
                        </a>{' '}
                        a bude to rychlejší.
                      </p>
                    )}
                    {platform.method === 'api' && (
                      <p>
                        Napojení nastavíš v{' '}
                        <Link
                          href={platform.connectAnchor ?? '#trading212'}
                          className="font-medium text-ruzova"
                        >
                          kartě výš na této stránce
                        </Link>
                        .
                      </p>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="text-sm text-inkoust-tlumeny">
        <strong className="text-inkoust">{UNIVERSAL_INFO.name}:</strong> {UNIVERSAL_INFO.guide}{' '}
        <a href="/api/sablona" className="font-medium text-ruzova" download>
          Stáhnout šablonu
        </a>
        . Opakované nahrání nic nezdvojí — deduplikace je součástí importu a funguje i napříč
        soubory.
      </p>
    </div>
  );
}
