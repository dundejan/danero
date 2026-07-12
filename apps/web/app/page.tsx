import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { HorizonStrip } from '@/components/horizon-strip';
import { WaitlistForm } from '@/components/waitlist-form';
import { PlatformGrid } from '@/components/platform-catalog';
import { LimitGauge } from '@/components/limit-gauge';
import { MarketingFooter, MarketingHeader } from '@/components/marketing-page';
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
    'Danero pohlídá, jestli a kolik máš z investic danit: limit 100 000 Kč, limit paušální daně i tříleté časové testy. V březnu podklady k přiznání včetně XML. Plné demo bez registrace.',
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



/* ── stavební prvky ───────────────────────────────────────────────────────── */

/** Mono štítek sekce — stejná řeč jako titulky karet uvnitř aplikace. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova-text">
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

/** Tabulka variant párování jako živé HTML (screenshot byl při 544 px nečitelný).
    Hodnoty odpovídají demo reportu za rok 2025 — tam se metody skutečně liší. */
const VARIANT_ROWS: {
  method: string;
  fx: string;
  base: string;
  tax: string;
  badge?: 'aktivní' | 'nejvýhodnější';
}[] = [
  { method: 'FIFO', fx: 'jednotný', base: '23 051', tax: '4 379', badge: 'aktivní' },
  { method: 'FIFO', fx: 'denní ČNB', base: '23 857', tax: '4 504', badge: 'aktivní' },
  { method: 'LIFO', fx: 'jednotný', base: '0', tax: '921', badge: 'nejvýhodnější' },
  { method: 'LIFO', fx: 'denní ČNB', base: '0', tax: '924' },
  { method: 'Max. zisk', fx: 'jednotný', base: '23 051', tax: '4 379' },
  { method: 'Max. zisk', fx: 'denní ČNB', base: '23 857', tax: '4 504' },
  { method: 'Max. ztráta', fx: 'jednotný', base: '0', tax: '921' },
  { method: 'Max. ztráta', fx: 'denní ČNB', base: '0', tax: '924' },
];

