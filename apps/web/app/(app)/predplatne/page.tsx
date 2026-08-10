import Link from 'next/link';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { BillingModeNotice } from '@/components/order-page';
import { PlanCard } from '@/components/plan-card';
import { PurchaseLegalNote } from '@/components/purchase-legal-note';
import { Toast } from '@/components/toast';
import { buttonVariants } from '@/components/ui/button';
import { getDb } from '@/db';
import { reportPurchases, subscriptions } from '@/db/schema';
import { stripeCustomerFor } from '@/lib/billing';
import { SANDBOX_NOTICE } from '@/lib/stripe';
import { billingEnabled, isPaidSubscription, isSellableTaxYear } from '@/lib/entitlements';
import { czDate } from '@/lib/format';
import { availableYears, loadTransactions } from '@/lib/portfolio';
import { PLANS } from '@/lib/plans';
import { requireUser } from '@/lib/session';
import { firstParam } from '@/lib/utils';
import { openBillingPortalAction } from './actions';

export const metadata = { title: 'Předplatné — Danero' };

/**
 * C-3-08: „funkce jsou odemčené" se tvrdilo bezpodmínečně, jenže u odložené
 * platby (bankovní převod, některé lokální metody) je Checkout `completed`,
 * ale `unpaid` — odemčeno bude klidně až za pár dní. Hláška proto vychází
 * ze SKUTEČNÉHO stavu účtu, ne z toho, že se uživatel vrátil ze Stripu.
 */
const stavHotovo = (odemceno: boolean): string =>
  odemceno
    ? 'Platba proběhla. Potvrzení jsme ti poslali e-mailem — funkce jsou odemčené.'
    : 'Platbu jsme přijali ke zpracování. U některých způsobů platby (třeba bankovního převodu) potvrzení z banky trvá i pár dní — jakmile dorazí, funkce se odemknou samy a přijde ti e-mail. Znovu platit nemusíš.';
const STAV_CHYBA: Record<string, string> = {
  zruseno: 'Platbu jsi zrušil, nic se nestrhlo.',
  'chybi-souhlas':
    'Bez zaškrtnutí žádosti o okamžité zahájení plnění nákup dokončit nejde — je to zákonná podmínka.',
  'chyba-rok': 'Vyber daňový rok, za který podklady chceš — nabízíme posledních deset let.',
  'uz-mas-rok': 'Podklady za tenhle rok už máš zaplacené, zůstávají ti odemčené napořád.',
  'vse-koupeno': 'Za všechny roky se svými daty už podklady máš — kupovat teď není co.',
  'bez-plateb': 'Zatím jsi u nás nic nekoupil, není co spravovat.',
  'uz-mas-predplatne':
    'Hlídání ti běží — druhé předplatné vedle něj nedává smysl. Spravovat ho můžeš v zákaznickém portálu.',
  'mas-v-predplatnem': 'Podklady za všechny daňové roky máš v ceně hlídání, kupovat je znovu nemusíš.',
  'prilis-casto': 'Zkoušíš to moc často. Dej tomu pár minut a zkus to znovu.',
  'resi-se-platba':
    'U tvého hlídání se právě řeší nezaplacená platba. Než ji dořešíš v zákaznickém portálu, druhé předplatné zakládat nebudeme — jinak by ti běžela dvě naráz a strhly se dvě platby.',
  'zkusebni-rezim': SANDBOX_NOTICE,
};

/**
 * Přehled tarifů a stav plateb (docs/19). Tahle stránka JEN ukazuje nabídku
 * a co z ní uživatel má — kupuje se o krok dál, na `/predplatne/hlidani`
 * a `/predplatne/podklady`, kde má objednávka celou stránku i právní text.
 */
