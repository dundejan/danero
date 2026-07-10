import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { HorizonStrip } from '@/components/horizon-strip';
import { LimitGauge } from '@/components/limit-gauge';
import { exemptionOutlook, horizonDots } from '@/lib/charts-data';
import { demoDataset, demoToday, DEMO_USER_ID } from '@/lib/demo-data';
import { analyzeForUserCached } from '@/lib/engine-cache';
import { computeNotificationCandidates } from '@/lib/notifications';

// „dnešek" dema se odvíjí od skutečného data (horizont, upozornění) —
// žádný prerender při buildu; engine výsledek drží sdílená cache s /demo
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Danero — daně z investic pohlídané celý rok',
  description:
    'Danero hlídá limit 100 000 Kč, limit paušální daně i tříleté časové testy — živě z Trading212. V březnu podklady k přiznání včetně XML. Plné demo bez registrace.',
};

/* ── drobné inline ikony (žádné externí zdroje — CSP self) ────────────────── */

const icon = 'h-5 w-5 shrink-0 text-ruzova';

function IconStamp() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={icon} aria-hidden>
      <path d="M5 21h14" />
      <path d="M12 13v-2" />
      <path d="M9 6a3 3 0 1 1 6 0c0 1.7-.9 2.4-1.5 3.6-.2.4-.5.9-.5 1.4h-2c0-.5-.3-1-.5-1.4C9.9 8.4 9 7.7 9 6Z" />
      <path d="M6 17c0-1.7 1.3-3 3-3h6c1.7 0 3 1.3 3 3v1H6v-1Z" />
    </svg>
  );
}

function IconScale() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={icon} aria-hidden>
      <path d="M12 3v18" />
      <path d="M5 7h14" />
      <path d="M5 7 2.5 13a3 3 0 0 0 5 0L5 7Z" />
      <path d="m19 7-2.5 6a3 3 0 0 0 5 0L19 7Z" />
      <path d="M8 21h8" />
    </svg>
  );
}

function IconKey() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={icon} aria-hidden>
      <circle cx="8" cy="15" r="4" />
      <path d="m10.8 12.2 8.7-8.7" />
      <path d="M15.5 7.5 18 10" />
      <path d="m18.5 4.5 2 2" />
    </svg>
  );
}

function IconEye() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={icon} aria-hidden>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-4 w-4 shrink-0 text-zelena" aria-hidden>
      <path d="m4.5 12.5 5 5 10-11" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4 shrink-0 text-inkoust-tlumeny transition-transform group-open:rotate-45" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/* ── stavební prvky ───────────────────────────────────────────────────────── */

/** Mono štítek sekce — stejná řeč jako titulky karet uvnitř aplikace. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova">
      {children}
    </p>
  );
}

/** Rámeček prohlížeče kolem skutečných screenshotů aplikace. */
function BrowserFrame({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <figure className="overflow-hidden rounded-lg border border-linka bg-plocha shadow-xl shadow-inkoust/10">
      <div className="relative flex h-9 items-center border-b border-linka bg-pozadi px-4" aria-hidden>
        <span className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-linka" />
          <span className="h-2.5 w-2.5 rounded-full bg-linka" />
          <span className="h-2.5 w-2.5 rounded-full bg-linka" />
        </span>
        <span className="absolute left-1/2 -translate-x-1/2 rounded-md bg-plocha px-4 py-0.5 font-mono text-[11px] text-inkoust-tlumeny">
          {url}
        </span>
      </div>
      {children}
    </figure>
  );
}

const CTA_PRIMARY =
  'inline-block rounded-md bg-ruzova-syta px-6 py-3 font-semibold text-white hover:opacity-90';
const CTA_SECONDARY =
  'inline-block rounded-md border border-linka bg-plocha px-6 py-3 font-semibold hover:border-ruzova hover:text-ruzova';

/* ── obsah ────────────────────────────────────────────────────────────────── */

const TRUST = [
  { icon: <IconStamp />, text: 'XML ověřené testovací podatelnou EPO' },
  { icon: <IconScale />, text: 'Bezpečný výklad — a ukážeme, co by ti výhodnější ušetřil' },
  { icon: <IconKey />, text: 'API klíče jen pro čtení, šifrované AES-256-GCM' },
  { icon: <IconEye />, text: 'Plné demo bez registrace' },
] as const;