function VariantTableMock() {
  return (
    <div className="p-4 sm:p-5">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-wide text-inkoust-tlumeny">
        Porovnání variant párování
      </p>
      <table className="mt-2 w-full text-[13px]">
        <thead>
          <tr className="border-b border-linka text-left text-[11px] uppercase tracking-wide text-inkoust-tlumeny">
            <th scope="col" className="py-1.5 pr-3 font-medium">Metoda</th>
            <th scope="col" className="py-1.5 pr-3 font-medium">Kurzy</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">Základ § 10</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">Daň</th>
            <th scope="col" className="py-1.5 font-medium">
              <span className="sr-only">Stav</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {VARIANT_ROWS.map((row, i) => (
            <tr key={i} className="border-b border-linka/60 last:border-0">
              <td className="py-1.5 pr-3 font-medium">{row.method}</td>
              <td className="py-1.5 pr-3 text-inkoust-tlumeny">{row.fx}</td>
              <td className="whitespace-nowrap py-1.5 pr-3 text-right font-mono tabular-nums">{row.base} Kč</td>
              <td className="whitespace-nowrap py-1.5 pr-3 text-right font-mono tabular-nums">{row.tax} Kč</td>
              <td className="py-1.5 text-right">
                {row.badge === 'nejvýhodnější' && (
                  <span className="whitespace-nowrap rounded-full bg-ruzova/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-ruzova-text">
                    nejvýhodnější
                  </span>
                )}
                {row.badge === 'aktivní' && (
                  <span className="rounded-full bg-pozadi px-2 py-0.5 font-mono text-[11px] text-inkoust-tlumeny">
                    aktivní
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CTA_PRIMARY =
  'inline-block rounded-md bg-ruzova-syta px-6 py-3 font-semibold text-white hover:opacity-90';
// sekundární CTA: border z inkoustu (linka měla na ploše kontrast jen 1,07:1
// a tlačítko zanikalo) + shadow-sm; v dark módu je inkoust světlý, takže
// vyšší alpha border naopak zesvětlí
const CTA_SECONDARY =
  'inline-block rounded-md border border-inkoust/25 bg-plocha px-6 py-3 font-semibold shadow-sm hover:border-ruzova hover:text-ruzova dark:border-inkoust/40';

/* ── obsah ────────────────────────────────────────────────────────────────── */

const TRUST = [
  // přesně „XML podání" — podatelna ověřuje strukturu podání, ne věcnou
  // správnost výpočtů (nález V-5 právního auditu; detail vysvětluje FAQ)
  { icon: <IconStamp />, text: 'XML podání ověřená zkušební podatelnou EPO' },
  { icon: <IconScale />, text: 'Počítáme opatrně — a ukážeme, kolik by šlo ušetřit' },
  { icon: <IconKey />, text: 'API klíče jen pro čtení, šifrované AES-256-GCM' },
  { icon: <IconEye />, text: 'Plné demo bez registrace' },
] as const;

const STEPS = [
  {
    title: 'Připoj svého brokera',
    body: 'Trading 212, Interactive Brokers i Lynx živě přes API klíč jen pro čtení — žádná hesla, žádné právo obchodovat. Odjinud nahraješ výpis: čteme jich přes 25, od XTB a Degiro po eToro, Schwab, Portu nebo Coinbase.',
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
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />

      <main id="obsah" className="mx-auto w-full max-w-6xl flex-1 px-6">
        {/* ── hero: úleva + skutečná aplikace se živými upozorněními ───────── */}
        <section aria-labelledby="hero-nadpis" className="pt-12 md:pt-20">
          <h1
            id="hero-nadpis"
            className="max-w-4xl text-balance font-display text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl"
          >
            Daně z investic hlídáme za tebe.{' '}
            {/* nezlomitelné mezery: „ne jen“ a „v březnu“ se nesmí rozpadnout */}
            <span className="block text-ruzova">Celý rok, ne{' '}jen v{' '}březnu.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-inkoust-tlumeny">
            Danero pohlídá, jestli a kolik máš z investic danit — a ozve se dřív, než
            tě prodej nebo dividenda bude stát daň navíc. V březnu stáhneš hotové
            podklady k přiznání včetně XML. Trading 212, Interactive Brokers a Lynx
            živě přes API; výpisy ze 17 dalších platforem čteme automaticky a u českých
            bank tě provedeme šablonou.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link href="/demo/prehled" className={CTA_PRIMARY}>
              Vyzkoušet demo — bez registrace
            </Link>
            <Link href="/registrace" className={CTA_SECONDARY}>
              Založit účet zdarma
            </Link>
          </div>
          <p className="mt-3 text-sm text-inkoust-tlumeny">
            Teď v betě: všechno zdarma. Nevíš, jestli se tě přiznání vůbec týká?{' '}
            <Link
              href="/kalkulacka"
              className="font-medium text-ruzova-text underline underline-offset-2"
            >
              Zjisti to za minutu v kalkulačce
            </Link>
            .
          </p>

          {/* skutečný screenshot přehledu + živé karty hlídače nad rohy;
              na mobilu by z dashboardu zbyla nečitelná šmouha (~5px text) —
              místo něj se ukážou samotné živé karty hlídače */}
          <div className="mt-10 space-y-3 md:hidden">
            {[exemptionSoon, limitBroken].map(
              (candidate) =>
                candidate && (
                  <div
                    key={candidate.dedupeKey}
                    className="rounded-lg border border-linka bg-plocha p-4 shadow-lg shadow-inkoust/10"
                  >
                    <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-wide text-inkoust-tlumeny">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${candidate === limitBroken ? 'bg-cervena' : 'bg-zelena'}`}
                        aria-hidden
                      />
                      Upozornění z hlídače
                    </p>
                    <p className="mt-1.5 text-sm font-semibold">{candidate.title}</p>
                    <p className="mt-0.5 line-clamp-3 text-xs text-inkoust-tlumeny">
                      {candidate.body}
                    </p>
                  </div>
                ),
            )}
          </div>
          <div className="relative mt-14 hidden md:block">
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
                alt="Přehled aplikace Danero: verdikt „podáš daňové přiznání“ a ukazatele čerpání limitů"
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
                <p className="mt-0.5 line-clamp-3 text-xs text-inkoust-tlumeny">
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
                <p className="mt-0.5 line-clamp-3 text-xs text-inkoust-tlumeny">
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
                zahraničních dividend, na které se zapomíná. Čerpání vidíš celý rok a při
                60, 85 a 100 % ti přijde e-mail.{' '}
                <strong className="text-inkoust">
                  Ozveme se, dokud se s tím dá něco dělat
                </strong>{' '}
                — další prodej si rozmyslíš, nebo ho necháš na leden.
              </p>
            </div>
            {/* živé komponenty aplikace nad demo daty — žádný obrázek */}
            <div className="space-y-4">
              <LimitGauge
                label="Limit paušální daně — 50 000 Kč"
                hint="Zdanitelné příjmy z investic mimo podnikání — dividendy, úroky, neosvobozené prodeje."
                status={result.limits.flatTax50k.status}
                headingAs="h3"
              />
              <LimitGauge
                label="Osvobození prodejů CP — 100 000 Kč"
                hint="Do 100 000 Kč tržeb z prodejů za rok jsou všechny prodeje osvobozené."
                status={result.limits.limit100k}
                headingAs="h3"
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
          <p className="mt-6">
            <Link
              href="/demo/prehled"
              className="font-medium text-ruzova-text underline underline-offset-2"
            >
              Vyzkoušej si živé tečky v demu →
            </Link>
          </p>
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
                přiznání — a XML pro podatelnu mojedane.cz, ověřené testovací podatelnou EPO{' '}
                <span className="text-sm">
                  (struktura pro rok 2026 vyjde začátkem 2027 — ověřujeme každý rok)
                </span>
                .
              </p>
              <p className="mt-3 text-inkoust-tlumeny">
                Zápočet zahraniční srážky po státech (Příloha č. 3) včetně smluvních stropů
                — třeba Nizozemsko má 10 %, ne 15. Excel tohle nehlídá.
              </p>
            </div>
            {/* místo screenshotu (text byl při 544px nečitelný ~5px) živá HTML
                tabulka — ostrá v každé velikosti, nativní dark mode; čísla jsou
                skutečné z demo reportu za rok 2025, kde se metody párování liší */}
            <div className="hidden sm:block">
              <BrowserFrame url="danero.cz/report">
                <VariantTableMock />
              </BrowserFrame>
              <p className="mt-3 text-xs text-inkoust-tlumeny">
                Skutečná čísla z{' '}
                <Link
                  href="/demo/report?rok=2025"
                  className="text-ruzova-text underline underline-offset-2"
                >
                  demo reportu
                </Link>{' '}
                — celou tabulku (4 metody × 2 kurzy) si projdeš v demu.
              </p>
            </div>
            <div className="rounded-lg border border-linka bg-plocha p-5 sm:hidden">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-wide text-inkoust-tlumeny">
                Porovnání variant párování
              </p>
              <ul className="mt-2 divide-y divide-linka text-sm">
                <li className="flex items-baseline justify-between gap-3 py-2.5">
                  <span className="font-semibold">
                    FIFO{' '}
                    <span className="font-normal text-inkoust-tlumeny">· jednotný kurz</span>
                  </span>
                  <span className="text-right tabular-nums">
                    {'daň 4\u00A0379\u00A0Kč'}{' '}
                    <span className="rounded-full bg-pozadi px-2 py-0.5 font-mono text-[11px] text-inkoust-tlumeny">
                      aktivní
                    </span>
                  </span>
                </li>
                <li className="flex items-baseline justify-between gap-3 py-2.5">
                  <span className="font-semibold">
                    FIFO <span className="font-normal text-inkoust-tlumeny">· denní ČNB</span>
                  </span>
                  <span className="tabular-nums">{'daň 4\u00A0504\u00A0Kč'}</span>
                </li>
                <li className="flex items-baseline justify-between gap-3 py-2.5">
                  <span className="font-semibold">
                    LIFO{' '}
                    <span className="font-normal text-inkoust-tlumeny">· jednotný kurz</span>
                  </span>
                  <span className="text-right tabular-nums">
                    {'daň 921\u00A0Kč'}{' '}
                    <span className="rounded-full bg-ruzova/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-ruzova-text">
                      nejvýhodnější
                    </span>
                  </span>
                </li>
              </ul>
              <p className="mt-3 text-xs text-inkoust-tlumeny">
                Skutečná čísla z demo reportu za rok 2025 — celou tabulku (4 metody × 2 kurzy) si
                projdeš v demu.
              </p>
            </div>
          </div>
        </section>

        {/* ── jak to funguje: skutečná posloupnost → číslování dává smysl ──── */}
        <section id="jak-to-funguje" aria-labelledby="kroky-nadpis" className="mt-24 lg:mt-32">
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

        {/* ── platformy: plná šířka nabídky (parita s konkurencí) ──────────── */}
        <section aria-labelledby="brokeri-nadpis" className="mt-24 lg:mt-32">
          <Eyebrow>Brokeři a platformy</Eyebrow>
          <h2
            id="brokeri-nadpis"
            className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl"
          >
            Odkud umíme načíst obchody
          </h2>
          <p className="mt-4 max-w-2xl text-inkoust-tlumeny">
            Trading 212, Interactive Brokers a Lynx živě přes API. Výpisy z dalších
            platforem čteme automaticky — a u českých bank a fondů tě provedeme
            univerzální šablonou. U každé platformy máme návod, kde přesně výpis
            stáhnout.
          </p>
          <div className="mt-8">
            <PlatformGrid limit={9} />
          </div>
          <p className="mt-4 text-sm text-inkoust-tlumeny">
            <Link
              href="/platformy"
              className="font-medium text-ruzova-text underline underline-offset-2"
            >
              Všechny platformy s návody, kde výpis stáhnout →
            </Link>
          </p>
        </section>

        {/* ── ceník: teaser — detailní ceník má vlastní stránku /cenik ─────── */}
        <section id="cenik" aria-labelledby="cenik-nadpis" className="mt-24 lg:mt-32">
          <div className="rounded-lg border border-linka bg-plocha p-8 sm:p-10">
            <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <div>
                <Eyebrow>Ceník</Eyebrow>
                <h2
                  id="cenik-nadpis"
                  className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl"
                >
                  Teď v betě: všechno zdarma
                </h2>
                {/* částky v běžném textu proporcionálně (tabular-nums), mono jen štítky */}
                <p className="mt-3 text-inkoust-tlumeny">
                  Po spuštění{' '}
                  <strong className="text-lg text-inkoust tabular-nums">990 Kč ročně</strong> —
                  necelých <span className="tabular-nums">83 Kč</span> měsíčně. Jedna cena,
                  žádné tarify, všechny funkce pro každého. Stačí e-mail, karta ne.
                </p>
                <p className="mt-4">
                  <Link
                    href="/cenik"
                    className="font-medium text-ruzova-text underline underline-offset-2"
                  >
                    Co všechno je v ceně →
                  </Link>
                </p>
              </div>
              <div className="flex flex-col items-start gap-3 lg:items-end">
                <Link href="/registrace" className={CTA_PRIMARY}>
                  Založit účet zdarma
                </Link>
                <p className="text-xs text-inkoust-tlumeny">
                  Bez karty a bez závazků — po betě se rozhodneš sám.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── waitlist: režim před veřejným otevřením — na produkci se zapíná
            NEXT_PUBLIC_WAITLIST=1, dokud beta nepřijímá veřejnost (docs/12 P0) */}
        {process.env.NEXT_PUBLIC_WAITLIST === '1' && (
          <section aria-labelledby="waitlist-nadpis" className="mt-24 lg:mt-32">
            <div className="rounded-lg border border-linka bg-plocha p-8 sm:p-10">
              <div className="max-w-2xl">
                <Eyebrow>Otevíráme na podzim</Eyebrow>
                <h2
                  id="waitlist-nadpis"
                  className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl"
                >
                  Buď u toho mezi prvními
                </h2>
                <p className="mt-3 text-inkoust-tlumeny">
                  Danero teď ladíme se zakládajícími uživateli. Nech nám e-mail
                  a dostaneš přístup hned, jak otevřeme — ještě před daňovou sezónou.
                </p>
                <div className="mt-6">
                  <WaitlistForm />
                </div>
              </div>
            </div>
          </section>
        )}

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
              Demo běží nad vzorovým portfoliem s 50+ pozicemi za zhruba 2 miliony Kč:
              ukazatele limitů, horizont osvobození, simulátor i report. Bez registrace, nic se neukládá.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Link href="/demo/prehled" className={CTA_PRIMARY}>
                Vyzkoušet demo — bez registrace
              </Link>
              <Link href="/registrace" className={CTA_SECONDARY}>
                Založit účet zdarma
              </Link>
            </div>
            <p className="mt-6 text-sm text-inkoust-tlumeny">
              Ještě něco nevíš? Projdi si{' '}
              <Link
                href="/caste-otazky"
                className="font-medium text-ruzova-text underline underline-offset-2"
              >
                časté otázky
              </Link>{' '}
              nebo se podívej,{' '}
              <Link
                href="/o-projektu"
                className="font-medium text-ruzova-text underline underline-offset-2"
              >
                kdo za Danerem stojí
              </Link>
              .
            </p>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
