import { redirect } from 'next/navigation';
import { OrderPage, OrderSummary } from '@/components/order-page';
import { getDb } from '@/db';
import {
  billingEnabled,
  hasActiveSubscription,
  hasUnsettledSubscription,
} from '@/lib/entitlements';
import { PLANS } from '@/lib/plans';
import { priceLabel, PRICE_SUBSCRIPTION_CZK, SUBSCRIPTION_PER_MONTH_CZK } from '@/lib/pricing';
import { requireUser } from '@/lib/session';
import { buySubscriptionAction } from '../actions';

export const metadata = { title: 'Objednávka: celoroční hlídání — Danero' };

const PLAN = PLANS.find((plan) => plan.id === 'subscription')!;

/**
 * Objednávka ročního hlídání. Stav účtu se kontroluje TADY, ne až v server
 * action: kdo hlídání má (nebo mu u něj visí nezaplacená platba), toho nemá
 * smysl nechat vyplnit objednávku a odmítnout ho až po odeslání — a hlavně by
 * z toho vznikla dvě souběžná předplatná (C-3-05). Server action zůstává jako
 * pojistka pro požadavek mimo UI.
 */
export default async function SubscriptionOrderPage() {
  // instance bez plateb nemá co prodávat — jinak by tu stálo tlačítko, které
  // spadne až v server action na chybějícím Stripe klíči
  if (!billingEnabled()) redirect('/predplatne');
  const user = await requireUser();
  const db = await getDb();
  if (await hasActiveSubscription(db, user.id)) redirect('/predplatne?stav=uz-mas-predplatne');
  if (await hasUnsettledSubscription(db, user.id)) redirect('/predplatne?stav=resi-se-platba');

  return (
    <OrderPage
      plan={PLAN}
      lead="Danero hlídá limity, termíny i kurzy za tebe celý rok — čísla máš aktuální průběžně, ne až v březnu."
      terms={
        <>
          {/* § 1811 odst. 2 a § 1820 odst. 1 OZ: doba trvání a automatická
              obnova musí být na očích PŘED objednávkou, ne až po ní. */}
          <p>
            Předplatné trvá <strong className="text-inkoust">1 rok</strong> a po roce se
            automaticky obnovuje za {priceLabel(PRICE_SUBSCRIPTION_CZK)} na další rok. E-mail
            s připomenutím ti přijde 14 dní před obnovou a zrušit ji můžeš kdykoli v zákaznickém
            portálu — do konce zaplaceného období ti služba běží dál.
          </p>
          <p>
            Odstoupit můžeš i po zaplacení: do 14 dnů ti stačí napsat a vrátíme všechno kromě
            poměrné části za dny, kdy ti hlídání běželo (§ 1834 OZ).
          </p>
        </>
      }
      summary={
        <OrderSummary
          action={buySubscriptionAction}
          consent="subscription"
          item={PLAN.name}
          itemNote="Předplatné na 1 rok, pak automatická obnova"
          total={PLAN.price}
          totalNote={`necelých ${priceLabel(SUBSCRIPTION_PER_MONTH_CZK)} měsíčně`}
        />
      }
    />
  );
}
