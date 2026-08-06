'use server';

import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { subscriptions } from '@/db/schema';
import { appUrl, stripe, stripePrices } from '@/lib/stripe';
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
  metadata: Record<string, string>;
  consentAt: string;
}): Promise<never> {
  const base = appUrl();
  const session = await stripe().checkout.sessions.create({
    mode: params.mode,
    line_items: [{ price: params.price, quantity: 1 }],
    // párování platby s účtem — webhook z toho pozná, komu funkce odemknout
    client_reference_id: params.userId,
    customer_email: params.email,
    metadata: { userId: params.userId, consentAt: params.consentAt, ...params.metadata },
    ...(params.mode === 'subscription'
      ? {
          subscription_data: {
            metadata: { userId: params.userId, consentAt: params.consentAt },
          },
        }
      : {}),
    // pole na promokód (docs/19) — kupóny spravuje Stripe, my si jen uložíme,
    // který kód se použil, kvůli výplatám partnerům
    allow_promotion_codes: true,
    // Bez tohohle Stripe přepočítá cenu do měny návštěvníka a přidá 2–4 %
    // konverzní poplatek — zákazník by pak platil jinou částku, než jakou
    // slibuje ceník i potvrzovací e-mail („cena je konečná"). Danero počítá
    // českou daň, takže cizí měna nemá komu pomoct.
    adaptive_pricing: { enabled: false },
    locale: 'cs',
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
  if (formData.get('souhlas') !== 'on') redirect('/predplatne?stav=chybi-souhlas');
  return new Date().toISOString();
}

export async function buySubscriptionAction(formData: FormData): Promise<never> {
  const consentAt = consentOrRedirect(formData);
  const user = await requireUser();
  return checkout({
    consentAt,
    mode: 'subscription',
    price: stripePrices().subscription,
    userId: user.id,
    email: user.email,
    metadata: { kind: 'subscription' },
  });
}

export async function buyReportAction(formData: FormData): Promise<never> {
  const consentAt = consentOrRedirect(formData);
  const user = await requireUser();
  const taxYear = Number(formData.get('rok'));
  if (!Number.isInteger(taxYear)) redirect('/predplatne?stav=chyba-rok');
  return checkout({
    consentAt,
    mode: 'payment',
    price: stripePrices().report,
    userId: user.id,
    email: user.email,
    metadata: { kind: 'report', taxYear: String(taxYear) },
  });
}

/**
 * Zákaznický portál Stripu — zrušení obnovy, změna karty, historie plateb
 * a doklady. Vlastní obrazovky na tohle nestavíme, Stripe to má hotové
 * a právně ošetřené.
 */
export async function openBillingPortalAction(): Promise<never> {
  const user = await requireUser();
  const db = await getDb();
  const [row] = await db
    .select({ customerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, user.id));
  if (!row?.customerId) redirect('/predplatne?stav=bez-predplatneho');

  const session = await stripe().billingPortal.sessions.create({
    customer: row.customerId,
    return_url: `${appUrl()}/predplatne`,
  });
  redirect(session.url);
}
