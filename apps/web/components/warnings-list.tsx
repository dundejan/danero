import { d, ZERO, type Money } from '@danero/shared';
import type { EngineWarning } from '@danero/engine';
import { czDate, czk } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Seskupené zobrazení kontrol výpočtu (varování enginu) — server komponenta
 * sdílená přehledem a reportem. Jeden výskyt kódu = prostý text; víc výskytů =
 * blok s lidským nadpisem, počtem a rozbalitelnými jednotlivými případy
 * (kompaktně „TICKER · datum · částka“ — vysvětlení nese souhrn, ne každý
 * řádek). Interní kódy (WITHHOLDING_ABOVE_TREATY…) se uživateli neukazují.
 */

interface WarningGroup {
  code: string;
  level: EngineWarning['level'];
  items: EngineWarning[];
}

/** Lidské nadpisy skupin pro kódy, které se typicky opakují per transakce. */
const GROUP_TITLES: Record<string, string> = {
  WITHHOLDING_ABOVE_TREATY: 'Srážková daň nad smluvní strop',
  TREATY_RATE_UNVERIFIED: 'Neověřená smluvní sazba srážkové daně',
  DIVIDEND_UNKNOWN_COUNTRY: 'Dividendy bez určené země zdroje',
  CZ_INTEREST_WITHHELD: 'České úroky se srážkou u zdroje',
  NEGATIVE_POSITION: 'Prodáno více kusů, než známe z historie',
  TRANSFER_WITHOUT_ACQUISITION: 'Převody bez údajů o původním nabytí',
  TRANSFER_OUT_EXCEEDS_POSITION: 'Odchozí převody přes evidovanou pozici',
  MERGER_INTERPRETIVE: 'Fúze s výkladovým předpokladem',
  SPINOFF_COST_BASIS: 'Spin-off — alokace nabývací ceny dle volby',
  SPINOFF_NO_POSITION: 'Spin-off bez otevřené pozice',
  DELISTING_MANUAL: 'Delisting vyžaduje ruční posouzení',
  DERIVATIVE_ACTION_UNSUPPORTED: 'Korporátní akce na derivátovém instrumentu',
  ASSET_CLASS_NORMALIZED: 'Sjednocený druh instrumentu',
  FRACTIONAL_SHARES: 'Frakční akcie — nejednoznačný status',
  FX_UNIFIED_RATE_MISSING: 'Chybějící jednotný kurz',
  FX_DAILY_RATE_MISSING: 'Chybějící denní kurz ČNB',
};

const LEVEL_CLASS: Record<EngineWarning['level'], string> = {
  ERROR: 'text-cervena',
  WARNING: 'text-jantar-text',
  INFO: 'text-inkoust-tlumeny',
};

/** Badge závažnosti u skupiny — barvy jen z tokenů (semafor). Bílý text smí
    jen na syté výplně (v dark módu jsou základní akcenty zesvětlené). */
const LEVEL_BADGE: Record<EngineWarning['level'], { text: string; tone: string }> = {
  ERROR: { text: 'Chyba', tone: 'bg-cervena-syta text-white' },
  WARNING: { text: 'Upozornění', tone: 'bg-jantar/15 text-jantar-text' },
  INFO: { text: 'Info', tone: 'bg-linka/50 text-inkoust-tlumeny' },
};

const SEVERITY: Record<EngineWarning['level'], number> = { ERROR: 2, WARNING: 1, INFO: 0 };

/**
 * Export kvůli unit testům — čistá funkce bez JSX. Skupiny se řadí podle
 * závažnosti (ERROR → WARNING → INFO), uvnitř úrovně podle počtu výskytů
 * sestupně; při shodě rozhoduje pořadí prvního výskytu (stabilní sort).
 */
export function groupByCode(warnings: EngineWarning[]): WarningGroup[] {
  const groups = new Map<string, WarningGroup>();
  for (const warning of warnings) {
    const group = groups.get(warning.code);
    if (!group) {
      groups.set(warning.code, { code: warning.code, level: warning.level, items: [warning] });
      continue;
    }
    group.items.push(warning);
    if (SEVERITY[warning.level] > SEVERITY[group.level]) group.level = warning.level;
  }
  return [...groups.values()].sort(
    (a, b) => SEVERITY[b.level] - SEVERITY[a.level] || b.items.length - a.items.length,
  );
}

/** Nadpis skupiny: lidský název kódu, jinak první věta prvního výskytu. */
function groupTitle(group: WarningGroup): string {
  const known = GROUP_TITLES[group.code];
  if (known) return known;
  const message = group.items[0]!.message;
  // první „věta“ = úsek před dvojtečkou nebo pomlčkou (tečka koliduje s „§ 10 odst. 4“ apod.)
  const cut = [': ', ' — ']
    .map((sep) => message.indexOf(sep))
    .filter((i) => i !== -1)
    .sort((a, b) => a - b)[0];
  return cut === undefined ? message : message.slice(0, cut);
}

