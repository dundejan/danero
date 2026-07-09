import Link from 'next/link';

const FEATURES = [
  {
    title: 'Hlídá limity dřív, než je prolomíš',
    body: 'Limit 100 000 Kč z prodejů i limit 50 000 Kč pro paušální daň — včetně zahraničních dividend, na které se zapomíná. Odměrky ti ukazují čerpání celý rok, ne až v dubnu.',
  },
  {
    title: 'Horizont osvobození',
    body: 'Každá tvoje pozice putuje po časové ose k tříletému testu. Vidíš na den přesně, kdy se který nákup osvobodí — a e-mail ti přijde 30 a 7 dní předem.',
  },
  {
    title: 'Simulátor prodeje',
    body: '„Co když teď prodám?“ Danero spočítá dopad na limity i daň ještě před obchodem. Žádná překvapení zpětně — rozhoduješ se s čísly na stole.',
  },
  {
    title: 'Podklady k přiznání',
    body: 'Dílčí základy § 8 a § 10 — akcie, krypto i opce zvlášť, porovnání metod párování, zápočet zahraniční srážky po státech a XML pro mojedane.cz (za uzavřený rok).',
  },
];

const STEPS = [
  { step: '1', title: 'Připoj brokera', body: 'Trading212 či IBKR přes klíč jen pro čtení; XTB, Degiro a Fio výpisem. Žádná hesla, žádné právo obchodovat.' },
  { step: '2', title: 'Danero stáhne historii', body: 'Celou, od založení účtu, automaticky — včetně splitů a spin-offů. A pak ji denně aktualizuje.' },
  { step: '3', title: 'Investuj v klidu', body: 'Limity, časové testy i daňový dopad prodejů máš pod dohledem. Ozveme se, jen když se něco děje.' },
];

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
    q: 'Nahrazuje Danero daňového poradce?',
    a: 'Ne. Danero je výpočetní a evidenční nástroj — počítá podle zveřejněné metodiky a sporné výklady označuje. Za přiznání odpovídá vždy poplatník.',
  },
];

export default function LandingPage() {
  return (
    <main className="mx-auto max-w-4xl px-6">
      <header className="flex items-center justify-between py-6">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-ruzova" aria-hidden />
          <span className="font-display text-lg font-bold tracking-tight">Danero</span>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/prihlaseni" className="font-medium text-inkoust-tlumeny hover:text-inkoust">
            Přihlásit se
          </Link>
          <Link
            href="/registrace"
            className="rounded-md bg-ruzova-syta px-4 py-2 font-semibold text-white hover:opacity-90"
          >
            Vyzkoušet zdarma
          </Link>
        </nav>
      </header>

      <section className="space-y-6 py-16">
        <h1 className="max-w-2xl font-display text-5xl font-bold leading-tight tracking-tight">
          Investuj. <span className="text-ruzova">Daně pohlídáme.</span>
        </h1>
        <p className="max-w-xl text-lg text-inkoust-tlumeny">
          Tříletý časový test, limit 100 000 Kč z prodejů, limit 50 000 Kč pro paušální
          daň. Danero je hlídá celý rok a před každým prodejem ti řekne, co udělá s tvými
          daněmi.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/registrace"
            className="rounded-md bg-ruzova-syta px-5 py-2.5 font-semibold text-white hover:opacity-90"
          >
            Vyzkoušet zdarma
          </Link>
          <Link
            href="/demo"
            className="rounded-md border border-linka px-5 py-2.5 font-semibold hover:border-ruzova hover:text-ruzova"
          >
            Osahat si demo
          </Link>
          <span className="text-sm text-inkoust-tlumeny">Beta — stačí e-mail, bez karty.</span>
        </div>
      </section>

      {/* signatura: horizont osvobození */}
      <section aria-hidden className="relative h-20 overflow-hidden rounded-lg border border-linka bg-plocha">
        <div className="absolute inset-y-0 left-1/3 w-px bg-ruzova" />
        <span className="absolute left-1/3 top-1.5 -translate-x-1/2 font-mono text-[10px] text-ruzova">
          dnes
        </span>
        <div className="absolute inset-y-0 left-0 flex w-full items-center">
          <span className="absolute left-[10%] h-2.5 w-2.5 rounded-full bg-zelena" />
          <span className="absolute left-[19%] h-2 w-2 rounded-full bg-zelena" />
          <span className="absolute left-[27%] h-3 w-3 rounded-full bg-zelena" />
          <span className="absolute left-[46%] h-2 w-2 rounded-full bg-inkoust-tlumeny" />
          <span className="absolute left-[58%] h-3 w-3 rounded-full bg-inkoust-tlumeny" />
          <span className="absolute left-[71%] h-2 w-2 rounded-full bg-inkoust-tlumeny" />
          <span className="absolute left-[84%] h-2.5 w-2.5 rounded-full bg-inkoust-tlumeny" />
        </div>
        <p className="absolute bottom-1.5 right-3 font-mono text-[10px] text-inkoust-tlumeny">
          každá tečka = tvoje pozice na cestě k osvobození
        </p>
      </section>

      <section className="grid gap-4 py-16 sm:grid-cols-2">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="rounded-lg border border-linka bg-plocha p-5">
            <h2 className="font-display text-lg font-semibold">{feature.title}</h2>
            <p className="mt-2 text-sm text-inkoust-tlumeny">{feature.body}</p>
          </div>
        ))}
      </section>

      <section className="space-y-6 pb-16">
        <h2 className="font-display text-2xl font-bold">Jak to funguje</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((item) => (
            <div key={item.step} className="rounded-lg border border-linka bg-plocha p-5">
              <span className="font-mono text-sm font-semibold text-ruzova">{item.step}</span>
              <h3 className="mt-1 font-semibold">{item.title}</h3>
              <p className="mt-1 text-sm text-inkoust-tlumeny">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4 pb-16">
        <h2 className="font-display text-2xl font-bold">Kolik to stojí</h2>
        <div className="rounded-lg border border-linka bg-plocha p-6">
          <p className="text-lg">
            <strong>Teď v betě: všechno zdarma.</strong>
          </p>
          <p className="mt-2 text-sm text-inkoust-tlumeny">
            Po spuštění zůstane hlídač limitů a časových testů pro jednoho brokera zdarma;
            plná verze (daňové podklady, upozornění, více účtů) bude stát{' '}
            <strong className="text-inkoust">990 Kč ročně</strong>.
          </p>
        </div>
      </section>

      <section className="space-y-4 pb-16">
        <h2 className="font-display text-2xl font-bold">Časté otázky</h2>
        <div className="space-y-3">
          {FAQ.map((item) => (
            <details key={item.q} className="rounded-lg border border-linka bg-plocha p-4">
              <summary className="cursor-pointer font-semibold">{item.q}</summary>
              <p className="mt-2 text-sm text-inkoust-tlumeny">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="space-y-2 border-t border-linka py-8 text-sm text-inkoust-tlumeny">
        <p>
          Danero je výpočetní a evidenční nástroj, nikoli daňové poradenství ve smyslu
          zákona č. 523/1992 Sb. Za správnost daňového přiznání odpovídá poplatník.
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
      </footer>
    </main>
  );
}
