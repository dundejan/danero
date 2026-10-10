import Link from 'next/link';
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
  INTEREST_WITHHOLDING_ABOVE_TREATY: 'Srážková daň z úroku nad smluvní strop',
  TREATY_RATE_UNVERIFIED: 'Neověřená smluvní sazba srážkové daně',
  DIVIDEND_UNKNOWN_COUNTRY: 'Dividendy bez určené země zdroje',
  CZ_INTEREST_WITHHELD: 'České úroky se srážkou u zdroje',
  NEGATIVE_POSITION: 'Prodáno více kusů, než známe z historie',
  TRANSFER_WITHOUT_ACQUISITION: 'Převody bez údajů o původním nabytí',
  TRANSFER_OUT_EXCEEDS_POSITION: 'Odchozí převody přes evidovanou pozici',
  MERGER_INTERPRETIVE: 'Fúze s výkladovým předpokladem',
  SPINOFF_COST_BASIS: 'Spin-off — alokace nabývací ceny dle volby',
  SPINOFF_NO_POSITION: 'Spin-off bez otevřené pozice',
  DELISTING_MANUAL: 'Tituly stažené z burzy',
  DERIVATIVE_ACTION_UNSUPPORTED: 'Korporátní akce na derivátovém instrumentu',
  SHORT_OPEN_AT_YEAR_END: 'Prodej nakrátko otevřený přes konec roku',
  SHORT_COVER_WITHOUT_OPEN: 'Zpětný nákup bez otevřeného prodeje nakrátko',
  ASSET_CLASS_NORMALIZED: 'Sjednocený druh instrumentu',
  FRACTIONAL_SHARES: 'Frakční akcie — nejednoznačný status',
  FX_UNIFIED_RATE_MISSING: 'Chybějící jednotný kurz',
  FX_DAILY_RATE_MISSING: 'Chybějící denní kurz ČNB',
};

const LEVEL_CLASS: Record<EngineWarning['level'], string> = {
  ERROR: 'text-danger',
  WARNING: 'text-caution-text',
  INFO: 'text-ink-muted',
};

/** Závažnost slovem — barvu mu dává `LEVEL_CLASS`. */
const LEVEL_TEXT: Record<EngineWarning['level'], string> = {
  ERROR: 'Chyba',
  WARNING: 'Upozornění',
  INFO: 'Info',
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

/**
 * Nadpis skupiny: lidský název kódu, jinak první věta prvního výskytu.
 * Export kvůli unit testům — čistá funkce bez JSX.
 */
export function groupTitle(group: WarningGroup): string {
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
    <details className="mt-2 text-ink-muted">
      {/* žádné opacity-80: průhlednost srazí kontrast pod AA (na --surface
          3,80:1 pro jantar-text, 4,04:1 pro inkoust-tlumeny, 4,17:1 pro
          červenou) — plné tokeny drží 5,8–6,4:1. Drobnost nese text-xs. */}
      <summary className="type-footnote cursor-pointer">
        Jednotlivé případy ({group.items.length})
      </summary>
      <ul className="type-footnote mt-1 space-y-1 tabular-nums">
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

  // Fakt, ne pokyn: „to vyřešíš formulářem W-8BEN“ a „lze žádat zpět v zemi
  // zdroje“ byly individualizované rady nad konkrétními čísly uživatele —
  // hranice § 1 zákona č. 523/1992 Sb. (docs/13 V-4, nález E-26).
  return [
    `U ${group.items.length} dividend ti v zahraničí srazili víc daně, než dovoluje mezinárodní smlouva. Rozdíl ${czk(overCzk)} nad smluvní strop v ČR započíst nelze. Vrácení nadměrné srážky se řídí právem státu zdroje.`,
    titles.length > 0 ? `Dotčené tituly: ${titles.join(', ')}.` : '',
    hasUs
      ? 'U amerických dividend je smluvní sazba 15 % (čl. 10 smlouvy č. 32/1994 Sb.); sazba 30 % odpovídá účtu bez potvrzeného formuláře W-8BEN.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Závažnost („Chyba“ / „Upozornění“ / „Info“) jako barevné slovo nad zprávou —
 * žádný štítek s výplní. Barvu nese jen tohle slovo; samotná zpráva je
 * běžným textem, aby se dlouhé vysvětlení dalo číst.
 */
function LevelLabel({ level }: { level: EngineWarning['level'] }) {
  return (
    <span className={cn('type-caption block font-semibold', LEVEL_CLASS[level])}>
      {LEVEL_TEXT[level]}
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
      <ul className="divide-y divide-line/70">
        {groupByCode(warnings).map((group) => (
          <li key={group.code} className="type-callout py-3 first:pt-0">
            <LevelLabel level={group.level} />
            {group.items.length === 1 ? (
              <p className="mt-1 text-pretty">{group.items[0]!.message}</p>
            ) : (
              <>
                <p className="mt-1 font-medium">
                  {groupTitle(group)}{' '}
                  <span className="font-normal tabular-nums text-ink-muted">
                    ({group.items.length}×)
                  </span>
                </p>
                {group.code === 'WITHHOLDING_ABOVE_TREATY' && (
                  <p className="mt-1 text-pretty text-ink-muted">
                    {withholdingSummary(group, labels, forfeitedWithholdingCzk)}
                  </p>
                )}
                <GroupDetails group={group} labels={labels} />
              </>
            )}
          </li>
        ))}
      </ul>
      {warnings.length > 0 && (
        // H-3-03: aplikace ukazovala interní kódy pravidel („R-05c"), ale
        // odkaz na jejich vysvětlení z přihlášené části nevedl NIKAM. Kódy
        // z UI zmizely (v tištěném podkladu zůstávají kvůli průkaznosti)
        // a místo nich je tu cesta k metodice.
        <p className="type-callout pt-3">
          <Link
            href="/jak-pocitame"
            className="inline-flex min-h-11 items-center font-medium text-accent-text hover:underline md:min-h-0"
          >
            Jak Danero počítá
            <span aria-hidden className="ml-1">
              ›
            </span>
          </Link>
        </p>
      )}
    </>
  );
}
