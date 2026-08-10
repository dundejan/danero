import Link from 'next/link';
import { IconCheck } from '@/components/marketing-icons';
import { PurchaseLegalNote } from '@/components/purchase-legal-note';
import { Toast } from '@/components/toast';
import { buttonVariants } from '@/components/ui/button';
import { billingEnabled } from '@/lib/entitlements';
import type { Plan } from '@/lib/plans';
import { SANDBOX_NOTICE, stripeSandboxInProduction } from '@/lib/stripe';

/**
 * V jakém režimu instance běží — musí být vidět DŘÍV, než člověk sáhne na
 * tlačítko. Bez plateb (vlastní instance) je odemčené všechno a platit není za
 * co; se zkušebním klíčem Stripu by „platba" prošla testovací kartou a nestrhla
 * by ani korunu (C-29).
 */
export function BillingModeNotice() {
  return (
    <>
      {!billingEnabled() && (
        <div className="rounded-lg border border-linka bg-plocha p-4 text-sm">
          Tahle instance běží bez plateb — všechny funkce máš odemčené.
        </div>
      )}
      {stripeSandboxInProduction() && <Toast kind="chyba" text={SANDBOX_NOTICE} />}
    </>
  );
}

/**
 * Objednávka jednoho tarifu — vlastní stránka, ne formulář schovaný pod ceníkem.
 *
 * Do 10. 8. 2026 vedla tlačítka z karet tarifů na kotvu o kus níž, kde se cena,
 * název i podmínky psaly PODRUHÉ a k tomu přibyl checkbox. Uživatel klikl na
 * „Objednat hlídání" a stránka jen popojela — pořád tytéž informace, jen jinak
 * naskládané, a nikde nebylo poznat, že se něco stalo. Nabídka (tři karty)
 * a objednávka (co přesně kupuju, za kolik a s čím souhlasím) jsou proto dva
 * kroky se dvěma URL: klik na tlačítko někam vede a dá se na něj poslat odkaz.
 *
 * Rozvržení je běžný checkout: vlevo předmět koupě a co je potřeba vědět před
 * objednávkou, vpravo lepivé shrnutí s cenou, souhlasem a jediným tlačítkem.
 * Na mobilu sloupce spadnou pod sebe (shrnutí zůstává poslední — kdo kupuje,
 * dočte se nejdřív, co kupuje).
 */
