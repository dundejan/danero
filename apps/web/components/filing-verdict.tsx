import { filingDeadlines, type LimitStatus, type TaxYearResult } from '@danero/engine';
import { ZONE_LABEL } from '@/components/limit-gauge';
import { Disclosure } from '@/components/ui/disclosure';
import { InfoPopover } from '@/components/ui/info-popover';
import { InfoPrint } from '@/components/ui/info-print';
import { Notice } from '@/components/ui/notice';
import { Stat } from '@/components/ui/stat';
import { StatusLabel, type Tone } from '@/components/ui/status';
import { czDate, czk, pct } from '@/lib/format';
import { LIMIT_NAME, limitWithAmount, type LimitKind } from '@/lib/limit-names';
import { tidy } from '@/lib/typography';

/**
 * Verdikt o povinnosti podat přiznání — JEDINÝ zdroj pro přehled i report.
 *
 * Do revize 5 ho měl jen přehled: paušalista pod limitem tam četl „Zatím ti
 * povinnost podat přiznání nevzniká“, kdežto report mu pro týž rok ukázal
 * termín podání a tlačítko na XML bez jediné věty o tom, že se ho netýkají
 * (nález L5-02). Výběr limitu i znění nadpisu proto žijí tady a obě stránky
 * je jen vykreslují.
 */
interface FilingLimit {
  status: LimitStatus;
  /** Jméno limitu — stejné jako v seznamu limitů na přehledu (`LIMIT_NAME`). */
  name: string;
  /** Jméno do věty i s částkou („limit paušální daně (50 000 Kč)“). */
  label: string;
}

/**
 * Limit, jehož prolomení znamená povinnost podat přiznání — podle režimu:
 * PAUSAL → 50 000 Kč paušální daně (§ 7a, R-08b), ZAMESTNANEC → vedlejší příjmy
 * (§ 38g odst. 2, R-09b), JINE → obecný limit (§ 38g odst. 1, R-09a).
 * OSVČ mimo paušál podává přiznání tak jako tak, verdikt u ní nedává smysl —
 * proto `null`.
 *
 * Částky limitů § 38g se rok od roku liší (do ZO 2026 50 000 / 20 000 Kč, od
 * ZO 2027 100 000 / 40 000 Kč), takže je popisek bere ze stavu limitu, tedy
 * z konfigurace počítaného roku.
 */
export function filingLimitFor(result: TaxYearResult): FilingLimit | null {
  const { flatTax50k, employee20k, generalFiling50k } = result.limits;
  const limit = (kind: LimitKind, status: LimitStatus): FilingLimit => ({
    status,
    name: LIMIT_NAME[kind],
    label: limitWithAmount(kind, status.limitCzk),
  });
  if (flatTax50k.applicable) return limit('FLAT_TAX', flatTax50k.status);
  if (employee20k.applicable) return limit('EMPLOYEE_SIDE_INCOME', employee20k.status);
  if (generalFiling50k.applicable) return limit('GENERAL_FILING', generalFiling50k.status);
  return null;
}

/**
 * Nadpis verdiktu — totéž znění na přehledu i v reportu.
 *
 * `closed` říká, že zdaňovací období už skončilo. „Zatím … nevzniká“ platí jen
 * pro rok, který ještě běží a ve kterém limit může prolomit zítřejší prodej;
 * u skončeného roku je to hotová věc a „zatím“ tam mate (nález R2-14).
 * Totéž nad limitem: „podáš“ u roku 2022 zní jako úkol, který teprve přijde —
 * skončený rok proto říká minulým časem, že povinnost vznikla.
 */
export function filingVerdictHeadline({
  year,
  exceeded,
  closed,
}: {
  year: number;
  exceeded: boolean;
  closed: boolean;
}): string {
  if (exceeded) {
    return closed
      ? `Za rok ${year} ti vznikla povinnost podat přiznání`
      : `Za rok ${year} podáš daňové přiznání`;
  }
  return closed
    ? `Za rok ${year} ti povinnost podat přiznání nevznikla`
    : 'Zatím ti povinnost podat přiznání nevzniká';
}

