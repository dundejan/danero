import { d, ZERO, type Money } from '@danero/shared';
import type { EngineWarning } from '@danero/engine';
import { DisclosureRow } from '@/components/ui/disclosure';
import { Group, GroupItem } from '@/components/ui/list';
import { TextLink } from '@/components/ui/link';
import { czDate, czk } from '@/lib/format';
import { tidy, withoutLawRefs } from '@/lib/typography';

/**
 * Seskupené zobrazení kontrol výpočtu (varování enginu) — server komponenta
 * sdílená přehledem a reportem. Každý kód je jeden řádek s titulkem; plné
 * znění a jednotlivé případy (kompaktně „TICKER · datum · částka“ —
 * vysvětlení nese souhrn, ne každý řádek) se rozbalují pod ním.
 * Interní kódy (WITHHOLDING_ABOVE_TREATY…) se uživateli neukazují.
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
 * Znění hlášky pod titulkem řádku. Titulek je u jednotlivé kontroly první věta
 * hlášky, takže rozbalený text začínal jeho doslovným opakováním („Osvobozené
 * příjmy z kryptoaktiv 46 000 Kč: hlavní stablecoiny…“ pod titulkem
 * „Osvobozené příjmy z kryptoaktiv 46 000 Kč“, nález R1B-20). Když je titulek
 * přesně začátkem hlášky, vrací se jen pokračování.
 *
 * Zdroj se nepřepisuje a nic se neztrácí: kde zobrazený titulek přišel
 * o odkaz na paragraf (`withoutLawRefs`) nebo je to lidský název kódu, hláška
 * jím nezačíná a vrací se celá. Export kvůli unit testům.
 */
export function warningBody(message: string, shownTitle: string): string {
  for (const separator of [': ', ' — ']) {
    const prefix = shownTitle + separator;
    if (message.startsWith(prefix) && message.length > prefix.length) {
      const rest = message.slice(prefix.length);
      return rest.charAt(0).toUpperCase() + rest.slice(1);
    }
  }
  return message;
}

/**
 * Má být řádek rozbalený hned? Chyba ano — co se stalo a co s tím, musí být
 * vidět bez kliknutí (R5-02: po redesignu byla sbalená i úroveň „Chyba“ a zbyl
 * z ní jen titulek). Varování a informace zůstávají sbalené.
 * Export kvůli unit testům.
 */
export const opensByDefault = (level: EngineWarning['level']): boolean => level === 'ERROR';

/**
 * Závažnost slovem nad titulkem — jen u chyby. „Upozornění“ a „Info“ nad
 * každým řádkem byla tři stejná slova bez informace a seznam kvůli nim vypadal
 * na přehledu jinak než v reportu (R1B-20); pořadí řádků závažnost nese dál.
 */
function ErrorLabel() {
  return <span className="type-caption block font-semibold text-danger">Chyba</span>;
}

/**
 * Každá kontrola je řádek s titulkem; celé znění (a u opakovaných kontrol
 * výčet jednotlivých případů — auditní stopa) se rozbalí pod ním. Texty
 * z enginu se nepřepisují, jen se zkracuje to, co je vidět hned: titulek je
 * lidský název kódu nebo první věta hlášky, bez čísla paragrafu. Chyby jsou
 * rozbalené rovnou. Při tisku se všechny detaily otevřou samy (globals.css).
 *
 * Texty jdou přes `tidy()`: hlášky enginu mají v částkách obyčejné mezery
 * a na telefonu se lámaly uprostřed čísla („100 / 000 Kč“, R2-12).
 */
export function WarningsList({
  warnings,
  labels,
  forfeitedWithholdingCzk,
  more,
}: {
  warnings: EngineWarning[];
  labels: Map<string, string>;
  /** Propadlá srážka za rok (sraženo − započitatelné) — sjednocuje souhrn s kartou § 8. */
  forfeitedWithholdingCzk?: Money;
  /** Odkaz na úplný seznam, když tenhle ukazuje jen část (přehled bez informací). */
  more?: { label: string; href: string };
}) {
  const groups = groupByCode(warnings);
  return (
    <>
      <Group>
        {groups.map((group) => {
          const rawTitle = groupTitle(group);
          const title = tidy(withoutLawRefs(rawTitle));
          const first = group.items[0]!;
          const eyebrow = group.level === 'ERROR' ? <ErrorLabel /> : undefined;
          if (group.items.length === 1) {
            // hláška, která se vejde do titulku celá, nemá co rozbalovat
            if (withoutLawRefs(rawTitle) === first.message) {
              return (
                <GroupItem key={group.code} className="py-2.5">
                  {eyebrow}
                  <p className="type-callout font-medium text-pretty">{title}</p>
                </GroupItem>
              );
            }
            return (
              <DisclosureRow
                key={group.code}
                eyebrow={eyebrow}
                title={title}
                open={opensByDefault(group.level)}
              >
                <p>{tidy(warningBody(first.message, withoutLawRefs(rawTitle)))}</p>
              </DisclosureRow>
            );
          }
          return (
            <DisclosureRow
              key={group.code}
              eyebrow={eyebrow}
              title={title}
              meta={`${group.items.length}×`}
              open={opensByDefault(group.level)}
            >
              {group.code === 'WITHHOLDING_ABOVE_TREATY' && (
                <p>{tidy(withholdingSummary(group, labels, forfeitedWithholdingCzk))}</p>
              )}
              <ul className="type-footnote mt-2 space-y-1 tabular-nums first:mt-0">
                {group.items.map((warning, index) => (
                  <li key={index}>{tidy(warningCaseLine(warning, labels))}</li>
                ))}
              </ul>
            </DisclosureRow>
          );
        })}
      </Group>
      {warnings.length > 0 && (
        // H-3-03: aplikace ukazovala interní kódy pravidel („R-05c"), ale
        // odkaz na jejich vysvětlení z přihlášené části nevedl NIKAM. Kódy
        // z UI zmizely (v tištěném podkladu zůstávají kvůli průkaznosti)
        // a místo nich je tu cesta k metodice.
        <p className="type-callout flex flex-wrap gap-x-6 pt-2">
          <TextLink href="/jak-pocitame" chevron>
            Jak Danero počítá
          </TextLink>
          {more && (
            <TextLink href={more.href} chevron>
              {more.label}
            </TextLink>
          )}
        </p>
      )}
    </>
  );
}
