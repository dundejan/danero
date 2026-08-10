import { and, desc, eq, isNull } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { OrderPage, OrderSummary } from '@/components/order-page';
import { getDb } from '@/db';
import { reportPurchases } from '@/db/schema';
import { billingEnabled, hasActiveSubscription, isSellableTaxYear } from '@/lib/entitlements';
import { EPO_SUPPORTED_YEARS } from '@/lib/epo';
import { yearList } from '@/lib/format';
import { PLANS } from '@/lib/plans';
import { availableYears, loadTransactions } from '@/lib/portfolio';
import { requireUser } from '@/lib/session';
import { buyReportAction } from '../actions';

export const metadata = { title: 'Objednávka: podklady za rok — Danero' };

const PLAN = PLANS.find((plan) => plan.id === 'report')!;

/**
 * Objednávka podkladů za jeden daňový rok.
 *
 * Nabízet smíme jen roky, které server opravdu prodá (C-27): rok z dat může být
 * jakýkoli (překlep v datu ve výpisu, prastarý obchod) a rok už zaplacený se
 * neprodává podruhé. Kdo nemá co koupit, se sem nedostane — vrací se na přehled
 * tarifů, kde je vysvětlené proč.
 */
export default async function ReportOrderPage() {
  // instance bez plateb nemá co prodávat — jinak by tu stálo tlačítko, které
  // spadne až v server action na chybějícím Stripe klíči
  if (!billingEnabled()) redirect('/predplatne');
  const user = await requireUser();
  const db = await getDb();
  const now = new Date();
  // předplatitel má podklady za všechny roky v ceně hlídání
  if (await hasActiveSubscription(db, user.id, now)) redirect('/predplatne?stav=mas-v-predplatnem');

  // vrácené peníze řádek nemažou, jen ho zamknou — takový rok se nesmí tvářit
  // jako zaplacený a musí jít koupit znovu
  const purchases = await db
    .select({ taxYear: reportPurchases.taxYear })
    .from(reportPurchases)
    .where(and(eq(reportPurchases.userId, user.id), isNull(reportPurchases.revokedAt)))
    .orderBy(desc(reportPurchases.taxYear));

  const txs = await loadTransactions(db, user.id);
  const owned = new Set(purchases.map((p) => p.taxYear));
  const offered = availableYears(txs, now.getUTCFullYear())
    .filter((year) => isSellableTaxYear(year, now))
    .filter((year) => !owned.has(year));
  // s prázdnou nabídkou se sem dá dostat uloženým odkazem nebo druhou
  // záložkou — odmítnutí musí být vidět, ne tiché vrácení na přehled
  if (offered.length === 0) redirect('/predplatne?stav=vse-koupeno');

  return (
    <OrderPage
      plan={PLAN}
      lead="Čísla přesně do řádků přiznání za jeden daňový rok — včetně rozpadu na jednotlivé nákupy a použité kurzy."
      terms={
        <>
          {/* E-3-04: informace o omezení musí padnout PŘED platbou, ne až
              v ceníku. Prodáváme deset let zpět, ale oficiální struktura
              DPFDP7 existuje jen pro roky v EPO_SUPPORTED_YEARS. */}
          <p>
            XML pro elektronické podání umíme za{' '}
            {EPO_SUPPORTED_YEARS.length === 1 ? 'rok' : 'roky'} {yearList(EPO_SUPPORTED_YEARS)} — jen
            pro ně finanční správa zveřejnila strukturu formuláře. U ostatních let dostaneš čísla
            i rozpad, ale přiznání do EPO opíšeš ručně.
          </p>
          <p>
            Podklady se odemknou hned po zaplacení a zůstávají ti napořád. Tím, že ti je
            zpřístupníme, zaniká právo odstoupit od smlouvy do 14 dnů (§ 1837 písm. l OZ) — proto
            je souhlas u tlačítka povinný.
          </p>
          <p>
            Kupuješ jeden rok. Další rok jde dokoupit kdykoli, nebo se ti vejdou všechny do
            celoročního hlídání.
          </p>
        </>
      }
      summary={
        <OrderSummary
          action={buyReportAction}
          consent="report"
          item={PLAN.name}
          itemNote="Jednorázově, bez obnovy"
          total={PLAN.price}
          fields={
            <div>
              <label htmlFor="rok" className="text-sm font-medium">
                Daňový rok
              </label>
              <select
                id="rok"
                name="rok"
                className="mt-1 block w-full rounded-md border border-linka-ovladaci bg-plocha px-3 py-2 text-sm"
              >
                {offered.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
              {owned.size > 0 && (
                <p className="mt-2 text-xs text-inkoust-tlumeny">
                  Zaplacené roky ({[...owned].join(', ')}) v nabídce nejsou — ty už máš odemčené.
                </p>
              )}
            </div>
          }
        />
      }
    />
  );
}
