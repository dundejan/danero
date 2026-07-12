import Image from 'next/image';
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
 * Logo platformy na světlém čipu — jednotně v obou barevných režimech
 * (řada log má tmavý text, na tmavém pozadí by zanikla). Ikonové značky
 * doplňuje název v textu, wordmark nese název sám; bez loga monogram.
 */
export function PlatformLogo({
  platform,
  withName = true,
}: {
  platform: Pick<PlatformInfo, 'name' | 'color' | 'ink' | 'monogram' | 'logo'>;
  withName?: boolean;
}) {
  const logo = platform.logo;
  if (!logo) {
    return (
      <span className="flex min-w-0 items-center gap-2.5">
        <PlatformTile platform={platform} />
        {withName && (
          <span className="min-w-0 truncate text-sm font-semibold leading-tight">
            {platform.name}
          </span>
        )}
      </span>
    );
  }
  if (logo.kind === 'icon') {
    return (
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white ring-1 ring-inset ring-inkoust/10">
          <Image
            src={logo.src}
            alt=""
            width={24}
            height={24}
            className="h-6 w-6 object-contain"
          />
        </span>
        {withName && (
          <span className="min-w-0 truncate text-sm font-semibold leading-tight">
            {platform.name}
          </span>
        )}
      </span>
    );
  }
  // wordmark: název nese samo logo — text by se dubloval
  return (
    <span className="flex h-8 shrink-0 items-center rounded-md bg-white px-2.5 ring-1 ring-inset ring-inkoust/10">
      {/* h-5 + w-auto: u širokých wordmarků max-w strop mírně poruší poměr
          stran (dev-only warning next/image) — h-auto by ale SVG bez
          intrinsic rozměrů zkolabovalo na nulu; object-contain to kreslí správně */}
      <Image
        src={logo.src}
        alt={platform.name}
        width={120}
        height={20}
        className="h-5 w-auto max-w-[110px] object-contain"
      />
    </span>
  );
}

/**
 * Kompaktní mřížka pro landing: dlaždice + jméno, u živých API štítek.
 * `limit` ukáže jen nejznámější platformy a zbytek shrne dlaždicí s odkazem
 * na /platformy — plný výčet na landingu jen natahoval stránku.
 */
/** Homepage: nejpoužívanější platformy v ČR (doloženo v docs/11) — brokeři
    pro samostatné investory napřed, pak největší fondové platformy a krypto. */
const GRID_PRIORITY = [
  'trading212',
  'xtb',
  'portu',
  'fio',
  'patria',
  'conseq',
  'csob',
  'anycoin',
  'revolut',
];

export function PlatformGrid({ limit }: { limit?: number }) {
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
          <div className="flex h-full items-center rounded-lg border border-linka bg-plocha px-3 py-2.5">
            <PlatformLogo platform={platform} />
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
          <ul className="mt-3 grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {PLATFORMS.filter((platform) => platform.group === group.key).map((platform) => (
              <li key={platform.id}>
                <details className="group rounded-lg border border-linka bg-plocha">
                  {/* jen logo a jméno — formáty a typ napojení jsou žargon,
                      detail (kde co stáhnout) říká rozbalený návod */}
                  <summary className="flex cursor-pointer list-none items-center gap-3 p-3.5 [&::-webkit-details-marker]:hidden">
                    <span className="flex min-w-0 flex-1 items-center">
                      <PlatformLogo platform={platform} />
                    </span>
                    <span
                      aria-hidden
                      className="text-inkoust-tlumeny transition-transform group-open:rotate-90"
                    >
                      ›
                    </span>
                  </summary>
                  <div className="space-y-1.5 border-t border-linka/60 p-3.5 text-sm text-inkoust-tlumeny">
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
