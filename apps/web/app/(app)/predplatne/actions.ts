'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { purchaseBlock, stripeCustomerFor } from '@/lib/billing';
import { appUrl, stripe, stripePrices, stripeSandboxInProduction } from '@/lib/stripe';
import { requireUser } from '@/lib/session';

/**
 * Checkout pro obě placené věci (docs/19). Hostovaná stránka Stripu — nikdy
 * neposíláme `payment_method_types`, ať se metody řídí z dashboardu a nabídne
 * se to, co má u daného zákazníka největší šanci projít.
 */

async function checkout(params: {
  mode: 'payment' | 'subscription';
  price: string;
  userId: string;
  email: string;
  customerId: string | null;
  metadata: Record<string, string>;
  consentAt: string;
  /** Věta nad tlačítkem Zaplatit — co se stane hned po zaplacení. */
  submitMessage: string;
}): Promise<never> {
  const base = appUrl();
  const session = await stripe().checkout.sessions.create({
    mode: params.mode,
    line_items: [{ price: params.price, quantity: 1 }],
    // párování platby s účtem — webhook z toho pozná, komu funkce odemknout
    client_reference_id: params.userId,
    // Existujícího zákazníka posíláme dál, ať každý nákup nezakládá nového:
    // jinak se platby jednoho člověka rozpadnou mezi několik zákazníků, portál
    // ukáže jen jednu z nich a `invoice.payment_failed` nemá koho dohledat.
    // `customer` a `customer_email` se navzájem vylučují.
    ...(params.customerId ? { customer: params.customerId } : { customer_email: params.email }),
    metadata: { userId: params.userId, consentAt: params.consentAt, ...params.metadata },
    ...(params.mode === 'subscription'
      ? {
          subscription_data: {
            metadata: { userId: params.userId, consentAt: params.consentAt },
          },
        }
      : // Doklad o zaplacení (§ 435 OZ): u předplatného ho Stripe vystaví sám
        // (faktura ke každému období), u jednorázové platby jen na vyžádání.
        { invoice_creation: { enabled: true } }),
    // pole na promokód (docs/19) — kupóny spravuje Stripe, my si jen uložíme,
    // který kód se použil, kvůli výplatám partnerům
    allow_promotion_codes: true,
    // Bez tohohle Stripe přepočítá cenu do měny návštěvníka a přidá 2–4 %
    // konverzní poplatek — zákazník by pak platil jinou částku, než jakou
    // slibuje ceník i potvrzovací e-mail („cena je konečná"). Danero počítá
    // českou daň, takže cizí měna nemá komu pomoct.
    adaptive_pricing: { enabled: false },
    locale: 'cs',
    // Hostovaný Checkout je jediná obrazovka nákupu, kterou nekreslíme sami —
    // vzhled se řídí značkou nastavenou ve Stripe, ale řeč zůstává na nás.
    // Věta říká, co se stane po zaplacení, ať se člověk nemusí ptát.
    custom_text: { submit: { message: params.submitMessage } },
    success_url: `${base}/predplatne?stav=hotovo`,
    cancel_url: `${base}/predplatne?stav=zruseno`,
  });
  if (!session.url) throw new Error('Stripe nevrátil URL checkoutu.');
  redirect(session.url);
}

/**
 * Bez výslovné žádosti o zahájení plnění před uplynutím 14denní lhůty se
 * nekupuje (§ 1837 písm. l OZ). Formulář checkbox vyžaduje, tady se to hlídá
 * i na serveru — a okamžik se pošle do Stripe, aby skončil u platby v databázi.
 */
function consentOrRedirect(formData: FormData): string {
  // Zkušební klíč v ostrém provozu neúčtuje nic (C-29). Objednávku proto ani
  // nezakládáme — zákazník by odešel s dojmem, že zaplatil, a přitom by mu
  // Stripe nabídl testovací kartu a nestrhl ani korunu.
  if (stripeSandboxInProduction()) redirect('/predplatne?stav=zkusebni-rezim');
  if (formData.get('souhlas') !== 'on') redirect('/predplatne?stav=chybi-souhlas');
  return new Date().toISOString();
}

export async function buySubscriptionAction(formData: FormData): Promise<never> {
  const consentAt = consentOrRedirect(formData);
  const user = await requireUser();
  const db = await getDb();
  const blocked = await purchaseBlock(db, user.id, { kind: 'subscription' });
  if (blocked) redirect(`/predplatne?stav=${blocked}`);
  return checkout({
    consentAt,
    mode: 'subscription',
    price: stripePrices().subscription,
    userId: user.id,
    email: user.email,
    customerId: await stripeCustomerFor(db, user.id),
    metadata: { kind: 'subscription' },
    submitMessage:
      'Po zaplacení se hlídání zapne hned — potvrzení objednávky i doklad ti přijdou e-mailem.',
  });
}

export async function buyReportAction(formData: FormData): Promise<never> {
  const consentAt = consentOrRedirect(formData);
  const user = await requireUser();
  // Number(null) === 0, takže chybějící pole dřív koupilo „podklady za rok 0";
  // rozsah i vlastnictví roku hlídá purchaseBlock, ať je kontrola na jednom místě
  const taxYear = Number(formData.get('rok'));
  const db = await getDb();
  // předplatitel má podklady za všechny roky v ceně — neprodávat mu je znovu
  const blocked = await purchaseBlock(db, user.id, { kind: 'report', taxYear });
  if (blocked) redirect(`/predplatne?stav=${blocked}`);
  return checkout({
    consentAt,
    mode: 'payment',
    price: stripePrices().report,
    userId: user.id,
    email: user.email,
    customerId: await stripeCustomerFor(db, user.id),
    metadata: { kind: 'report', taxYear: String(taxYear) },
    submitMessage: `Po zaplacení se ti podklady k přiznání za rok ${taxYear} odemknou hned — potvrzení objednávky i doklad ti přijdou e-mailem.`,
  });
}

/**
 * Zákaznický portál Stripu — zrušení obnovy, změna karty, historie plateb
 * a doklady. Vlastní obrazovky na tohle nestavíme, Stripe to má hotové
 * a právně ošetřené. Otevře se každému, kdo u nás někdy zaplatil: doklad
 * potřebuje i ten, kdo koupil jen podklady, i ten, komu předplatné doběhlo.
 */
export async function openBillingPortalAction(): Promise<never> {
  const user = await requireUser();
  const db = await getDb();
  const customerId = await stripeCustomerFor(db, user.id);
  if (!customerId) redirect('/predplatne?stav=bez-plateb');

  const session = await stripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl()}/predplatne`,
  });
  redirect(session.url);
}
