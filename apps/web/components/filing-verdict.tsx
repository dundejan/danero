import type { LimitStatus, TaxYearResult } from '@danero/engine';
import { ZONE_LABEL } from '@/components/limit-gauge';
import { Disclosure } from '@/components/ui/disclosure';
import { InfoPopover } from '@/components/ui/info-popover';
import { InfoPrint } from '@/components/ui/info-print';
import { Notice } from '@/components/ui/notice';
import { StatusLabel, type Tone } from '@/components/ui/status';
import { czDate, czk, pct } from '@/lib/format';
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
  /** Jméno limitu do věty, ve 4. pádě shodné s 1. („limit 50 000 Kč pro…“). */
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
  if (flatTax50k.applicable) {
    return { status: flatTax50k.status, label: 'limit 50 000 Kč pro paušální daň' };
  }
  if (employee20k.applicable) {
    return {
      status: employee20k.status,
      label: `limit ${czk(employee20k.status.limitCzk)} vedlejších příjmů`,
    };
  }
  if (generalFiling50k.applicable) {
    return {
      status: generalFiling50k.status,
      label: `limit ${czk(generalFiling50k.status.limitCzk)} pro podání přiznání`,
    };
  }
  return null;
}

/** Nadpis verdiktu — totéž znění na přehledu i v reportu. */
export function filingVerdictHeadline({
  year,
  exceeded,
}: {
  year: number;
  exceeded: boolean;
}): string {
  return exceeded
    ? `Za rok ${year} podáš daňové přiznání`
    : 'Zatím ti povinnost podat přiznání nevzniká';
}

/** Barva stavu podle pásma čerpání limitu — stejná jako na přehledu. */
const ZONE_TONE: Record<LimitStatus['zone'], Tone> = {
  OK: 'success',
  WARNING: 'caution',
  CRITICAL: 'warning',
  EXCEEDED: 'danger',
};

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

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
  reportsExemptIncome = false,
}: {
  year: number;
  limit: FilingLimit;
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
      <StatusLabel tone={ZONE_TONE[status.zone]}>
        {`${capitalize(label)} — ${ZONE_LABEL[status.zone]}`}
      </StatusLabel>
      <h2 className="type-title-1 mt-3 max-w-[22ch] text-balance">
        {tidy(filingVerdictHeadline({ year, exceeded: status.exceeded }))}
      </h2>
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
