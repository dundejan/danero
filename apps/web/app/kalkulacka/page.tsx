import type { Metadata } from 'next';
import { KalkulackaPriznani } from '@/components/kalkulacka-priznani';
import { MarketingCta, MarketingPage, PageHero } from '@/components/marketing-page';

export const metadata: Metadata = {
  title: 'Musím podat daňové přiznání kvůli investicím? Kalkulačka zdarma — Danero',
  description:
    'Odpověz na pár otázek a zjisti orientačně, jestli se tě kvůli akciím, ETF či kryptu týká daňové přiznání. Zlaté pravidlo 100 000 Kč, tříletý časový test i limit 50 000 Kč pro paušální daň.',
};

const PRAVIDLA = [
  {
    title: 'Zlaté pravidlo 100 000 Kč',
    body: 'Jsou-li tvoje celkové tržby z prodeje cenných papírů za rok do 100 000 Kč, jsou všechny osvobozené — bez ohledu na zisk a bez tříletého čekání. Počítá se, kolik ti z prodejů přiteklo, ne kolik jsi vydělal. Kryptoaktiva mají od roku 2025 stejný limit zvlášť.',
  },
  {
    title: 'Tříletý časový test',
    body: 'Cenné papíry držené déle než 3 roky se při prodeji nedaní vůbec (do 40 mil. Kč ročně). Rozhoduje datum nákupu a prodeje konkrétních kusů — přesně to, co Danero hlídá v horizontu osvobození.',
  },
  {
    title: 'Limity pro podání přiznání',
    body: 'OSVČ v paušálním režimu smí mít max. 50 000 Kč zdanitelných příjmů mimo podnikání — patří sem neosvobozené prodeje, zahraniční dividendy (brutto!) i úroky. Zaměstnancům stačí hlídat 20 000 Kč vedlejších příjmů. Osvobozené prodeje se do limitů nepočítají.',
  },
] as const;

export default function KalkulackaPage() {
  return (
    <MarketingPage active="kalkulacka">
      <PageHero
        eyebrow="Kalkulačka"
        title="Musím kvůli investicím podat daňové přiznání?"
        lede="Pár otázek, okamžitá orientační odpověď. Nic se neukládá a na nic se neregistruješ — kalkulačka počítá jen z toho, co zaškrtneš."
      />

      <div className="mt-12">
        <KalkulackaPriznani showHeader={false} />
      </div>

      <section aria-labelledby="pravidla-nadpis" className="mt-24 lg:mt-32">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova-text">
          Jak to počítáme
        </p>
        <h2
          id="pravidla-nadpis"
          className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl"
        >
          Tři pravidla, která rozhodují
        </h2>
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {PRAVIDLA.map((pravidlo) => (
            <div key={pravidlo.title} className="rounded-lg border border-linka bg-plocha p-6">
              <h3 className="font-semibold">{pravidlo.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-inkoust-tlumeny">{pravidlo.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 max-w-3xl text-xs text-inkoust-tlumeny">
          Kalkulačka je orientační — nezná tvoje data. Přesný výpočet nad skutečnou historií
          účtu (párování nákupů a prodejů, kurzy ČNB, srážkové daně po státech) dělá až aplikace.
        </p>
      </section>

      <MarketingCta
        title="Ať to za tebe hlídá Danero — celý rok"
        lede="Napoj brokera nebo nahraj výpis a Danero ti limity, časové testy i podklady k přiznání pohlídá automaticky. Ozve se dřív, než nějaký limit překročíš."
        primary="registrace"
      />
    </MarketingPage>
  );
}
