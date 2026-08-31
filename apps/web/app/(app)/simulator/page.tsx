import { redirect } from 'next/navigation';
import { analyzeTaxYear } from '@danero/engine';
import { PaywallCard } from '@/components/paywall-card';
import { SimulatorView, type SimParams } from '@/components/views/simulator-view';
import { getDb } from '@/db';
import { resolveEntitlements } from '@/lib/entitlements';
import { EngineErrorCard, engineErrorMessage } from '@/lib/fx-error';
import { currentTaxYear, now, today as todayInPrague } from '@/lib/clock';
import {
  dailyRatesForProfile,
  engineInputForUser,
  getProfile,
  loadTransactions,
} from '@/lib/portfolio';
import { loadInstrumentPrices } from '@/lib/prices';
import { PRICE_SUBSCRIPTION_CZK, priceLabel } from '@/lib/pricing';
import { requireUser } from '@/lib/session';

/**
 * Stránka pouští daňový engine nad celou historií uživatele — u velkého
 * portfolia to je nejdražší výpočet v aplikaci. Bez `maxDuration` platí výchozí
 * limit funkce a stránka skončí timeoutem místo výsledku (nález G-P2).
 */
export const maxDuration = 800;

export const metadata = { title: 'Simulátor prodeje — Danero' };

export default async function SimulatorPage({
  searchParams,
}: {
  searchParams: Promise<SimParams>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const profile = await getProfile(db, user.id);
  if (!profile) redirect('/nastaveni');

  const txs = await loadTransactions(db, user.id);
  if (txs.length === 0) redirect('/prehled');

  const entitlements = await resolveEntitlements(db, user.id);
  if (!entitlements.simulator) {
    return (
      // <main> nese už layout aplikace (cíl skip-linku) — druhý by udělal
      // dva landmarky a rozbil „Přeskočit na obsah“
      <div className="py-12">
        <PaywallCard
          title="Simulátor prodeje"
          body={
            <>
              Spočítá, co se stane s tvojí daní, když teď prodáš konkrétní pozici — ještě
              než to uděláš. Ukáže i datum, kdy bude prodej osvobozený, takže poznáš,
              jestli se vyplatí počkat.
            </>
          }
          price={`Součást hlídání za ${priceLabel(PRICE_SUBSCRIPTION_CZK)} ročně`}
        />
      </div>
    );
  }

  // jeden okamžik pro datum i rok, česká zóna (R-05c, lib/clock.ts)
  const instant = now();
  const today = todayInPrague(instant);
  const year = currentTaxYear(instant);
  const dailyRates = await dailyRatesForProfile(db, txs, profile, year);
  // předvýpočet baseline: EngineError (chybějící kurz) chytáme tady — pád ve
  // view by skončil až v error boundary; výsledek se předává dál, ať se
  // nejdražší výpočet stránky neběží dvakrát
  let baseline: ReturnType<typeof analyzeTaxYear>;
  try {
    baseline = analyzeTaxYear(engineInputForUser(txs, profile, year, dailyRates));
  } catch (error) {
    const message = engineErrorMessage(error);
    if (!message) throw error;
    return <EngineErrorCard message={message} />;
  }
  const prices = await loadInstrumentPrices(db, user.id);
  const params = await searchParams;

  return (
    <SimulatorView
      txs={txs}
      profile={profile}
      today={today}
      params={params}
      dailyRates={dailyRates}
      prices={prices}
      precomputedBaseline={baseline}
    />
  );
}
