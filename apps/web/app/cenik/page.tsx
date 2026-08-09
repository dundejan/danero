import type { Metadata } from 'next';
import Link from 'next/link';
import { FaqList } from '@/components/faq-list';
import { MarketingCta, MarketingPage, PageHero } from '@/components/marketing-page';
import { PlanCard } from '@/components/plan-card';
import { EPO_SUPPORTED_YEARS } from '@/lib/epo';
import { yearList } from '@/lib/format';
import { SOURCE_URL } from '@/lib/legal';
import { PLANS, type PlanId } from '@/lib/plans';
import { PRICE_REPORT_CZK, PRICE_SUBSCRIPTION_CZK, priceLabel } from '@/lib/pricing';
import { currentUser } from '@/lib/session';
import { cn } from '@/lib/utils';
import { SANDBOX_NOTICE, stripeSandboxInProduction } from '@/lib/stripe';

/**
 * Ceník se renderuje při každém požadavku, ne při buildu (nález C-3-06).
 *
 * Pojistka C-29 níž se ptá na `STRIPE_SECRET_KEY`. Ten je ve Vercelu uložený
 * jako citlivá proměnná, takže při `next build` k dispozici NENÍ — staticky
 * předrenderovaný ceník proto vyšel bez varování a veřejně prodával za 490
 * a 990 Kč, přestože se ve zkušebním režimu nemohlo nic strhnout. Změřeno na
 * živém webu: `x-nextjs-prerender: 1`, 6× „490 Kč“ a 0× „zkušebním režimu“.
 *
 * Dynamické renderování jedné marketingové stránky je levnější než ceník,
 * který lže o tom, že se za ty ceny dá zaplatit.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ceník — Danero',
  description: `Nahrát výpisy a zjistit, jak na tom jsi, je v Daneru zdarma. Podklady k přiznání za jeden rok ${priceLabel(PRICE_REPORT_CZK)}, celoroční hlídání s napojením na brokery ${priceLabel(PRICE_SUBSCRIPTION_CZK)} ročně.`,
};

const CENIK_FAQ = [
  {
    q: 'Co přesně je zdarma?',
    a: 'Nahrávání výpisů ze všech podporovaných platforem a přehled, který z nich Danero spočítá: kolik ti zbývá do limitů, jak jsi na tom s tříletými časovými testy — včetně horizontu osvobození, kde u každého nákupu vidíš datum, odkdy je prodej bez daně — a orientační daň. Bez omezení počtu platforem — schválně, protože limity se sčítají přes všechny a s neúplnými daty by ti Danero lhalo.',
  },
  {
    q: 'Proč je napojení přes API placené?',
    a: 'Protože to je ta část, která běží každý den sama a něco stojí — Danero si u brokera samo stahuje nové obchody, přepočítává je a hlídá limity. Stejná čísla dostaneš zdarma, když si výpis jednou za čas nahraješ sám.',
  },
  {
    q: 'Kdy se mi vyplatí jednorázové podklady a kdy roční hlídání?',
    a: `Podklady za ${priceLabel(PRICE_REPORT_CZK)}, když víš, že letos přiznání podáváš, a víc od Danera nechceš. Hlídání za ${priceLabel(PRICE_SUBSCRIPTION_CZK)}, když chceš mít klid celý rok — Danero pak samo sleduje limity a časové testy, ozve se e-mailem a podklady máš za všechny roky v ceně.`,
  },
  {
    q: 'Obnovuje se předplatné samo?',
    a: 'Ano, ale nikdy potichu — 14 dní předem ti přijde e-mail. Zrušit ho můžeš kdykoli jedním kliknutím a služba ti doběhne do konce zaplaceného období.',
  },
  {
    q: 'Za které roky dostanu XML pro elektronické podání?',
    a: `Za daňové roky ${yearList(EPO_SUPPORTED_YEARS)} — pro ně finanční správa zveřejnila oficiální strukturu písemnosti DPFDP7. Strukturu pro nový rok vydává až začátkem roku následujícího, takže do té doby za něj XML neexistuje: dostaneš kompletní čísla s odkazy na řádky formuláře, ale soubor k nahrání ne. Roky před ${Math.min(...EPO_SUPPORTED_YEARS)} v XML nepodporujeme vůbec — podklady k ručnímu vyplnění za ně spočítáme. Zbytek placených podkladů (rozpad prodejů, kurzy, srovnání variant) platí pro každý rok stejně.`,
  },
  {
    q: 'Proč jedna cena, a ne tarify podle počtu brokerů?',
    a: 'Protože limity 100 000 Kč i 50 000 Kč se sčítají přes všechny platformy. Kdybychom ti plotem bránili připojit druhého brokera, počítali bychom ti špatná čísla — a přesně před tím tě má Danero chránit.',
  },
] as const;

/** Kam CTA karty vede: nepřihlášený na registraci, přihlášený rovnou k nákupu. */
const ctaHref = (plan: PlanId, signedIn: boolean): string => {
  if (!signedIn) return '/registrace';
  return plan === 'free' ? '/prehled' : '/predplatne';
};