const STEPS = [
  {
    title: 'Připoj Trading212',
    body: 'Živě přes API klíč jen pro čtení — žádná hesla, žádné právo obchodovat. Nebo nahraj výpis od IBKR, XTB, Degiro či Fio, ostatní přes univerzální šablonu.',
  },
  {
    title: 'Danero hlídá celý rok',
    body: 'Limity a časové testy přepočítáváme denně nad celou historií účtu. Když se něco děje, dáme ti vědět — dřív, než je pozdě.',
  },
  {
    title: 'V březnu stáhneš podklady',
    body: 'Podklady k přiznání s průvodcem, co kam zapsat, a XML pro podatelnu mojedane.cz. Osvobozené příjmy do přiznání nepatří — i to pohlídáme.',
  },
] as const;

const BROKERS = [
  { name: 'Trading212', how: 'živé API napojení', live: true },
  { name: 'Interactive Brokers', how: 'Flex API' },
  { name: 'XTB', how: 'výpisem' },
  { name: 'Degiro', how: 'výpisem' },
  { name: 'Fio e-Broker', how: 'výpisem' },
  { name: 'ostatní', how: 'univerzální CSV šablona' },
] as const;

const PRICING_INCLUDED = [
  'Živé napojení na Trading212 a denní přepočet',
  'Hlídání limitů a časových testů s e-mailovými upozorněními',
  'Horizont osvobození a simulátor prodeje',
  'Podklady k přiznání včetně XML pro podatelnu',
  'Všichni podporovaní brokeři i univerzální šablona',
  'Dvoufaktorové přihlášení, klíče šifrované AES-256-GCM',
] as const;

const FAQ = [
  {
    q: 'Pro koho Danero je?',
    a: 'Pro české investory — a speciálně pro OSVČ v paušálním režimu, kterým neosvobozené příjmy z investic nad 50 000 Kč ročně prolomí paušální daň. To hlídáme jako jediní.',
  },
  {
    q: 'Jak je to s bezpečností?',
    a: 'API klíč od brokera je jen pro čtení a ukládáme ho šifrovaný (AES-256-GCM). Data leží v EU, přihlášení chrání volitelné dvoufaktorové ověření. Nepotřebujeme tvoje jméno ani rodné číslo — stačí e-mail.',
  },
  {
    q: 'Co když nejsem na Trading212?',
    a: 'Trading212 a IBKR přes API klíč jen pro čtení; XTB, Degiro a Fio výpisem. Cokoli dalšího přes univerzální CSV šablonu.',
  },
  {
    q: 'Co když změním brokera nebo jich mám víc?',
    a: 'Účty a výpisy se skládají vedle sebe — všechno převádíme do jednoho kanonického formátu a výpočty se vždy přepočítají od nuly nad celou historií. Nic se neztratí a limity se hlídají přes všechny účty dohromady.',
  },
  {
    q: 'Umí Danero i krypto a deriváty?',
    a: 'Ano. Kryptoaktiva mají od roku 2025 vlastní limit 100 000 Kč — hlídáme ho zvlášť, nezávisle na akciích. Opce a další deriváty se počítají jako samostatný druh příjmu bez osvobození. Všechno si můžeš prohlédnout v demu.',
  },
  {
    q: 'Nahrazuje Danero daňového poradce?',
    a: 'Ne. Danero je výpočetní a evidenční nástroj — počítá podle zveřejněné metodiky a sporné výklady označuje. Za přiznání odpovídá vždy poplatník.',
  },
] as const;