/** Barva stavu podle pásma čerpání limitu — stejná jako na přehledu. */
const ZONE_TONE: Record<LimitStatus['zone'], Tone> = {
  OK: 'success',
  WARNING: 'caution',
  CRITICAL: 'warning',
  EXCEEDED: 'danger',
};

/**
 * Stav limitu a nadpis verdiktu — společný začátek přehledu i reportu. Limit
 * se jmenuje stejně jako v seznamu limitů pod ním („Limit paušální daně“).
 */
export function FilingVerdictHeading({
  year,
  limit,
  closed,
}: {
  year: number;
  limit: FilingLimit;
  /** Zdaňovací období už skončilo (rok je menší než běžný rok v české zóně). */
  closed: boolean;
}) {
  const { status, name } = limit;
  return (
    <>
      <StatusLabel tone={ZONE_TONE[status.zone]}>
        {`${name} — ${ZONE_LABEL[status.zone]}`}
      </StatusLabel>
      <h2 className="type-title-1 mt-3 max-w-[22ch] text-balance">
        {tidy(filingVerdictHeadline({ year, exceeded: status.exceeded, closed }))}
      </h2>
    </>
  );
}

/**
 * Výklad k termínu podání — jeden pro přehled i report (R1B-32: přehled měl
 * kratší znění bez lhůty s poradcem). V reportu se tiskne i na papír.
 *
 * OSVČ (paušál i běžná) má od 1. 1. 2023 datovou schránku zřízenou ze zákona,
 * takže § 72 odst. 6 daňového řádu jí ukládá podat přiznání jen elektronicky;
 * písemné podání je vada podání (§ 74 DŘ). Nabízet jí papírový termín znamená
 * poslat ji do pokuty a zbytečně jí zkrátit lhůtu o měsíc (nález E-23).
 */
export function FilingDeadlineInfo({
  year,
  electronicOnly,
}: {
  year: number;
  electronicOnly: boolean;
}) {
  const deadlines = filingDeadlines(year);
  return electronicOnly ? (
    <>
      OSVČ má od 1. 1. 2023 datovou schránku zřízenou ze zákona, a přiznání se proto podává jen
      elektronicky (§ 72 odst. 6 daňového řádu) — platí pro ni čtyřměsíční lhůta, ne tříměsíční
      lhůta pro písemné podání. S daňovým poradcem {czDate(deadlines.advisor)}.
    </>
  ) : (
    <>
      Písemně do {czDate(deadlines.paper)}, elektronicky do {czDate(deadlines.electronic)} (3 a 4
      měsíce od konce roku dle § 136 daňového řádu; svátek a víkend termín posouvají na nejbližší
      pracovní den). S daňovým poradcem {czDate(deadlines.advisor)}.
    </>
  );
}

/**
 * Termín podání jako velké číslo vedle verdiktu. `onlyIfFiling` je pro toho,
 * komu povinnost podle evidovaných příjmů nevznikla: termín se ho týká jen
 * tehdy, když podává z jiného důvodu.
 */
export function FilingDeadlineStat({
  year,
  electronicOnly,
  onlyIfFiling = false,
}: {
  year: number;
  electronicOnly: boolean;
  onlyIfFiling?: boolean;
}) {
  const deadlines = filingDeadlines(year);
  return (
    <Stat
      size="lg"
      label="Termín podání"
      value={czDate(deadlines.electronic)}
      note={
        onlyIfFiling
          ? 'pokud přiznání podáváš'
          : electronicOnly
            ? 'jen elektronicky'
            : `písemně do ${czDate(deadlines.paper)}`
      }
      info={
        <InfoPopover label="Termín podání">
          <p>
            <FilingDeadlineInfo year={year} electronicOnly={electronicOnly} />
          </p>
        </InfoPopover>
      }
    />
  );
}

