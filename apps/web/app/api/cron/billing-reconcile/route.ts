import { getDb } from '@/db';
import { reconcileSubscriptions, sendRenewalNotices } from '@/lib/billing';
import { withCron } from '@/lib/cron-auth';
import { billingEnabled } from '@/lib/entitlements';

/**
 * Denní srovnání předplatných se Stripe (docs/19). Webhook je hlavní cesta, ale
 * ztracená nebo trvale odmítnutá událost se sama nikdy nespraví — zaplacený
 * zákazník by zůstal bez přístupu a neplatící s ním. Tohle je záchranná síť,
 * ne primární mechanismus.
 *
 * Vlastní instance bez plateb nemá se Stripe co srovnávat.
 */
export const GET = withCron('billing-reconcile', async (_request: Request): Promise<Response> => {
  if (!billingEnabled()) return Response.json({ skipped: 'billing off' });
  const db = await getDb();
  // pořadí záleží: nejdřív srovnat stav se Stripe, teprve pak rozesílat
  // upomínky — jinak by e-mail mohl odejít podle zastaralého data obnovy
  const reconciled = await reconcileSubscriptions(db);
  const notices = await sendRenewalNotices(db);
  return Response.json({ ...reconciled, renewalNotices: notices });
});