export default function LandingPage() {
  // živá data pro landing = stejný deterministický dataset a stejný čistý
  // engine jako demo prohlídka — stránka ukazuje skutečné komponenty aplikace
  const today = demoToday();
  const { txs, profile, prices } = demoDataset(today);
  const year = Number(today.slice(0, 4));
  const { result, positions, labels } = analyzeForUserCached(
    DEMO_USER_ID,
    txs,
    profile,
    year,
    today,
  );
  const candidates = computeNotificationCandidates({ result, positions, labels, today });
  // plovoucí karty u hero: blížící se osvobození + prolomený limit z hlídače
  const exemptionSoon = candidates.find((c) => c.dedupeKey.startsWith('tt30|'));
  const limitBroken = candidates.find((c) => c.dedupeKey.startsWith('limit|50k|EXCEEDED'));
  const limitCritical = candidates.find((c) => c.dedupeKey.startsWith('limit|100k|CRITICAL'));

  return (
    <div className="mx-auto max-w-6xl px-6">
      <header className="flex items-center justify-between py-5">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-ruzova" aria-hidden />
          <span className="font-display text-lg font-bold tracking-tight">Danero</span>
        </div>
        <nav className="flex items-center gap-2 text-sm sm:gap-5" aria-label="Hlavní navigace">
          <Link
            href="/prihlaseni"
            className="font-medium text-inkoust-tlumeny hover:text-inkoust"
          >
            Přihlásit se
          </Link>
          <Link
            href="/demo/prehled"
            className="rounded-md bg-ruzova-syta px-4 py-2 font-semibold text-white hover:opacity-90"
          >
            Vyzkoušet demo
          </Link>
        </nav>
      </header>

      <main>
        {/* ── hero: úleva + skutečná aplikace se živými upozorněními ───────── */}
        <section aria-labelledby="hero-nadpis" className="pt-12 md:pt-20">
          <h1
            id="hero-nadpis"
            className="max-w-4xl text-balance font-display text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl"
          >
            Daně z investic hlídáme za tebe.{' '}
            <span className="block text-ruzova">Celý rok, ne jen v březnu.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-inkoust-tlumeny">
            Danero se napojí na Trading212 živě přes API a denně přepočítává limity i tříleté
            časové testy — ozve se dřív, než něco prolomíš. V březnu z něj stáhneš podklady
            k přiznání včetně XML.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link href="/demo/prehled" className={CTA_PRIMARY}>
              Vyzkoušet demo — bez registrace
            </Link>
            <Link href="/registrace" className={CTA_SECONDARY}>
              Založit účet zdarma
            </Link>
          </div>
          <p className="mt-3 text-sm text-inkoust-tlumeny">Teď v betě: všechno zdarma.</p>

          {/* skutečný screenshot přehledu + živé karty hlídače nad rohy */}
          <div className="relative mt-14">
            {/* bez záporných okrajů — rozšířily by scrollWidth stránky */}
            <div
              aria-hidden
              className="absolute inset-x-0 top-6 -z-10 h-72 rounded-full bg-ruzova/10 blur-3xl"
            />
            <BrowserFrame url="danero.cz/prehled">
              <Image
                src="/marketing/hero-light.png"
                alt="Přehled aplikace Danero: verdikt „podáš daňové přiznání“ a odměrky čerpání limitů"
                width={1440}
                height={465}
                priority
                sizes="(min-width: 1152px) 1104px, 100vw"
                className="w-full dark:hidden"
              />
              <Image
                src="/marketing/hero-dark.png"
                alt=""
                width={1440}
                height={465}
                loading="eager"
                sizes="(min-width: 1152px) 1104px, 100vw"
                className="hidden w-full dark:block"
              />
            </BrowserFrame>
            {exemptionSoon && (
              <div className="absolute -top-8 right-6 hidden w-80 rotate-1 rounded-lg border border-linka bg-plocha p-4 shadow-lg shadow-inkoust/10 lg:block">
                <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-wide text-inkoust-tlumeny">
                  <span className="inline-block h-2 w-2 rounded-full bg-zelena" aria-hidden />
                  Upozornění z hlídače
                </p>
                <p className="mt-1.5 text-sm font-semibold">{exemptionSoon.title}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-inkoust-tlumeny">
                  {exemptionSoon.body}
                </p>
              </div>
            )}
            {limitBroken && (
              <div className="absolute -bottom-10 left-6 hidden w-80 -rotate-1 rounded-lg border border-linka bg-plocha p-4 shadow-lg shadow-inkoust/10 lg:block">
                <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-wide text-inkoust-tlumeny">
                  <span className="inline-block h-2 w-2 rounded-full bg-cervena" aria-hidden />
                  Upozornění z hlídače
                </p>
                <p className="mt-1.5 text-sm font-semibold">{limitBroken.title}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-inkoust-tlumeny">
                  {limitBroken.body}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ── ověřitelná důvěra: žádná velká čísla, jen co si ověříš ───────── */}
        <section aria-label="Ověřitelná důvěra" className="mt-20 lg:mt-24">
          <ul className="grid gap-px overflow-hidden rounded-lg border border-linka bg-linka sm:grid-cols-2 lg:grid-cols-4">
            {TRUST.map((item) => (
              <li key={item.text} className="flex items-start gap-3 bg-plocha p-5">
                {item.icon}
                <span className="text-sm font-medium leading-snug">{item.text}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── feature 1: hlídání limitů (živé odměrky z enginu) ────────────── */}
        <section aria-labelledby="limity-nadpis" className="mt-24 lg:mt-32">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <Eyebrow>Hlídač limitů</Eyebrow>
              <h2
                id="limity-nadpis"
                className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl"
              >
                O limitu se dozvíš, dokud se s ním dá něco dělat
              </h2>
              <p className="mt-4 text-inkoust-tlumeny">
                Limit 100 000 Kč z prodejů i limit 50 000 Kč pro paušální daň — včetně
                zahraničních dividend, na které se zapomíná. Odměrky ukazují čerpání celý rok
                a při 60, 85 a 100 % ti přijde e-mail.{' '}
                <strong className="text-inkoust">
                  Řekneme ti to dřív, než limit prolomíš
                </strong>{' '}
                — a další prodej si můžeš rozmyslet, nebo ho nechat na leden.
              </p>
            </div>
            {/* živé komponenty aplikace nad demo daty — žádný obrázek */}
            <div className="space-y-4">
              <LimitGauge
                label="Limit paušální daně — 50 000 Kč"
                hint="Zdanitelné příjmy z investic mimo podnikání — dividendy, úroky, neosvobozené prodeje."
                status={result.limits.flatTax50k.status}
              />
              <LimitGauge
                label="Osvobození prodejů CP — 100 000 Kč"
                hint="Do 100 000 Kč tržeb z prodejů za rok jsou všechny prodeje osvobozené."
                status={result.limits.limit100k}
              />
              {limitCritical && (
                <p className="flex items-start gap-2 rounded-md border border-linka bg-plocha px-4 py-3 text-sm">
                  <span
                    className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-oranz"
                    aria-hidden
                  />
                  <span>
                    <span className="font-semibold">{limitCritical.title}</span>{' '}
                    <span className="text-xs text-inkoust-tlumeny">
                      — takhle vypadá e-mail, který ti v tu chvíli pošleme.
                    </span>
                  </span>
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ── feature 2: horizont osvobození (živý, přes celou šířku) ──────── */}
        <section aria-labelledby="horizont-nadpis" className="mt-24 lg:mt-32">
          <div className="max-w-2xl">
            <Eyebrow>Časový test</Eyebrow>
            <h2
              id="horizont-nadpis"
              className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              Počkej pár týdnů — a prodej bez daně
            </h2>
            <p className="mt-4 text-inkoust-tlumeny">
              Po třech letech držení je prodej osvobozený. Každý tvůj nákup putuje po časové
              ose k vlastnímu datu osvobození — vidíš přesně kdy, e-mail přijde 30 a 7 dní
              předem. Vyzkoušej: tečky níže jsou živé.
            </p>
          </div>
          <div className="mt-8 rounded-lg border border-linka bg-plocha p-5">
            <HorizonStrip
              dots={horizonDots(positions, labels, prices, year)}
              today={today}
              outlook={exemptionOutlook(positions, prices, today, year)}
              embedded
            />
          </div>
        </section>

        {/* ── feature 3: podklady k přiznání ────────────────────────────────── */}
        <section aria-labelledby="podklady-nadpis" className="mt-24 lg:mt-32">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <div className="lg:order-last">
              <Eyebrow>Podklady k přiznání</Eyebrow>
              <h2
                id="podklady-nadpis"
                className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl"
              >
                Žádná černá skříňka
              </h2>
              <p className="mt-4 text-inkoust-tlumeny">
                FIFO i další metody párování vidíš vedle sebe, s daní spočtenou pro každou
                zvlášť — bezpečný výklad je výchozí a u sporných míst ti ukážeme, co by
                výhodnější znamenal. V březnu stáhneš průvodce, co kam zapsat, po řádcích
                přiznání — a XML pro podatelnu mojedane.cz, ověřené testovací podatelnou EPO.
              </p>
            </div>
            <BrowserFrame url="danero.cz/report">
              <Image
                src="/marketing/metody-light.png"
                alt="Porovnání variant párování v Daneru: FIFO, LIFO, max. zisk a max. ztráta s daní vedle sebe"
                width={1168}
                height={327}
                sizes="(min-width: 1024px) 544px, 100vw"
                className="w-full dark:hidden"
              />
              <Image
                src="/marketing/metody-dark.png"
                alt=""
                width={1168}
                height={327}
                sizes="(min-width: 1024px) 544px, 100vw"
                className="hidden w-full dark:block"
              />
            </BrowserFrame>
          </div>
        </section>

        {/* ── jak to funguje: skutečná posloupnost → číslování dává smysl ──── */}
        <section aria-labelledby="kroky-nadpis" className="mt-24 lg:mt-32">
          <Eyebrow>Jak to funguje</Eyebrow>
          <h2
            id="kroky-nadpis"
            className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl"
          >
            Tři kroky, pak už jen investuješ
          </h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="rounded-lg border border-linka bg-plocha p-6">
                <span className="font-mono text-sm font-semibold text-ruzova">
                  {index + 1} / 3
                </span>
                <h3 className="mt-2 font-display text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-inkoust-tlumeny">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── brokeři: hloubka místo šířky, poctivě po způsobu napojení ────── */}
        <section aria-labelledby="brokeri-nadpis" className="mt-24 lg:mt-32">
          <h2 id="brokeri-nadpis" className="font-display text-xl font-bold tracking-tight">
            Odkud umíme načíst obchody
          </h2>
          <ul className="mt-5 flex flex-wrap gap-3">
            {BROKERS.map((broker) => (
              <li
                key={broker.name}
                className="flex items-center gap-2 rounded-full border border-linka bg-plocha px-4 py-2 text-sm"
              >
                <span className="font-semibold">{broker.name}</span>
                {'live' in broker && broker.live ? (
                  <span className="rounded-full bg-ruzova/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-ruzova">
                    {broker.how}
                  </span>
                ) : (
                  <span className="text-inkoust-tlumeny">{broker.how}</span>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* ── ceník: jedna cena, žádné tarify ──────────────────────────────── */}
        <section aria-labelledby="cenik-nadpis" className="mt-24 lg:mt-32">
          <div className="mx-auto max-w-3xl rounded-lg border border-linka bg-plocha p-8 sm:p-10">
            <Eyebrow>Ceník</Eyebrow>
            <h2
              id="cenik-nadpis"
              className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              Teď v betě: všechno zdarma
            </h2>
            <p className="mt-3 text-inkoust-tlumeny">
              Po spuštění <strong className="font-mono text-lg text-inkoust">990 Kč ročně</strong>{' '}
              — jedna cena, žádné tarify. Stačí e-mail, karta ne.
            </p>
            <ul className="mt-6 grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {PRICING_INCLUDED.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm">
                  <IconCheck />
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <Link href="/registrace" className={CTA_PRIMARY}>
                Založit účet zdarma
              </Link>
            </div>
          </div>
        </section>

        {/* ── FAQ ───────────────────────────────────────────────────────────── */}
        <section aria-labelledby="faq-nadpis" className="mt-24 lg:mt-32">
          <h2 id="faq-nadpis" className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Časté otázky
          </h2>
          <div className="mt-8 max-w-3xl space-y-3">
            {FAQ.map((item) => (
              <details key={item.q} className="group rounded-lg border border-linka bg-plocha p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <IconPlus />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-inkoust-tlumeny">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── závěrečné CTA ─────────────────────────────────────────────────── */}
        <section aria-labelledby="zaver-nadpis" className="mt-24 lg:mt-32">
          <div className="rounded-lg border border-ruzova/30 bg-ruzova/5 px-6 py-12 text-center sm:py-16">
            <h2
              id="zaver-nadpis"
              className="mx-auto max-w-2xl font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              Prohlédni si Danero zevnitř — hned teď
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-inkoust-tlumeny">
              Demo běží nad vzorovým portfoliem za 1,16 milionu Kč: odměrky, horizont,
              simulátor i report. Bez registrace, nic se neukládá.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Link href="/demo/prehled" className={CTA_PRIMARY}>
                Vyzkoušet demo — bez registrace
              </Link>
              <Link href="/registrace" className={CTA_SECONDARY}>
                Založit účet zdarma
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="mt-20 space-y-3 border-t border-linka py-10 text-sm text-inkoust-tlumeny">
        <p>
          Danero je výpočetní a evidenční nástroj, nikoli daňové poradenství ve smyslu zákona
          č. 523/1992 Sb. Za správnost daňového přiznání odpovídá poplatník.
        </p>
        <p>
          <Link href="/podminky" className="font-medium hover:text-inkoust">
            Podmínky užití
          </Link>{' '}
          ·{' '}
          <Link href="/soukromi" className="font-medium hover:text-inkoust">
            Ochrana soukromí
          </Link>
        </p>
        {/* TODO(Jan): provozovatel — jméno/IČO/kontakt */}
      </footer>
    </div>
  );
}