/**
 * Verdikt v reportu, na obrazovce i v tisku: výtisk odnáší uživatel poradci
 * a z papíru musí být poznat, jestli povinnost vznikla.
 *
 * Na obrazovce je stav limitu, nadpis a krátká výhrada; celé znění výhrady je
 * ve vysvětlivce a v tisku stojí rozepsané pod nadpisem (vysvětlivka se na
 * papír nedostane).
 *
 * Výhrada je nutná: Danero vidí jen příjmy z výpisů a z Nastavení. O podnikání,
 * nájmu ani jiném důvodu k podání neví — proto termín podání, řádky přiznání
 * i export pod verdiktem zůstávají pro každého (skrývat je je produktové
 * rozhodnutí).
 *
 * `reportsExemptIncome` říká, že pro rok platí oznamovací povinnost podle
 * § 38v (R-09d). Věta „termín potřebuješ jen tehdy, když přiznání podáváš“ by
 * ji odmávla, takže se v tom případě mění; samotnou lhůtu nese
 * `ExemptIncomeReportingNotice` hned pod verdiktem.
 */
export function ReportFilingVerdict({
  year,
  limit,
  closed,
  reportsExemptIncome = false,
}: {
  year: number;
  limit: FilingLimit;
  /** Zdaňovací období už skončilo — viz `filingVerdictHeadline`. */
  closed: boolean;
  reportsExemptIncome?: boolean;
}) {
  const { status, label } = limit;
  const explanation = status.exceeded ? (
    <>
      Soudíme podle příjmů, které Danero eviduje (nahrané výpisy a údaje z Nastavení): {label} je
      překročený, čerpáno {czk(status.usedCzk)}. Čísla k opsání do přiznání a termín podání najdeš
      níž na stránce.
    </>
  ) : (
    <>
      Soudíme jen podle příjmů, které Danero eviduje (nahrané výpisy a údaje z Nastavení): {label}{' '}
      je čerpaný z {pct(status.ratio * 100)}. O jiných příjmech nevíme.{' '}
      {reportsExemptIncome
        ? 'Čísla k opsání níž na stránce potřebuješ jen tehdy, když přiznání podáváš z jiného důvodu.'
        : 'Termín podání a čísla k opsání níž na stránce potřebuješ jen tehdy, když přiznání podáváš z jiného důvodu.'}
    </>
  );
  return (
    <div>
      <FilingVerdictHeading year={year} limit={limit} closed={closed} />
      <div className="type-footnote mt-3 flex items-center gap-1 text-ink-muted print:hidden">
        {status.exceeded
          ? 'Podle příjmů, které Danero eviduje.'
          : 'Jen podle příjmů, které Danero eviduje.'}
        <InfoPopover label="Z čeho verdikt vychází" align="start">
          <p>{explanation}</p>
        </InfoPopover>
      </div>
      <InfoPrint className="max-w-[70ch]">
        <p>{explanation}</p>
      </InfoPrint>
    </div>
  );
}

/**
 * Oznámení osvobozeného příjmu nad 5 milionů Kč (§ 38v, R-09d) pro toho, komu
 * povinnost podat přiznání nevznikla. Termín je vidět hned; proč se liší od
 * lhůty přiznání, je pod ním. Kdo přiznání nepodává, má na oznámení jen
 * základní tříměsíční lhůtu a sankce podle § 38w se počítá z neoznámeného
 * příjmu — právě u něj to bolí nejvíc (A24-R1-01; znění drží krok
 * s `OZNAMENI_5M` kalkulačky).
 */
export function ExemptIncomeReportingNotice({ deadline }: { deadline: string }) {
  return (
    <Notice
      tone="caution"
      title={tidy(
        `Osvobozený příjem nad 5 milionů Kč oznam finančnímu úřadu do ${czDate(deadline)}`,
      )}
    >
      <Disclosure summary="Proč, když přiznání nepodávám">
        <p>
          Osvobozený příjem nad 5 milionů Kč se finančnímu úřadu oznamuje, i když se nedaní (§ 38v
          zákona o daních z příjmů) — nejpozději <strong>{czDate(deadline)}</strong>, tedy do tří
          měsíců po konci roku. Měsíc navíc, který patří k elektronickému přiznání, dostane jen ten,
          kdo přiznání opravdu podá.
        </p>
      </Disclosure>
    </Notice>
  );
}
