import { ZERO } from '@danero/shared';
import type { EngineWarning } from '@danero/engine';
import { czk } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Seskupené zobrazení kontrol výpočtu (varování enginu) — server komponenta
 * sdílená přehledem a reportem. Jeden výskyt kódu = prostý text (technický kód
 * jen v title atributu); víc výskytů = blok s lidským nadpisem, počtem
 * a rozbalitelnými jednotlivými případy.
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
  FX_UNIFIED_RATE_MISSING: 'Chybějící jednotný kurz',
  FX_DAILY_RATE_MISSING: 'Chybějící denní kurz ČNB',
};

const LEVEL_CLASS: Record<EngineWarning['level'], string> = {
  ERROR: 'text-cervena',
  WARNING: 'text-jantar',
  INFO: 'text-inkoust-tlumeny',
};

const SEVERITY: Record<EngineWarning['level'], number> = { ERROR: 2, WARNING: 1, INFO: 0 };

/** Export kvůli unit testům — čistá funkce bez JSX. */
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
  return [...groups.values()];
}

/** Nadpis skupiny: lidský název kódu, jinak první věta prvního výskytu. */
function groupTitle(group: WarningGroup): string {
  const known = GROUP_TITLES[group.code];
  if (known) return known;
  const message = group.items[0]!.message;
  // první „věta" = úsek před dvojtečkou nebo pomlčkou (tečka koliduje s „§ 10 odst. 4" apod.)
  const cut = [': ', ' — ']
    .map((sep) => message.indexOf(sep))
    .filter((i) => i !== -1)
    .sort((a, b) => a - b)[0];
  return cut === undefined ? message : message.slice(0, cut);
}

/** Rozbalitelný výčet jednotlivých případů skupiny (auditní stopa). */
function GroupDetails({ group }: { group: WarningGroup }) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs opacity-80">
        Jednotlivé případy ({group.items.length})
      </summary>
      <ul className="mt-1 space-y-1 text-sm">
        {group.items.map((warning, i) => (
          <li key={i}>{warning.message}</li>
        ))}
      </ul>
    </details>
  );
}

/** Agregovaný souhrn nadsmluvních srážek: součet propadlé daně + dotčené tituly. */
export function withholdingSummary(group: WarningGroup, labels: Map<string, string>): string {
  const contexts = group.items.map((warning) => warning.context ?? {});
  const overCzk = contexts.reduce(
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

export function WarningsList({
  warnings,
  labels,
}: {
  warnings: EngineWarning[];
  labels: Map<string, string>;
}) {
  return (
    <>
      {groupByCode(warnings).map((group) => {
        const color = LEVEL_CLASS[group.level];
        if (group.items.length === 1) {
          return (
            <p key={group.code} title={group.code} className={cn('text-sm', color)}>
              {group.items[0]!.message}
            </p>
          );
        }
        return (
          <div key={group.code} className={color}>
            <p className="text-sm font-medium" title={group.code}>
              {groupTitle(group)} <span className="font-mono text-xs">({group.items.length}×)</span>
            </p>
            {group.code === 'WITHHOLDING_ABOVE_TREATY' && (
              <p className="text-sm">{withholdingSummary(group, labels)}</p>
            )}
            <GroupDetails group={group} />
          </div>
        );
      })}
    </>
  );
}