/**
 * Kompaktní řádek jednoho případu: „TICKER · datum · částka“ ze
 * strukturovaného contextu varování. Bez strukturovaných dat (jiné kódy)
 * se vrací plný text — auditní stopa nesmí přijít o informaci.
 * Export kvůli unit testům — čistá funkce bez JSX.
 */
export function warningCaseLine(warning: EngineWarning, labels: Map<string, string>): string {
  const ctx = warning.context ?? {};
  const isin = typeof ctx.isin === 'string' ? ctx.isin : undefined;
  const date = typeof ctx.date === 'string' ? ctx.date : undefined;
  const overCzk = typeof ctx.overCzk === 'string' ? ctx.overCzk : undefined;
  if (!isin && !date && !overCzk) return warning.message;
  return [isin ? (labels.get(isin) ?? isin) : undefined, date && czDate(date), overCzk && czk(d(overCzk))]
    .filter(Boolean)
    .join(' · ');
}

/** Rozbalitelný výčet jednotlivých případů skupiny (auditní stopa). */
function GroupDetails({ group, labels }: { group: WarningGroup; labels: Map<string, string> }) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs opacity-80">
        Jednotlivé případy ({group.items.length})
      </summary>
      <ul className="mt-1 space-y-1 font-mono text-xs">
        {group.items.map((warning, i) => (
          <li key={i}>{warningCaseLine(warning, labels)}</li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Agregovaný souhrn nadsmluvních srážek: propadlá daň + dotčené tituly.
 * `forfeitedCzk` (sraženo − započitatelné za celý rok) má přednost před součtem
 * contextů — číslo pak sedí na kartu § 8 (zahrnuje i drobné rozdíly ze
 * zaokrouhlování zápočtu dolů).
 */
export function withholdingSummary(
  group: WarningGroup,
  labels: Map<string, string>,
  forfeitedCzk?: Money,
): string {
  const contexts = group.items.map((warning) => warning.context ?? {});
  const overCzk =
    forfeitedCzk ??
    contexts.reduce(
      (acc, ctx) => (typeof ctx.overCzk === 'string' ? acc.plus(ctx.overCzk) : acc),
      ZERO,
    );
  const titles = [
    ...new Set(
      contexts.flatMap((ctx) =>
        typeof ctx.isin === 'string' ? [labels.get(ctx.isin) ?? ctx.isin] : [],
      ),
    ),
  ].sort((a, b) => a.localeCompare(b, 'cs'));
  const hasUs = contexts.some((ctx) => ctx.country === 'US');

  return [
    `U ${group.items.length} dividend ti v zahraničí srazili víc daně, než dovoluje mezinárodní smlouva — rozdíl ${czk(overCzk)} se v ČR započíst nedá a propadá (někdy ho lze žádat zpět přímo v zemi zdroje).`,
    titles.length > 0 ? `Dotčené tituly: ${titles.join(', ')}.` : '',
    hasUs
      ? 'U amerických akcií to vyřešíš potvrzením formuláře W-8BEN u brokera — sníží srážku z 30 % na 15 %.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Badge závažnosti („Chyba“ / „Upozornění“ / „Info“). */
function LevelBadge({ level }: { level: EngineWarning['level'] }) {
  const badge = LEVEL_BADGE[level];
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold leading-4',
        badge.tone,
      )}
    >
      {badge.text}
    </span>
  );
}

export function WarningsList({
  warnings,
  labels,
  forfeitedWithholdingCzk,
}: {
  warnings: EngineWarning[];
  labels: Map<string, string>;
  /** Propadlá srážka za rok (sraženo − započitatelné) — sjednocuje souhrn s kartou § 8. */
  forfeitedWithholdingCzk?: Money;
}) {
  return (
    <>
      {groupByCode(warnings).map((group) => {
        const color = LEVEL_CLASS[group.level];
        if (group.items.length === 1) {
          return (
            <p key={group.code} className={cn('flex items-start gap-2 text-sm', color)}>
              <LevelBadge level={group.level} />
              <span>{group.items[0]!.message}</span>
            </p>
          );
        }
        return (
          <div key={group.code} className={color}>
            <p className="flex items-start gap-2 text-sm font-medium">
              <LevelBadge level={group.level} />
              <span>
                {groupTitle(group)}{' '}
                <span className="font-mono text-xs">({group.items.length}×)</span>
              </span>
            </p>
            {group.code === 'WITHHOLDING_ABOVE_TREATY' && (
              <p className="text-sm">
                {withholdingSummary(group, labels, forfeitedWithholdingCzk)}
              </p>
            )}
            <GroupDetails group={group} labels={labels} />
          </div>
        );
      })}
    </>
  );
}
