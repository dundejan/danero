import { redirect } from 'next/navigation';
import {
  emptyYearFallback,
  engineHasNothingFor,
  ReportView,
} from '@/components/views/report-view';
import { reportDataCached } from '@/lib/engine-cache';
import { EngineErrorCard, engineErrorMessage } from '@/lib/fx-error';
import { currentTaxYear, now, today as todayInPrague } from '@/lib/clock';
import { getDb } from '@/db';
import {
  availableYears,
  getProfile,
  loadDailyRates,
  loadTransactions,
  pinTaxYear,
} from '@/lib/portfolio';
import { requireUser } from '@/lib/session';
import { firstParam, resolveTaxYear } from '@/lib/utils';

/**
 * Stránka pouští daňový engine nad celou historií uživatele — u velkého
 * portfolia to je nejdražší výpočet v aplikaci. Bez `maxDuration` platí výchozí
 * limit funkce a stránka skončí timeoutem místo výsledku (nález G-P2).
 */
export const maxDuration = 300;

export const metadata = { title: 'Report — Danero' };

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string | string[]; strana?: string | string[] }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const profile = await getProfile(db, user.id);
  if (!profile) redirect('/nastaveni');

  const txs = await loadTransactions(db, user.id);
  if (txs.length === 0) redirect('/prehled');

  // jeden okamžik pro datum i rok, česká zóna (R-05c, lib/clock.ts)
  const instant = now();
  const today = todayInPrague(instant);
  const currentYear = currentTaxYear(instant);
  const years = availableYears(txs, currentYear);
  const params = await searchParams;
  const rok = firstParam(params.rok);
  const strana = Math.max(1, Number(firstParam(params.strana)) || 1);
  const year = resolveTaxYear(rok, years, currentYear, '/report');

  // R-05c: podklady za skončený rok fixují párování, kurzovou soustavu i výklad
  // limitu 100k — od téhle chvíle se rok počítá jimi, i když si uživatel
  // v nastavení vybere jiné (zákon chce konzistenci a čísla v podaném přiznání
  // se nesmí zpětně změnit).
  // Fixuje podklad, ne otevření adresy: rok bez transakce, pro který nemá nic
  // ani engine, ukáže jen prázdný stav a fixovat tam není co — přepínač roků
  // takové roky nabízí a v Nastavení pak přibývaly „Zafixované roky“, za které
  // uživatel nic nemá. Jestli podklad vznikne, ví u takového roku až výsledek
  // enginu (prodej vypořádaný po Novém roce, příjmy z profilu) — viz níž.
  const hasTransactionsInYear = !emptyYearFallback(txs, year).empty;
  let pinnedProfile = hasTransactionsInYear
    ? await pinTaxYear(db, profile, year, currentYear)
    : profile;

  // denní kurzy ČNB (R-06b): s nimi srovnání variant zahrnuje jednotný × denní
  const dailyRates = await loadDailyRates(db, txs, currentYear);

  // EngineError (chybějící kurz) chytáme tady — pád ve view by skončil
  // v generickém error boundary; výsledky se předávají dál (žádný dvojí běh).
  // Přes cache: stránkování tabulky prodejů jinak platí celý engine (a v něm
  // 4–8 variant párování) při každém kliknutí na další stranu (F-3-1).
  let precomputed: ReturnType<typeof reportDataCached>;
  try {
    precomputed = reportDataCached(user.id, txs, pinnedProfile, year, today, dailyRates);
  } catch (error) {
    const message = engineErrorMessage(error);
    if (!message) throw error;
    return <EngineErrorCard message={message} />;
  }
  if (!hasTransactionsInYear && !engineHasNothingFor(precomputed.result)) {
    // fixace čísla nemění (fixuje se právě to, čím se teď počítalo), takže
    // výsledek spočítaný před ní platí dál
    pinnedProfile = await pinTaxYear(db, profile, year, currentYear);
  }
  const justPinned =
    profile.pinnedTaxYears?.[year] === undefined &&
    pinnedProfile.pinnedTaxYears?.[year] !== undefined;

  return (
    <ReportView
      txs={txs}
      profile={pinnedProfile}
      year={year}
      years={years}
      today={today}
      dailyRates={dailyRates}
      precomputed={precomputed}
      strana={strana}
      justPinned={justPinned}
    />
  );
}