export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ stav?: string | string[] }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const stav = firstParam((await searchParams).stav);

  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, user.id));
  // vrácené peníze řádek nemažou, jen ho zamknou — takový rok se nesmí tvářit
  // jako zaplacený a musí jít koupit znovu
  const purchases = await db
    .select({ taxYear: reportPurchases.taxYear, createdAt: reportPurchases.createdAt })
    .from(reportPurchases)
    .where(and(eq(reportPurchases.userId, user.id), isNull(reportPurchases.revokedAt)))
    .orderBy(desc(reportPurchases.taxYear));

  const now = new Date();
  const active = isPaidSubscription(subscription, now);
  // portál je i pro toho, kdo koupil jen podklady, i pro toho, komu předplatné
  // doběhlo — doklad o zaplacení má právo najít pořád (§ 16 z. 634/1992)
  const customerId = await stripeCustomerFor(db, user.id);

  const txs = await loadTransactions(db, user.id);
  // Rok z dat může být jakýkoli (překlep v datu ve výpisu, prastarý obchod).
  // Nabízet smíme jen to, co server opravdu prodá — jinak by tlačítko končilo
  // chybovou hláškou (C-27).
  const years = availableYears(txs, now.getUTCFullYear()).filter((rok) =>
    isSellableTaxYear(rok, now),
  );
  // vlastní instance bez Stripu nemá co prodávat (viz `billingEnabled`)
  const prodavame = billingEnabled();
  const koupeneRoky = new Set(purchases.map((p) => p.taxYear));
  const nabizeneRoky = years.filter((rok) => !koupeneRoky.has(rok));
  const koupeneRokyText = purchases.map((p) => p.taxYear).join(', ');

  return (
    <div className="mx-auto max-w-5xl space-y-8 py-8">
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight">Předplatné</h1>
        <p className="mt-2 text-sm text-inkoust-tlumeny">
          Import výpisů, limity i časové testy máš zdarma navždy. Platí se podklady
          k přiznání a celoroční hlídání.
        </p>
      </header>

      {stav === 'hotovo' && (
        <Toast kind="ok" text={stavHotovo(active || purchases.length > 0)} />
      )}
      {stav && STAV_CHYBA[stav] && <Toast kind="chyba" text={STAV_CHYBA[stav]} />}

      <BillingModeNotice />

      {/* Tytéž tarify a tytéž seznamy funkcí jako veřejný ceník (lib/plans.ts) —
          uživatel u placení nesmí číst jiný slib, než jaký ho sem přivedl.
          Co má právě teď, nese odznak na kartě; tlačítko vede na objednávku,
          kde se teprve platí. */}
      <section aria-label="Tarify" className="grid gap-6 lg:grid-cols-3">
        {PLANS.map((plan) => {
          const jeAktivni =
            plan.id === 'free' ||
            (plan.id === 'subscription' && active) ||
            (plan.id === 'report' && (active || purchases.length > 0));

          return (
            <PlanCard
              key={plan.id}
              plan={plan}
              active={jeAktivni}
              activeNote={
                plan.id === 'subscription' && active
                  ? `Aktivní do ${czDate(subscription.currentPeriodEnd)}${
                      subscription.cancelAtPeriodEnd
                        ? ' — obnova je zrušená, do té doby ti služba běží dál.'
                        : ' — obnoví se automaticky, e-mail ti přijde 14 dní předem.'
                    }`
                  : plan.id === 'report' && active
                    ? 'V ceně hlídání za všechny daňové roky.'
                    : plan.id === 'report' && purchases.length > 0
                      ? `Zaplacené roky: ${koupeneRokyText} — zůstávají odemčené napořád.`
                      : undefined
              }
            >
              {/* Na instanci bez plateb se nenabízí nic: kupovat není co
                  a tlačítko by vedlo jen zpátky sem (vysvětluje to hláška nad
                  tarify). */}
              {plan.id === 'subscription' && !active && prodavame && (
                <Link
                  href="/predplatne/hlidani"
                  className={`${buttonVariants({ variant: 'primary' })} w-full`}
                >
                  Objednat hlídání
                </Link>
              )}
              {plan.id === 'report' &&
                !active &&
                prodavame &&
                (nabizeneRoky.length > 0 ? (
                  <Link
                    href="/predplatne/podklady"
                    className={`${buttonVariants({ variant: 'secondary' })} w-full`}
                  >
                    {purchases.length > 0 ? 'Koupit další rok' : 'Koupit podklady'}
                  </Link>
                ) : (
                  <p className="text-sm text-inkoust-tlumeny">
                    {years.length === 0
                      ? 'Nejdřív nahraj výpisy — pak tu půjde koupit podklady za konkrétní rok.'
                      : 'Za všechny roky se svými daty už podklady máš.'}
                  </p>
                ))}
            </PlanCard>
          );
        })}
      </section>

      {/* Portál není součástí větve „mám předplatné": doklad o zaplacení
          a historii plateb potřebuje najít i ten, kdo koupil jen podklady,
          i ten, komu předplatné doběhlo. */}
      {customerId && (
        <section className="rounded-lg border border-linka bg-plocha p-6">
          <h2 className="font-display text-xl font-bold">Platby a doklady</h2>
          <p className="mt-2 text-sm text-inkoust-tlumeny">
            Doklady o zaplacení, historie plateb, změna karty a zrušení obnovy —
            všechno v zabezpečeném portálu Stripu.
          </p>
          <form action={openBillingPortalAction} className="mt-4">
            <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
              {active ? 'Spravovat platby a zrušit obnovu' : 'Zobrazit platby a doklady'}
            </button>
          </form>
        </section>
      )}

      {/* § 1820 odst. 1 písm. c): telefon i adresa musí být k dispozici PŘED
          objednávkou — na jednom místě (`/podminky#kontakt`), sem vede odkaz. */}
      <PurchaseLegalNote />
    </div>
  );
}
