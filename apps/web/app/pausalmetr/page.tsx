import type { Metadata } from 'next';
import Link from 'next/link';
import { Pausalmetr } from '@/components/pausalmetr';
import { MarketingCta, MarketingPage, PageHero } from '@/components/marketing-page';

export const metadata: Metadata = {
  title: 'Paušálmetr: limit 50 000 Kč pro OSVČ v paušálním režimu — Danero',
  description:
    'OSVČ v paušální dani smí mít max. 50 000 Kč zdanitelných příjmů mimo podnikání — počítají se i zahraniční dividendy a úroky. Orientační kalkulačka zdarma, bez registrace.',
};

const FAKTA: { title: string; body: React.ReactNode }[] = [
  {
    title: 'Proč se to týká zrovna investic',
    body: (
      <>
        Do limitu 50 000 Kč se počítají zdanitelné příjmy mimo tvou samostatnou
        činnost — a to jsou u investora hlavně zahraniční dividendy (v hrubé výši,
        před sražením daně v cizině), úroky a neosvobozené prodeje. České dividendy
        a úroky z české banky se nepočítají — daň z nich strhává plátce.
      </>
    ),
  },
  {
    title: 'Co se stane při prolomení',
    body: (
      <>
        Za daný rok nemůžeš daň vyřídit paušálem: podáváš daňové přiznání
        a přehledy pro ČSSZ a zdravotní pojišťovnu — přesně to papírování, kvůli
        kterému sis paušál platil. V paušálním režimu ale zůstáváš a od dalšího
        roku (při dodržení limitu) zase jedeš bez přiznání.
      </>
    ),
  },
  {
    title: 'Osvobozené prodeje se nepočítají',
    body: (
      <>
        Prodeje cenných papírů do 100 000 Kč tržeb za rok nebo po třech letech
        držení jsou osvobozené — a osvobozené příjmy limit neplní. Proto se
        vyplatí hlídat oba limity najednou: 100 000 Kč rozhoduje o osvobození,
        50 000 Kč o paušálu.
      </>
    ),
  },
  {
    title: 'Kurz dělá rozdíl',
    body: (
      <>
        Dividendy chodí v dolarech či eurech, limit je v korunách — počítá se
        přepočet podle pravidel daně z příjmů. Pár dolarů sem tam vypadá nevinně,
        ale 40 dividend za rok se sečte rychleji, než čekáš.
      </>
    ),
  },
];

export default function PausalmetrPage() {
  return (
    <MarketingPage>
      <PageHero
        eyebrow="Paušálmetr"
        title="Kolik ti zbývá do limitu 50 000 Kč?"
        lede="Jsi OSVČ v paušálním režimu a investuješ? Orientačně si spočítej, jak moc se blížíš hranici, za kterou se vrací přiznání i přehledy. Nic se neukládá."
      />

      <div className="mt-12">
        <Pausalmetr />
      </div>

      <section aria-labelledby="pm-vysvetleni" className="mt-24 lg:mt-32">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova-text">
          Jak to funguje
        </p>
        <h2
          id="pm-vysvetleni"
          className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl"
        >
          Limit, o kterém se nemluví
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {FAKTA.map((fakt) => (
            <div key={fakt.title} className="rounded-lg border border-linka bg-plocha p-6">
              <h3 className="font-semibold">{fakt.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-inkoust-tlumeny">{fakt.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 max-w-3xl text-xs text-inkoust-tlumeny">
          Orientační pomůcka — přesný výpočet nad skutečnou historií účtu (kurzy ČNB,
          posouzení osvobození u každého prodeje) dělá aplikace. Nejsi v paušálu?
          Podobné limity platí i pro zaměstnance (20 000 Kč) — zjisti víc v{' '}
          <Link
            href="/kalkulacka"
            className="font-medium text-ruzova-text underline underline-offset-2"
          >
            kalkulačce přiznání
          </Link>
          .
        </p>
      </section>

      <MarketingCta
        title="Danero ten limit hlídá za tebe — celý rok"
        lede="Napoj brokera nebo nahraj výpis. Každou dividendu přepočítáme správným kurzem, osvobozené prodeje vyřadíme a při 60, 85 a 100 % limitu ti napíšeme."
        primary="registrace"
      />
    </MarketingPage>
  );
}
