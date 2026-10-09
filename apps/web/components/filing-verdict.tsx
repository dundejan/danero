import type { LimitStatus, TaxYearResult } from '@danero/engine';
import { Card } from '@/components/ui/card';
import { czDate, czk, pct } from '@/lib/format';

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

/**
 * Verdikt v reportu, na obrazovce i v tisku (žádné `print:hidden`): výtisk
 * odnáší uživatel poradci a z papíru musí být poznat, jestli povinnost vznikla.
 *
 * Výhrada je nutná: Danero vidí jen příjmy z výpisů a z Nastavení. O podnikání,
 * nájmu ani jiném důvodu k podání neví — proto termín podání, průvodce i export
 * pod verdiktem zůstávají pro každého (skrývat je je produktové rozhodnutí).
 *
 * `exemptReportingDeadline` (ISO datum) se předává jen tehdy, když engine pro
 * rok vrací oznamovací povinnost podle § 38v (R-09d). Verdikt „nevzniká“ pak
 * termín nesmí odmávnout: kdo přiznání nepodává, má na oznámení jen základní
 * tříměsíční lhůtu a sankce podle § 38w se počítá z neoznámeného příjmu — právě
 * u něj to bolí nejvíc (A24-R1-01; znění drží krok s `OZNAMENI_5M` kalkulačky).
 */
export function ReportFilingVerdict({
  year,
  limit,
  exemptReportingDeadline = null,
}: {
  year: number;
  limit: FilingLimit;
  exemptReportingDeadline?: string | null;
}) {
  const { status, label } = limit;
  return (
    <Card className="space-y-1 border-l-4 border-l-ruzova">
      <p className="font-display text-xl font-bold">
        {filingVerdictHeadline({ year, exceeded: status.exceeded })}
      </p>
      <p className="text-sm text-inkoust-tlumeny">
        {status.exceeded ? (
          <>
            Soudíme podle příjmů, které Danero eviduje (nahrané výpisy a údaje z Nastavení):{' '}
            {label} je překročený, čerpáno {czk(status.usedCzk)}. Čísla k opsání do přiznání
            a termín podání najdeš níž na stránce.
          </>
        ) : (
          <>
            Soudíme jen podle příjmů, které Danero eviduje (nahrané výpisy a údaje
            z Nastavení): {label} je čerpaný z {pct(status.ratio * 100)}. O jiných příjmech
            nevíme.{' '}
            {exemptReportingDeadline ? (
              <>
                Pozor na jednu výjimku: máš osvobozený příjem nad 5 milionů Kč a ten se
                finančnímu úřadu přesto oznamuje (§ 38v zákona o daních z příjmů) — nejpozději{' '}
                <strong>{czDate(exemptReportingDeadline)}</strong>, tedy do tří měsíců po konci
                roku. Měsíc navíc, který patří k elektronickému přiznání, dostane jen ten, kdo
                přiznání opravdu podá. Čísla k opsání níž na stránce potřebuješ jen tehdy, když
                přiznání podáváš z jiného důvodu.
              </>
            ) : (
              <>
                Termín podání a čísla k opsání níž na stránce potřebuješ jen tehdy, když
                přiznání podáváš z jiného důvodu.
              </>
            )}
          </>
        )}
      </p>
    </Card>
  );
}
