import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { Toast } from '@/components/toast';
import { buttonVariants } from '@/components/ui/button';
import { getDb } from '@/db';
import { reportPurchases, subscriptions } from '@/db/schema';
import { billingEnabled, isPaidSubscription } from '@/lib/entitlements';
import { czDate } from '@/lib/format';
import { availableYears, loadTransactions } from '@/lib/portfolio';
import { requireUser } from '@/lib/session';
import { firstParam } from '@/lib/utils';
import { buyReportAction, buySubscriptionAction, openBillingPortalAction } from './actions';

export const metadata = { title: 'Předplatné — Danero' };

const STAV_OK: Record<string, string> = {
  hotovo: 'Platba proběhla. Potvrzení jsme ti poslali e-mailem — funkce jsou odemčené.',
};
const STAV_CHYBA: Record<string, string> = {
  zruseno: 'Platbu jsi zrušil, nic se nestrhlo.',
  'chybi-souhlas':
    'Bez zaškrtnutí žádosti o okamžité zahájení plnění nákup dokončit nejde — je to zákonná podmínka.',
  'chyba-rok': 'Vyber daňový rok, za který podklady chceš.',
  'bez-predplatneho': 'Zatím nemáš žádné předplatné, není co spravovat.',
};

/**
 * Stav plateb a nákup (docs/19). Souhlas se zahájením plnění je povinný
 * checkbox u obou formulářů — bez něj by šlo odstoupit i po vygenerování
 * podkladů (§ 1837 písm. l OZ).
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
  const purchases = await db
    .select({ taxYear: reportPurchases.taxYear, createdAt: reportPurchases.createdAt })
    .from(reportPurchases)
    .where(eq(reportPurchases.userId, user.id))
    .orderBy(desc(reportPurchases.taxYear));

  const now = new Date();
  const active = isPaidSubscription(subscription, now);

  const txs = await loadTransactions(db, user.id);
  const years = availableYears(txs, now.getUTCFullYear());
  const koupeneRoky = new Set(purchases.map((p) => p.taxYear));
  const nabizeneRoky = years.filter((rok) => !koupeneRoky.has(rok));

  return (
    <main className="mx-auto max-w-3xl space-y-8 py-8">
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight">Předplatné</h1>
        <p className="mt-2 text-sm text-inkoust-tlumeny">
          Import výpisů, limity i časové testy máš zdarma navždy. Platí se podklady
          k přiznání a celoroční hlídání.
        </p>
      </header>

      {stav && STAV_OK[stav] && <Toast kind="ok" text={STAV_OK[stav]} />}
      {stav && STAV_CHYBA[stav] && <Toast kind="chyba" text={STAV_CHYBA[stav]} />}

      {!billingEnabled() && (
        <div className="rounded-lg border border-linka bg-papir-tlumeny p-4 text-sm">
          Tahle instance běží bez plateb — všechny funkce máš odemčené.
        </div>
      )}

      <section className="rounded-lg border border-linka bg-plocha p-6">
        <h2 className="font-display text-xl font-bold">Celoroční hlídání</h2>
        {active ? (
          <>
            <p className="mt-2 text-sm text-inkoust-tlumeny">
              Aktivní do <strong className="text-inkoust">{czDate(subscription.currentPeriodEnd)}</strong>
              {subscription.cancelAtPeriodEnd
                ? ' — obnova je zrušená, do té doby ti služba běží dál.'
                : ' — obnoví se automaticky, e-mail ti přijde 14 dní předem.'}
            </p>
            <form action={openBillingPortalAction} className="mt-4">
              <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
                Spravovat platby a zrušit obnovu
              </button>
            </form>
          </>
        ) : (
          <form action={buySubscriptionAction} className="mt-4 space-y-4">
            <p className="text-sm text-inkoust-tlumeny">
              Automatické napojení na brokery, denní přepočet, upozornění e-mailem,
              simulátor prodeje a podklady k přiznání za všechny roky.
            </p>
            <p className="font-display text-2xl font-bold">
              990 Kč <span className="text-base font-semibold text-inkoust-tlumeny">/ rok</span>
            </p>
            <SouhlasCheckbox id="souhlas-predplatne" />
            <button type="submit" className={buttonVariants({ variant: 'primary' })}>
              Objednat s povinností platby
            </button>
          </form>
        )}
      </section>

      <section className="rounded-lg border border-linka bg-plocha p-6">
        <h2 className="font-display text-xl font-bold">Podklady k přiznání</h2>
        {purchases.length > 0 && (
          <p className="mt-2 text-sm text-inkoust-tlumeny">
            Zaplacené roky:{' '}
            <strong className="text-inkoust">
              {purchases.map((p) => p.taxYear).join(', ')}
            </strong>{' '}
            — zůstávají odemčené napořád.
          </p>
        )}
        {active ? (
          <p className="mt-2 text-sm text-inkoust-tlumeny">
            Máš je v ceně hlídání za všechny daňové roky.
          </p>
        ) : nabizeneRoky.length === 0 ? (
          <p className="mt-2 text-sm text-inkoust-tlumeny">
            {years.length === 0
              ? 'Nejdřív nahraj výpisy — pak tu půjde koupit podklady za konkrétní rok.'
              : 'Za všechny roky se svými daty už podklady máš.'}
          </p>
        ) : (
          <form action={buyReportAction} className="mt-4 space-y-4">
            <p className="text-sm text-inkoust-tlumeny">
              Čísla do řádků přiznání, rozpad na jednotlivé nákupy, použité kurzy a XML
              pro elektronické podání — za jeden daňový rok.
            </p>
            <p className="font-display text-2xl font-bold">490 Kč</p>
            <div>
              <label htmlFor="rok" className="text-sm font-medium">
                Daňový rok
              </label>
              <select
                id="rok"
                name="rok"
                className="mt-1 block rounded-md border border-linka bg-plocha px-3 py-2 text-sm"
              >
                {nabizeneRoky.map((rok) => (
                  <option key={rok} value={rok}>
                    {rok}
                  </option>
                ))}
              </select>
            </div>
            <SouhlasCheckbox id="souhlas-podklady" />
            <button type="submit" className={buttonVariants({ variant: 'primary' })}>
              Objednat s povinností platby
            </button>
          </form>
        )}
      </section>

      <p className="text-xs leading-relaxed text-inkoust-tlumeny">
        Ceny jsou konečné. Prodávající: Jan Dunder, IČO 19642661 — není plátcem DPH.
        Podrobnosti o odstoupení od smlouvy najdeš v{' '}
        <Link href="/odstoupeni" className="font-medium text-ruzova-text underline underline-offset-2">
          poučení o odstoupení
        </Link>{' '}
        a v{' '}
        <Link href="/podminky" className="font-medium text-ruzova-text underline underline-offset-2">
          podmínkách užití
        </Link>
        .
      </p>
    </main>
  );
}

/**
 * § 1837 písm. l OZ: u digitálního obsahu dodaného okamžitě musí zákazník
 * výslovně požádat o zahájení plnění a vzít na vědomí ztrátu práva odstoupit.
 * Bez zaškrtnutí server nákup nepustí.
 */
function SouhlasCheckbox({ id }: { id: string }) {
  return (
    <label htmlFor={id} className="flex items-start gap-2.5 text-xs leading-relaxed">
      <input id={id} name="souhlas" type="checkbox" required className="mt-0.5" />
      <span>
        Žádám, aby Danero začalo plnit hned po zaplacení, a beru na vědomí, že tím
        ztrácím právo odstoupit od smlouvy do 14 dnů.
      </span>
    </label>
  );
}
