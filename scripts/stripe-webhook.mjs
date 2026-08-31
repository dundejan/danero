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

const KLIC = process.env.STRIPE_SECRET_KEY;
if (!KLIC) {
  console.error('Chybí STRIPE_SECRET_KEY. Spusť:\n  STRIPE_SECRET_KEY=$(grep -m1 \'^STRIPE_SECRET_KEY=\' ~/.danero/produkce.env | cut -d= -f2-) node scripts/stripe-webhook.mjs check');
  process.exit(1);
}

const rezim = process.argv[2] ?? 'check';
if (!['check', 'fix'].includes(rezim)) {
  console.error(`Neznámý režim „${rezim}“ — použij check nebo fix.`);
  process.exit(1);
}

async function stripe(cesta, options = {}) {
  const res = await fetch(`https://api.stripe.com/v1${cesta}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${KLIC}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(options.headers ?? {}),
    },
  });
  const telo = await res.json();
  if (!res.ok) throw new Error(`Stripe ${cesta}: ${res.status} ${telo?.error?.message ?? ''}`);
  return telo;
}

const { data: endpointy } = await stripe('/webhook_endpoints?limit=100');
if (endpointy.length === 0) {
  console.error('Ve Stripe není žádný webhook endpoint.');
  process.exit(1);
}

const ocekavane = new Set(HANDLED_STRIPE_EVENTS);
let vseSedi = true;
let missingEvents = false;

for (const ep of endpointy) {
  const ma = new Set(ep.enabled_events);
  const chybi = [...ocekavane].filter((typ) => !ma.has(typ) && !ma.has('*'));
  const navic = [...ma].filter((typ) => typ !== '*' && !ocekavane.has(typ));

  console.log(`\nEndpoint ${ep.id}  (${ep.status}, livemode=${ep.livemode})`);
  console.log(`  URL: ${ep.url}`);
  console.log(`  přihlášeno k ${ma.size} typům, kód obsluhuje ${ocekavane.size}`);
  if (navic.length > 0) console.log(`  navíc (neškodí, jen se ignorují): ${navic.join(', ')}`);

  // Verze API se dá nastavit JEN při zakládání endpointu, takže ji `fix`
  // neopraví — je to na smazání a založení znovu (nebo na dashboard Stripu).
  const apiVersionProblem = webhookApiVersionProblem(ep.api_version ?? null);
  if (apiVersionProblem) {
    vseSedi = false;
    console.log(`  ✗ ${apiVersionProblem}`);
    console.log('    → endpoint smaž a založ znovu se správnou verzí (fix ji doplnit neumí)');
  } else {
    console.log(`  ✓ verze API ${EXPECTED_STRIPE_API_VERSION} sedí na kód`);
  }

  if (chybi.length === 0) {
    console.log('  ✓ všechny obsluhované typy dorazí');
    continue;
  }

  vseSedi = false;
  missingEvents = true;
  console.log(`  ✗ CHYBÍ ${chybi.length}: ${chybi.join(', ')}`);
  console.log('    → tyhle události kód umí zpracovat, ale nikdy je nedostane');

  if (rezim === 'fix') {
    const telo = new URLSearchParams();
    for (const typ of [...new Set([...ma, ...ocekavane])].filter((t) => t !== '*')) {
      telo.append('enabled_events[]', typ);
    }
    const updated = await stripe(`/webhook_endpoints/${ep.id}`, { method: 'POST', body: telo });
    console.log(`    ✓ doplněno — endpoint je nově přihlášený k ${updated.enabled_events.length} typům`);
  }
}

if (rezim === 'check' && !vseSedi) {
  if (missingEvents) {
    console.log('\nSpusť `node scripts/stripe-webhook.mjs fix` a chybějící typy se doplní.');
  }
  process.exit(1);
}
