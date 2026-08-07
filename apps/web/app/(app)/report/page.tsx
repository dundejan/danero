import { redirect } from 'next/navigation';
import { analyzeTaxYear, compareVariants } from '@danero/engine';
import { PaywallCard } from '@/components/paywall-card';
import { ReportView } from '@/components/views/report-view';
import { EngineErrorCard, engineErrorMessage } from '@/lib/fx-error';
import { getDb } from '@/db';
import {
  availableYears,
  engineInputForUser,
  getProfile,
  loadDailyRates,
  loadTransactions,
  pinTaxYear,
} from '@/lib/portfolio';
import { canGenerateReport } from '@/lib/entitlements';
import { requireUser } from '@/lib/session';
import { firstParam } from '@/lib/utils';

/**
 * Stránka pouští daňový engine nad celou historií uživatele — u velkého
 * portfolia to je nejdražší výpočet v aplikaci. Bez `maxDuration` platí výchozí
 * limit funkce a stránka skončí timeoutem místo výsledku (nález G-P2).
 */
export const maxDuration = 800;

export const metadata = { title: 'Daňový report — Danero' };

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string | string[] }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const profile = await getProfile(db, user.id);
  if (!profile) redirect('/nastaveni');

  const txs = await loadTransactions(db, user.id);
  if (txs.length === 0) redirect('/prehled');

  const currentYear = Number(new Date().toISOString().slice(0, 4)); // UTC, konzistentně s today
  const years = availableYears(txs, currentYear);
  const rok = firstParam((await searchParams).rok);
  const year = years.includes(Number(rok)) ? Number(rok) : currentYear;

  // podklady se odemykají po daňových letech: buď předplatným, nebo nákupem
  // konkrétního roku (docs/19)
  if (!(await canGenerateReport(db, user.id, year))) {
    return (
      // <main> nese už layout aplikace (cíl skip-linku) — druhý by udělal
      // dva landmarky a rozbil „Přeskočit na obsah“
      <div className="py-12">
        <PaywallCard
          title={`Podklady k přiznání za rok ${year}`}
          body={
            <>
              Čísla přesně do řádků přiznání, rozpad na jednotlivé nákupy, použité kurzy
              s odkazem na pokyn GFŘ a XML pro elektronické podání. Srovná i varianty
              výpočtu, ať víš, která ti vychází líp.
            </>
          }
          price={`490 Kč za rok ${year} — nebo 990 Kč ročně se všemi roky a hlídáním`}
        />
      </div>
    );
  }

  // R-05c: podklady za skončený rok fixují párování, kurzovou soustavu i výklad
  // limitu 100k — od téhle chvíle se rok počítá jimi, i když si uživatel
  // v nastavení vybere jiné (zákon chce konzistenci a čísla v podaném přiznání
  // se nesmí zpětně změnit)
  const pinnedProfile = await pinTaxYear(db, profile, year, currentYear);

  // denní kurzy ČNB (R-06b): s nimi srovnání variant zahrnuje jednotný × denní
  const dailyRates = await loadDailyRates(db, txs, currentYear);

  // EngineError (chybějící kurz) chytáme tady — pád ve view by skončil
  // v generickém error boundary; výsledky se předávají dál (žádný dvojí běh)
  let precomputed: { result: ReturnType<typeof analyzeTaxYear>; comparison: ReturnType<typeof compareVariants> };
  try {
    const input = engineInputForUser(txs, pinnedProfile, year, dailyRates);
    precomputed = { result: analyzeTaxYear(input), comparison: compareVariants(input) };
  } catch (error) {
    const message = engineErrorMessage(error);
    if (!message) throw error;
    return <EngineErrorCard message={message} />;
  }

  return (
    <ReportView
      txs={txs}
      profile={pinnedProfile}
      year={year}
      years={years}
      dailyRates={dailyRates}
      precomputed={precomputed}
    />
  );
}
