import Link from 'next/link';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { Toast } from '@/components/toast';
import { buttonVariants } from '@/components/ui/button';
import { getDb } from '@/db';
import { reportPurchases, subscriptions } from '@/db/schema';
import { stripeCustomerFor } from '@/lib/billing';
import { SANDBOX_NOTICE, stripeSandboxInProduction } from '@/lib/stripe';
import { billingEnabled, isPaidSubscription, isSellableTaxYear } from '@/lib/entitlements';
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
  'chyba-rok': 'Vyber daňový rok, za který podklady chceš — nabízíme posledních deset let.',
  'uz-mas-rok': 'Podklady za tenhle rok už máš zaplacené, zůstávají ti odemčené napořád.',
  'bez-plateb': 'Zatím jsi u nás nic nekoupil, není co spravovat.',
  'uz-mas-predplatne':
    'Hlídání ti běží — druhé předplatné vedle něj nedává smysl. Spravovat ho můžeš v zákaznickém portálu.',
  'mas-v-predplatnem': 'Podklady za všechny daňové roky máš v ceně hlídání, kupovat je znovu nemusíš.',
  'prilis-casto': 'Zkoušíš to moc často. Dej tomu pár minut a zkus to znovu.',
  'zkusebni-rezim': SANDBOX_NOTICE,
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
  const koupeneRoky = new Set(purchases.map((p) => p.taxYear));
  const nabizeneRoky = years.filter((rok) => !koupeneRoky.has(rok));

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-8">
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
        <div className="rounded-lg border border-linka bg-plocha p-4 text-sm">
          Tahle instance běží bez plateb — všechny funkce máš odemčené.
        </div>
      )}

      {/* C-29: se zkušebním klíčem by „platba" prošla testovací kartou a nic
          by se nestrhlo — to musí být vidět dřív, než na tlačítko sáhneš. */}
      {stripeSandboxInProduction() && <Toast kind="chyba" text={SANDBOX_NOTICE} />}

      <section className="rounded-lg border border-linka bg-plocha p-6">
        <h2 className="font-display text-xl font-bold">Celoroční hlídání</h2>
        {active ? (
          <p className="mt-2 text-sm text-inkoust-tlumeny">
            Aktivní do <strong className="text-inkoust">{czDate(subscription.currentPeriodEnd)}</strong>
            {subscription.cancelAtPeriodEnd
              ? ' — obnova je zrušená, do té doby ti služba běží dál.'
              : ' — obnoví se automaticky, e-mail ti přijde 14 dní předem.'}
          </p>
        ) : (
          <form action={buySubscriptionAction} className="mt-4 space-y-4">
            <p className="text-sm text-inkoust-tlumeny">
              Automatické napojení na brokery, denní přepočet, upozornění e-mailem,
              simulátor prodeje a podklady k přiznání za všechny roky.
            </p>
            <p className="font-display text-2xl font-bold">
              990 Kč <span className="text-base font-semibold text-inkoust-tlumeny">/ rok</span>
            </p>
            {/* § 1811 odst. 2 a § 1820 odst. 1 OZ: doba trvání a automatická
                obnova musí být na očích PŘED objednávkou, ne až po ní. */}
            <p className="text-sm text-inkoust-tlumeny">
              Předplatné trvá <strong className="text-inkoust">1 rok</strong> a po roce se
              automaticky obnovuje za 990 Kč na další rok. E-mail s připomenutím ti přijde
              14 dní před obnovou a zrušit ji můžeš kdykoli v zákaznickém portálu — do konce
              zaplaceného období ti služba běží dál.
            </p>
            <SouhlasCheckbox id="souhlas-predplatne" kind="subscription" />
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
                className="mt-1 block rounded-md border border-linka-ovladaci bg-plocha px-3 py-2 text-sm"
              >
                {nabizeneRoky.map((rok) => (
                  <option key={rok} value={rok}>
                    {rok}
                  </option>
                ))}
              </select>
            </div>
            <SouhlasCheckbox id="souhlas-podklady" kind="report" />
            <button type="submit" className={buttonVariants({ variant: 'primary' })}>
              Objednat s povinností platby
            </button>
          </form>
        )}
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
    </div>
  );
}

/**
 * Výslovná žádost o zahájení plnění před uplynutím 14denní lhůty. Bez
 * zaškrtnutí server nákup nepustí.
 *
 * Znění se pro obě věci LIŠÍ (E-3 z auditu):
 * - podklady = digitální obsah dodaný okamžitě, právo odstoupit zaniká jejich
 *   zpřístupněním (§ 1837 písm. l OZ);
 * - roční hlídání = průběžně poskytovaná služba, právo odstoupit TRVÁ a zaniká
 *   až úplným poskytnutím (§ 1837 písm. a); při odstoupení se doplácí poměrná
 *   část za využité dny (§ 1834). Vzdát se ho dopředu nejde — k takovému
 *   ujednání se nepřihlíží (§ 1812 odst. 2), takže ho tady ani nechceme.
 */
function SouhlasCheckbox({ id, kind }: { id: string; kind: 'subscription' | 'report' }) {
  return (
    <label htmlFor={id} className="flex items-start gap-2.5 text-xs leading-relaxed">
      <input id={id} name="souhlas" type="checkbox" required className="mt-0.5" />
      <span>
        {kind === 'report'
          ? 'Žádám, aby Danero začalo plnit hned po zaplacení, a beru na vědomí, že jakmile mi podklady zpřístupní, ztrácím právo odstoupit od smlouvy do 14 dnů.'
          : 'Žádám, aby mi hlídání začalo běžet hned po zaplacení. Právo odstoupit do 14 dnů mi tím zůstává — když ho využiju, zaplatím jen poměrnou část za dny, kdy mi hlídání běželo.'}
      </span>
    </label>
  );
}
