import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { notifications } from '@/db/schema';
import { OverviewView } from '@/components/views/overview-view';
import { getDb } from '@/db';
import { loadInstrumentPrices } from '@/lib/prices';
import { analyzeForUserCached } from '@/lib/engine-cache';
import { EngineErrorCard, engineErrorMessage } from '@/lib/fx-error';
import {
  availableYears,
  dailyRatesForProfile,
  getProfile,
  loadTransactions,
} from '@/lib/portfolio';
import {
  calendarCandidates,
  computeNotificationCandidates,
  getNotificationPrefs,
} from '@/lib/notifications';
import { notificationRules } from '@/lib/notification-rules';
import { requireUser } from '@/lib/session';
import { firstParam, resolveTaxYear } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

/**
 * Stránka pouští daňový engine nad celou historií uživatele — u velkého
 * portfolia to je nejdražší výpočet v aplikaci. Bez `maxDuration` platí výchozí
 * limit funkce a stránka skončí timeoutem místo výsledku (nález G-P2).
 */
export const maxDuration = 800;

export const metadata = { title: 'Přehled — Danero' };

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string | string[] }>;
}) {
  const user = await requireUser();
  const db = await getDb();

  const profile = await getProfile(db, user.id);
  if (!profile) redirect('/nastaveni');

  const txs = await loadTransactions(db, user.id);
  if (txs.length === 0) {
    return (
      <div className="flex max-w-xl flex-col items-start gap-4">
        <h1 className="font-display text-3xl font-bold">Zatím žádná data</h1>
        <p className="text-inkoust-tlumeny">
          Připoj brokera nebo nahraj výpis a Danero pohlídá zbytek — časové testy, limity i podklady
          k přiznání.
        </p>
        <Link
          href="/vitejte"
          className={buttonVariants({ variant: 'primary' })}
        >
          Otevřít průvodce
        </Link>
      </div>
    );
  }

  const recentNotifications = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(5);

  const today = new Date().toISOString().slice(0, 10);
  const currentYear = Number(today.slice(0, 4)); // rok z téhož okamžiku (UTC) jako today
  const years = availableYears(txs, currentYear);
  const rok = firstParam((await searchParams).rok);
  const year = resolveTaxYear(rok, years, currentYear, '/prehled');
  const dailyRates = await dailyRatesForProfile(db, txs, profile, currentYear);
  let analysis;
  try {
    analysis = analyzeForUserCached(user.id, txs, profile, year, today, dailyRates);
  } catch (error) {
    // chybějící kurz (EngineError) = srozumitelná karta, ne pád do error boundary
    const message = engineErrorMessage(error);
    if (!message) throw error;
    return <EngineErrorCard message={message} />;
  }
  const prices = await loadInstrumentPrices(db, user.id);

  /*
   * Uložené události zakládá jen denní cron, a ten běží pouze platícím — bez
   * tohohle byla karta „Poslední upozornění“ u účtu zdarma navždy prázdná,
   * přestože předplatné slibuje jen to, že upozornění přijdou SAMA e-mailem.
   * Analýzu už tady máme, takže je dopočítáme z ní; do DB je NEzapisujeme,
   * jinak by si je cron odškrtl jako odeslané a e-mail o nich platícímu nikdy
   * nepřijde.
   */
  const rules = notificationRules(await getNotificationPrefs(db, user.id));
  /*
   * Jen pro AKTUÁLNÍ rok: analýza je za vybraný rok (`?rok=`), ale události
   * nesou dnešní datum. U starého roku by se tak každé otevření přehledu
   * ozvalo „prolomen limit 2024“ jako dnešní novinka — a vytlačilo ze seznamu
   * skutečné letošní.
   */
  const candidates = year !== currentYear ? [] : [
    ...computeNotificationCandidates({
      result: analysis.result,
      positions: analysis.positions,
      labels: analysis.labels,
      today,
      rules,
    }),
    ...calendarCandidates({
      today,
      hadActivityLastYear: txs.some((tx) =>
        ('tradeDate' in tx ? tx.tradeDate : tx.date).startsWith(`${currentYear - 1}-`),
      ),
      // § 72 odst. 6 DŘ: OSVČ má datovou schránku ze zákona → jen elektronicky (E-23)
      selfEmployed: profile.regime === 'PAUSAL' || profile.regime === 'OSVC',
      deadlineLeadDays: rules.deadlineLeadDays,
    }),
  ];
  /*
   * Ptáme se PŘESNĚ na klíče spočítaných událostí, ne na pět posledních řádků:
   * jarní „prolomen limit“ z databáze by po pár měsících z pětice vypadl,
   * dopočet by ho měl za nový a každé otevření přehledu by ho vyneslo nahoru
   * s dnešním datem — a vytlačilo skutečné novinky.
   */
  const storedKeys = new Set(
    candidates.length === 0
      ? []
      : (
          await db
            .select({ key: notifications.dedupeKey })
            .from(notifications)
            .where(
              and(
                eq(notifications.userId, user.id),
                inArray(notifications.dedupeKey, candidates.map((candidate) => candidate.dedupeKey)),
              ),
            )
        ).map((row) => row.key),
  );
  const computed = candidates
    .filter((candidate) => !storedKeys.has(candidate.dedupeKey))
    .map((candidate) => ({ ...candidate, createdAt: new Date(`${today}T00:00:00Z`) }));

  return (
    <OverviewView
      txs={txs}
      analysis={analysis}
      prices={prices}
      years={years}
      year={year}
      today={today}
      // společné pořadí podle data: dopočítané (dnešní) nesmí spadnout pod
      // starší uložené jen proto, že se přidávají na konec seznamu
      notifications={[...recentNotifications, ...computed]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 5)}
    />
  );
}
