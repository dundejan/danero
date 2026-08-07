import type { Metadata } from 'next';
import Link from 'next/link';
import { FaqList } from '@/components/faq-list';
import { IconCheck } from '@/components/marketing-icons';
import { MarketingCta, MarketingPage, PageHero } from '@/components/marketing-page';
import { EPO_SUPPORTED_YEARS } from '@/lib/epo';
import { yearList } from '@/lib/format';
import { SANDBOX_NOTICE, stripeSandboxInProduction } from '@/lib/stripe';

export const metadata: Metadata = {
  title: 'Ceník — Danero',
  description:
    'Nahrát výpisy a zjistit, jak na tom jsi, je v Daneru zdarma. Podklady k přiznání za jeden rok 490 Kč, celoroční hlídání s napojením na brokery 990 Kč ročně.',
};

const FREE = [
  'Import výpisů — neomezeně platforem',
  'Limity 100 000 Kč i 50 000 Kč v reálném čase',
  'Stav tříletých časových testů',
  'Horizont osvobození: kdy je co bez daně',
  'Orientační daň z investic',
  'Krypto i deriváty jako samostatné druhy příjmů',
] as const;

const ONE_OFF = [
  'Všechno ze zdarma',
  'Čísla přesně do řádků přiznání',
  // roky se berou z konfigurace EPO — kupující musí vědět PŘED zaplacením,
  // za které roky XML existuje (§ 1820/1 r OZ, nález E-29)
  `XML pro elektronické podání (roky ${yearList(EPO_SUPPORTED_YEARS)})`,
  'Rozpad na jednotlivé nákupy a použité kurzy',
  'Srovnání variant výpočtu (FIFO/LIFO, kurzy)',
] as const;

const FULL = [
  'Všechno z podkladů — za všechny daňové roky',
  'Živé napojení na Trading 212, IBKR i Lynx',
  'Automatický denní sync a přepočet',
  'E-mailová upozornění na limity a termíny',
  'Simulátor prodeje: co udělá další obchod',
] as const;

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
    a: 'Podklady za 490 Kč, když víš, že letos přiznání podáváš, a víc od Danera nechceš. Hlídání za 990 Kč, když chceš mít klid celý rok — Danero pak samo sleduje limity a časové testy, ozve se e-mailem a podklady máš za všechny roky v ceně.',
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

export default function CenikPage() {
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
          <div className="rounded-lg border border-linka bg-plocha p-8">
            <p className="font-mono text-xs font-semibold uppercase tracking-wide text-inkoust-tlumeny">
              Zdarma
            </p>
            <p className="mt-3 font-display text-4xl font-bold tracking-tight">0 Kč</p>
            <p className="mt-2 text-sm text-inkoust-tlumeny">navždy, bez karty</p>
            <ul className="mt-6 grid gap-3">
              {FREE.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm">
                  <IconCheck />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/registrace"
              className="mt-6 inline-block w-full rounded-md border border-linka px-6 py-3 text-center font-semibold hover:border-inkoust-tlumeny"
            >
              Založit účet
            </Link>
          </div>

          <div className="rounded-lg border border-linka bg-plocha p-8">
            <p className="font-mono text-xs font-semibold uppercase tracking-wide text-inkoust-tlumeny">
              Podklady za rok
            </p>
            <p className="mt-3 font-display text-4xl font-bold tracking-tight">490 Kč</p>
            <p className="mt-2 text-sm text-inkoust-tlumeny">
              jednorázově za jeden daňový rok
            </p>
            <ul className="mt-6 grid gap-3">
              {ONE_OFF.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm">
                  <IconCheck />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/registrace"
              className="mt-6 inline-block w-full rounded-md border border-linka px-6 py-3 text-center font-semibold hover:border-inkoust-tlumeny"
            >
              Začít zdarma
            </Link>
            <p className="mt-2 text-center text-xs text-inkoust-tlumeny">
              koupíš až ve chvíli, kdy podklady potřebuješ
            </p>
          </div>

          <div className="rounded-lg border border-ruzova/30 bg-ruzova/5 p-8">
            <p className="font-mono text-xs font-semibold uppercase tracking-wide text-ruzova-text">
              Celoroční hlídání
            </p>
            <p className="mt-3 font-display text-4xl font-bold tracking-tight">
              990 Kč <span className="text-lg font-semibold text-inkoust-tlumeny">/ rok</span>
            </p>
            <p className="mt-2 text-sm text-inkoust-tlumeny">
              necelých 83 Kč měsíčně — méně než jedna chyba v přiznání
            </p>
            <ul className="mt-6 grid gap-3">
              {FULL.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm">
                  <IconCheck />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/registrace"
              className="mt-6 inline-block w-full rounded-md bg-ruzova-syta px-6 py-3 text-center font-semibold text-white hover:opacity-90"
            >
              Založit účet
            </Link>
            <p className="mt-2 text-center text-xs text-inkoust-tlumeny">
              obnova s e-mailem 14 dní předem, zrušíš kdykoli
            </p>
          </div>
        </div>
        <p className="mt-6 text-center text-sm text-inkoust-tlumeny">
          Ceny jsou konečné. Danero si můžeš{' '}
          <a
            href="https://github.com/dundejan/danero"
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
