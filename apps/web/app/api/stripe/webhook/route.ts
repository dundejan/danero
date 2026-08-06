import { getDb } from '@/db';
import { applyStripeEvent } from '@/lib/billing';
import { errorText, logEvent } from '@/lib/log';
import { stripe, stripeLivemode } from '@/lib/stripe';

/**
 * Stripe webhook. Podpis se ověřuje VŽDY — bez něj by kdokoli mohl poslat
 * „zaplaceno" a odemknout si placené funkce. Payload proto potřebujeme syrový,
 * ne přes request.json().
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    logEvent('error', 'billing.webhook_secret_missing');
    return new Response('Webhook není nakonfigurovaný', { status: 500 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) return new Response('Chybí podpis', { status: 400 });

  const payload = await request.text();
  let event;
  try {
    event = await stripe().webhooks.constructEventAsync(payload, signature, secret);
  } catch (error) {
    logEvent('warn', 'billing.webhook_invalid_signature', {
      error: errorText(error),
    });
    return new Response('Neplatný podpis', { status: 400 });
  }

  // Režim události musí sedět na režim klíče, se kterým běžíme. Tvrdé „jen
  // livemode" nejde — služba zatím jede ve Stripe sandboxu — ale záměna
  // secretů (ostrý endpoint × testovací data i naopak) se tím chytí v obou
  // směrech a po přepnutí na ostrý režim to platí samo.
  if (event.livemode !== stripeLivemode()) {
    logEvent('warn', 'billing.webhook_livemode_mismatch', {
      type: event.type,
      eventLivemode: event.livemode,
    });
    return new Response('Událost je z jiného režimu Stripe', { status: 400 });
  }

  try {
    const db = await getDb();
    const outcome = await applyStripeEvent(db, event);
    logEvent('info', 'billing.webhook', { type: event.type, outcome });
  } catch (error) {
    // 500 → Stripe to zkusí znovu; zápisy jsou idempotentní, takže opakování nevadí
    logEvent('error', 'billing.webhook_failed', {
      type: event.type,
      error: errorText(error),
    });
    return new Response('Zpracování selhalo', { status: 500 });
  }

  return Response.json({ received: true });
}