export function OrderPage({
  plan,
  lead,
  terms,
  summary,
}: {
  /** Tarif ze `lib/plans.ts` — název, cena i seznam funkcí drží ceník. */
  plan: Plan;
  /** Věta pod nadpisem: co si člověk kupuje, lidsky. */
  lead: string;
  /** „Než objednáš" — co musí padnout před uzavřením smlouvy (§ 1811, § 1820 OZ). */
  terms: React.ReactNode;
  /** Pravý sloupec — `<OrderSummary>` s formulářem. */
  summary: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-8 py-8">
      <Link
        href="/predplatne"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-inkoust-tlumeny transition-colors hover:text-inkoust"
      >
        <span aria-hidden>←</span> Zpět na předplatné
      </Link>

      {/* režim instance vykresluje objednávka vždycky — kdyby to bylo na
          volajícím, dřív nebo později vznikne stránka s tlačítkem a bez varování */}
      <BillingModeNotice />

      <div className="grid gap-8 lg:grid-cols-[1fr_21rem] lg:items-start">
        <div className="space-y-8">
          <header>
            <p className="font-mono text-xs font-semibold uppercase tracking-wide text-ruzova-text">
              Objednávka
            </p>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">{plan.name}</h1>
            <p className="mt-2 text-inkoust-tlumeny">{lead}</p>
          </header>

          <section aria-labelledby="co-dostanes">
            <h2 id="co-dostanes" className="font-display text-lg font-bold">
              Co dostaneš
            </h2>
            {/* Tentýž seznam jako na kartě a v ceníku — u placení nesmí být
                jiný slib, než jaký člověka sem přivedl. */}
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {plan.features.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm">
                  <IconCheck />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="nez-objednas">
            <h2 id="nez-objednas" className="font-display text-lg font-bold">
              Než objednáš
            </h2>
            <div className="mt-4 space-y-3 text-sm leading-relaxed text-inkoust-tlumeny">
              {terms}
            </div>
          </section>
        </div>

        {summary}
      </div>

      <PurchaseLegalNote />
    </div>
  );
}

/**
 * Shrnutí objednávky = formulář. Cena, souhlas i tlačítko jsou v jednom rámečku,
 * aby bylo z jednoho pohledu jasné, co se stane po kliknutí.
 *
 * Popisek tlačítka je „Objednat s povinností platby" — § 1826 odst. 2 OZ chce
 * u tlačítka jednoznačné vyjádření, že objednávka zavazuje k platbě.
 */
export function OrderSummary({
  action,
  item,
  itemNote,
  total,
  totalNote,
  consent,
  fields,
}: {
  action: (formData: FormData) => Promise<void>;
  /** Předmět objednávky (název tarifu). */
  item: string;
  /** Upřesnění pod ním — perioda, rozsah. */
  itemNote: string;
  /** Částka k zaplacení. */
  total: string;
  /** Doplněk k částce (měsíční ekvivalent). */
  totalNote?: string;
  consent: 'subscription' | 'report';
  /** Volba, kterou objednávka potřebuje (daňový rok). */
  fields?: React.ReactNode;
}) {
  return (
    // `div`, ne `aside`: objednávka je hlavní obsah stránky, ne doplněk vedle
    // něj — `complementary` landmark by ji čtečce představil jako vedlejší
    <div className="lg:sticky lg:top-8">
      <form
        action={action}
        className="rounded-lg border border-linka bg-plocha p-6 shadow-sm shadow-inkoust/5"
      >
        <h2 className="font-display text-lg font-bold">Shrnutí objednávky</h2>

        <div className="mt-4">
          <p className="font-semibold">{item}</p>
          <p className="mt-1 text-sm text-inkoust-tlumeny">{itemNote}</p>
        </div>

        {fields && <div className="mt-4">{fields}</div>}

        <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-linka pt-4">
          <span className="text-sm font-medium">Celkem</span>
          <span className="font-display text-2xl font-bold tracking-tight">{total}</span>
        </div>
        {totalNote && <p className="mt-1 text-right text-xs text-inkoust-tlumeny">{totalNote}</p>}

        <div className="mt-5 border-t border-linka pt-5">
          <SouhlasCheckbox kind={consent} />
          <button type="submit" className={`${buttonVariants({ variant: 'primary' })} mt-4 w-full`}>
            Objednat s povinností platby
          </button>
          <p className="mt-3 text-xs leading-relaxed text-inkoust-tlumeny">
            Platbu vyřizuje Stripe na své zabezpečené stránce — číslo karty se k nám nedostane.
          </p>
        </div>
      </form>
    </div>
  );
}

/**
 * Výslovná žádost o zahájení plnění před uplynutím 14denní lhůty. Bez
 * zaškrtnutí server nákup nepustí (`consentOrRedirect` v actions.ts).
 *
 * Znění se pro obě věci LIŠÍ (E-3 z auditu):
 * - podklady = digitální obsah dodaný okamžitě, právo odstoupit zaniká jejich
 *   zpřístupněním (§ 1837 písm. l OZ);
 * - roční hlídání = průběžně poskytovaná služba, právo odstoupit TRVÁ a zaniká
 *   až úplným poskytnutím (§ 1837 písm. a); při odstoupení se doplácí poměrná
 *   část za využité dny (§ 1834). Vzdát se ho dopředu nejde — k takovému
 *   ujednání se nepřihlíží (§ 1812 odst. 2), takže ho tady ani nechceme.
 */
function SouhlasCheckbox({ kind }: { kind: 'subscription' | 'report' }) {
  const id = kind === 'report' ? 'souhlas-podklady' : 'souhlas-predplatne';
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
