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

/**
 * Kompaktní mřížka pro landing: dlaždice + jméno, u živých API štítek.
 * `limit` ukáže jen nejznámější platformy a zbytek shrne dlaždicí s odkazem
 * na /platformy — plný výčet na landingu jen natahoval stránku.
 */
const GRID_PRIORITY = [
  'trading212',
  'ibkr',
  'lynx',
  'xtb',
  'degiro',
  'etoro',
  'portu',
  'coinbase',
  'kraken',
];

export function PlatformGrid({ limit }: { limit?: number }) {
  // kurátorské pořadí: živá API první, pak platformy nejběžnější u českých
  // retail investorů (Portu a Coinbase sem patří — jsou to vstupní brány)
  const rank = (platform: PlatformInfo): number => {
    const index = GRID_PRIORITY.indexOf(platform.id);
    return index === -1 ? GRID_PRIORITY.length : index;
  };
  const ordered = [...PLATFORMS].sort((a, b) => rank(a) - rank(b));
  const shown = limit ? ordered.slice(0, limit) : ordered;
  const rest = ordered.length - shown.length;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {shown.map((platform) => (
        <li key={platform.id}>
          <div className="flex h-full items-center gap-2.5 rounded-lg border border-linka bg-plocha px-3 py-2.5">
            <PlatformTile platform={platform} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-tight">{platform.name}</span>
              {platform.method === 'api' && (
                <span className="font-mono text-[11px] font-semibold text-ruzova-text">
                  {METHOD_BADGE.api!.label}
                </span>
              )}
            </span>
          </div>
        </li>
      ))}
      {rest > 0 && (
        <li>
          <Link
            href="/platformy"
            className="flex h-full items-center gap-2.5 rounded-lg border border-dashed border-linka bg-pozadi px-3 py-2.5 hover:border-ruzova"
          >
            <span className="text-sm font-semibold text-ruzova-text">
              + dalších {rest} platforem →
            </span>
          </Link>
        </li>
      )}
    </ul>
  );
}

/** Badge jen tam, kde se metoda liší od defaultu (výpis s autodetekcí). */
const METHOD_BADGE: Record<PlatformInfo['method'], { label: string; className: string } | null> = {
  api: { label: 'živě přes API', className: 'bg-ruzova/10 text-ruzova-text font-semibold' },
  file: null,
  template: { label: 'přes šablonu', className: 'bg-pozadi text-inkoust-tlumeny' },
};

/**
 * Plný katalog: skupiny → rozbalovací návod per platforma. Varianta 'app'
 * (Zdroje dat) odkazuje na karty napojení a upload na téže stránce; 'public'
 * (marketingová /platformy) místo toho vede do registrace/aplikace.
 */
export function PlatformCatalog({ variant = 'app' }: { variant?: 'app' | 'public' }) {
  return (
    <div className="space-y-5">
      {PLATFORM_GROUPS.map((group) => {
        const GroupHeading = variant === 'public' ? 'h2' : 'h3';
        return (
        <div key={group.key}>
          <GroupHeading className="font-mono text-xs font-semibold uppercase tracking-wide text-inkoust-tlumeny">
            {group.label}
          </GroupHeading>
          <ul className="mt-2 divide-y divide-linka/60">
            {PLATFORMS.filter((platform) => platform.group === group.key).map((platform) => (
              <li key={platform.id}>
                <details className="group py-1.5">
                  <summary className="flex cursor-pointer list-none items-center gap-3 py-2 [&::-webkit-details-marker]:hidden">
                    <PlatformTile platform={platform} className="h-7 w-7 text-[11px]" />
                    <span className="flex-1 text-sm font-medium">{platform.name}</span>
                    {platform.formats && (
                      <span className="hidden font-mono text-[11px] text-inkoust-tlumeny sm:inline">
                        {platform.formats}
                      </span>
                    )}
                    {METHOD_BADGE[platform.method] && (
                      <span
                        className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${METHOD_BADGE[platform.method]!.className}`}
                      >
                        {METHOD_BADGE[platform.method]!.label}
                      </span>
                    )}
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
                        <a href="/api/sablona" className="font-medium text-ruzova-text underline underline-offset-2" download>
                          univerzální šablony
                        </a>{' '}
                        (formát je popsaný přímo v souboru) a{' '}
                        {variant === 'app'
                          ? 'nahraj ji tady'
                          : 'nahraj ji v aplikaci na stránce Zdroje dat'}
                        . Vlastní čtečku tohohle výpisu připravujeme — pošli nám anonymizovaný
                        vzorek na{' '}
                        <a href="mailto:dunder.jan@gmail.com" className="font-medium text-ruzova-text underline underline-offset-2">
                          dunder.jan@gmail.com
                        </a>{' '}
                        a bude to rychlejší.
                      </p>
                    )}
                    {platform.method === 'api' &&
                      (variant === 'app' ? (
                        <p>
                          Napojení nastavíš v{' '}
                          <Link
                            href={platform.connectAnchor ?? '#trading212'}
                            className="font-medium text-ruzova-text underline underline-offset-2"
                          >
                            kartě výš na této stránce
                          </Link>
                          .
                        </p>
                      ) : (
                        <p>
                          Klíč jen pro čtení připojíš po{' '}
                          <Link href="/registrace" className="font-medium text-ruzova-text underline underline-offset-2">
                            registraci
                          </Link>{' '}
                          na stránce Zdroje dat — i s podrobným návodem, která práva zaškrtnout.
                        </p>
                      ))}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </div>
        );
      })}
      <p className="text-sm text-inkoust-tlumeny">
        <strong className="text-inkoust">{UNIVERSAL_INFO.name}:</strong> {UNIVERSAL_INFO.guide}{' '}
        <a href="/api/sablona" className="font-medium text-ruzova-text underline underline-offset-2" download>
          Stáhnout šablonu
        </a>
        . Opakované nahrání nic nezdvojí — deduplikace je součástí importu a funguje i napříč
        soubory.
      </p>
    </div>
  );
}
