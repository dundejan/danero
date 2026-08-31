/**
 * Kontrola (a náprava) webhook endpointu ve Stripe: typy událostí a verze API.
 *
 * Proč to existuje: endpoint byl přihlášený jen k pěti typům událostí, takže
 * `charge.refunded`, `charge.dispute.created` ani `checkout.session.async_payment_*`
 * nikdy nedorazily. Obsluha refundací a reklamací přitom v kódu je a má testy —
 * jen jí Stripe nikdy nic neposlal. Z kódu ani z CI to nešlo poznat: rozchod byl
 * mezi repozitářem a konfigurací v cizí službě.
 *
 * Druhá půlka téhož rozchodu je `api_version` endpointu (K5-04): drží si ji
 * Stripe zvlášť, takže endpoint může doručovat starší tvar událostí, než jaký
 * kód čte — a projeví se to až rozbitým předplatným platícího zákazníka.
 *
 * Použití (z kořene repa):
 *   STRIPE_SECRET_KEY=… node scripts/stripe-webhook.mjs check
 *   STRIPE_SECRET_KEY=… node scripts/stripe-webhook.mjs fix
 *
 * `check` jen porovná a skončí nenulovým kódem při rozdílu (jde do CI i do
 * runbooku), `fix` doplní chybějící typy. Nic jiného na endpointu nemění —
 * verzi API ostatně měnit ani nejde, Stripe ji bere jen při zakládání.
 */
import {
  EXPECTED_STRIPE_API_VERSION,
  HANDLED_STRIPE_EVENTS,
  webhookApiVersionProblem,
} from '../apps/web/lib/stripe-events.ts';

const SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!SECRET_KEY) {
  console.error('Chybí STRIPE_SECRET_KEY. Spusť:\n  STRIPE_SECRET_KEY=$(grep -m1 \'^STRIPE_SECRET_KEY=\' ~/.danero/produkce.env | cut -d= -f2-) node scripts/stripe-webhook.mjs check');
  process.exit(1);
}

const mode = process.argv[2] ?? 'check';
if (!['check', 'fix'].includes(mode)) {
  console.error(`Neznámý režim „${mode}“ — použij check nebo fix.`);
  process.exit(1);
}

async function stripe(path, options = {}) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(options.headers ?? {}),
    },
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(`Stripe ${path}: ${res.status} ${payload?.error?.message ?? ''}`);
  return payload;
}

const { data: endpoints } = await stripe('/webhook_endpoints?limit=100');
if (endpoints.length === 0) {
  console.error('Ve Stripe není žádný webhook endpoint.');
  process.exit(1);
}

const expected = new Set(HANDLED_STRIPE_EVENTS);
let allMatch = true;
let missingEvents = false;

for (const ep of endpoints) {
  const subscribed = new Set(ep.enabled_events);
  const missing = [...expected].filter((eventType) => !subscribed.has(eventType) && !subscribed.has('*'));
  const extra = [...subscribed].filter((eventType) => eventType !== '*' && !expected.has(eventType));

  console.log(`\nEndpoint ${ep.id}  (${ep.status}, livemode=${ep.livemode})`);
  console.log(`  URL: ${ep.url}`);
  console.log(`  přihlášeno k ${subscribed.size} typům, kód obsluhuje ${expected.size}`);
  if (extra.length > 0) console.log(`  navíc (neškodí, jen se ignorují): ${extra.join(', ')}`);

  // Verze API se dá nastavit JEN při zakládání endpointu, takže ji `fix`
  // neopraví — je to na smazání a založení znovu (nebo na dashboard Stripu).
  const apiVersionProblem = webhookApiVersionProblem(ep.api_version ?? null);
  if (apiVersionProblem) {
    allMatch = false;
    console.log(`  ✗ ${apiVersionProblem}`);
    console.log('    → endpoint smaž a založ znovu se správnou verzí (fix ji doplnit neumí)');
  } else {
    console.log(`  ✓ verze API ${EXPECTED_STRIPE_API_VERSION} sedí na kód`);
  }

  if (missing.length === 0) {
    console.log('  ✓ všechny obsluhované typy dorazí');
    continue;
  }

  allMatch = false;
  missingEvents = true;
  console.log(`  ✗ CHYBÍ ${missing.length}: ${missing.join(', ')}`);
  console.log('    → tyhle události kód umí zpracovat, ale nikdy je nedostane');

  if (mode === 'fix') {
    const payload = new URLSearchParams();
    for (const eventType of [...new Set([...subscribed, ...expected])].filter((t) => t !== '*')) {
      payload.append('enabled_events[]', eventType);
    }
    const updated = await stripe(`/webhook_endpoints/${ep.id}`, { method: 'POST', body: payload });
    console.log(`    ✓ doplněno — endpoint je nově přihlášený k ${updated.enabled_events.length} typům`);
  }
}

if (mode === 'check' && !allMatch) {
  if (missingEvents) {
    console.log('\nSpusť `node scripts/stripe-webhook.mjs fix` a chybějící typy se doplní.');
  }
  process.exit(1);
}