const ctaLabel = (plan: PlanId, signedIn: boolean): string => {
  if (!signedIn) return 'Založit účet';
  return plan === 'free' ? 'Přejít do aplikace' : 'Objednat v aplikaci';
};

export default async function CenikPage() {
  // Ceník je veřejná stránka, ale čte ji i přihlášený uživatel (odkaz
  // z paywallu, z patičky). Registrační CTA by ho poslalo do slepé uličky.
  const signedIn = Boolean(await currentUser());
  return (
    <MarketingPage active="cenik">
      <PageHero
        eyebrow="Ceník"
        title="Zjistit, jak na tom jsi, je zdarma"
        lede="Platíš, až když chceš podklady k přiznání — nebo aby to Danero hlídalo za tebe. Žádné tarify podle počtu brokerů: limity se sčítají přes všechny platformy, takže je musíš mít připojené všechny."
      />

      {/* C-29: dokud běží platby na zkušebním klíči, nesmí ceník tvrdit, že se
          za tyhle ceny dá zaplatit — nic by se nestrhlo. Zmizí to samo ve
          chvíli, kdy se nasadí ostrý klíč. */}
      {stripeSandboxInProduction() && (
        <p className="mt-8 rounded-lg border border-linka bg-plocha p-4 text-sm">
          {SANDBOX_NOTICE}
        </p>
      )}

      <section aria-label="Cena a obsah" className="mt-12">
        <div className="grid gap-6 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <PlanCard key={plan.id} plan={plan}>
              {/* Přihlášenému je registrace k ničemu — koupit se dá jen
                  v aplikaci, tak ho tam odkaz pošle rovnou. */}
              <Link
                href={ctaHref(plan.id, signedIn)}
                className={cn(
                  'inline-block w-full rounded-md px-6 py-3 text-center font-semibold',
                  plan.highlight
                    ? 'bg-ruzova-syta text-white hover:opacity-90'
                    : 'border border-linka hover:border-inkoust-tlumeny',
                )}
              >
                {ctaLabel(plan.id, signedIn)}
              </Link>
              {plan.id === 'report' && !signedIn && (
                <p className="mt-2 text-center text-xs text-inkoust-tlumeny">
                  koupíš až ve chvíli, kdy podklady potřebuješ
                </p>
              )}
              {plan.id === 'subscription' && (
                <p className="mt-2 text-center text-xs text-inkoust-tlumeny">
                  obnova s e-mailem 14 dní předem, zrušíš kdykoli
                </p>
              )}
            </PlanCard>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-inkoust-tlumeny">
          Ceny jsou konečné. Danero si můžeš{' '}
          <a
            href={SOURCE_URL}
            className="font-medium text-ruzova-text underline underline-offset-2"
            target="_blank"
            rel="noreferrer"
          >
            provozovat i sám
          </a>{' '}
          — kód je otevřený a tam neplatíš nic.
        </p>
      </section>

      <section aria-labelledby="cenik-faq-nadpis" className="mt-24 lg:mt-32">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova-text">
          FAQ
        </p>
        <h2
          id="cenik-faq-nadpis"
          className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl"
        >
          Otázky k ceně
        </h2>
        <div className="mt-8">
          <FaqList items={[...CENIK_FAQ]} />
        </div>
      </section>

      <MarketingCta
        title="Vyzkoušej všechno — teď zdarma"
        lede="Plné demo bez registrace, nebo rovnou vlastní účet. Stačí e-mail, karta ne."
        primary="registrace"
      />
    </MarketingPage>
  );
}
