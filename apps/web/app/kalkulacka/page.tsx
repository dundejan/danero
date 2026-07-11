import type { Metadata } from 'next';
import Link from 'next/link';
import { KalkulackaPriznani } from '@/components/kalkulacka-priznani';
import { MarketingFooter, MarketingHeader } from '@/components/marketing-page';

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
    <div className="mx-auto max-w-3xl px-6">
      <MarketingHeader />
      <main className="pt-8 md:pt-12">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova">
          Kalkulačka
        </p>
        <h1 className="mt-3 text-balance font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Musím kvůli investicím podat daňové přiznání?
        </h1>
        <p className="mt-4 text-inkoust-tlumeny">
          Pár otázek, okamžitá orientační odpověď. Nic se neukládá a na nic se
          neregistruješ — kalkulačka počítá jen z toho, co zaškrtneš.
        </p>

        <div className="mt-8">
          <KalkulackaPriznani showHeader={false} />
        </div>

        <section aria-labelledby="pravidla-nadpis" className="mt-16">
          <h2 id="pravidla-nadpis" className="font-display text-2xl font-bold tracking-tight">
            Tři pravidla, která rozhodují
          </h2>
          <div className="mt-6 space-y-4">
            {PRAVIDLA.map((pravidlo) => (
              <div key={pravidlo.title} className="rounded-lg border border-linka bg-plocha p-5">
                <h3 className="font-semibold">{pravidlo.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-inkoust-tlumeny">
                  {pravidlo.body}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-inkoust-tlumeny">
            Kalkulačka je orientační — nezná tvoje data. Přesný výpočet nad skutečnou
            historií účtu (párování nákupů a prodejů, kurzy ČNB, srážkové daně po státech)
            dělá až aplikace.
          </p>
        </section>

        <section className="mt-16 rounded-lg border border-ruzova/30 bg-ruzova/5 px-6 py-10 text-center">
          <h2 className="font-display text-2xl font-bold tracking-tight">
            Ať to za tebe hlídá Danero — celý rok
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm text-inkoust-tlumeny">
            Napoj brokera nebo nahraj výpis a Danero ti limity, časové testy i podklady
            k přiznání pohlídá automaticky. Ozve se dřív, než něco prolomíš.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-4">
            <Link
              href="/demo/prehled"
              className="inline-block rounded-md bg-ruzova-syta px-6 py-3 font-semibold text-white hover:opacity-90"
            >
              Vyzkoušet demo — bez registrace
            </Link>
            <Link
              href="/registrace"
              className="inline-block rounded-md border border-inkoust/25 bg-plocha px-6 py-3 font-semibold shadow-sm hover:border-ruzova hover:text-ruzova dark:border-inkoust/40"
            >
              Založit účet zdarma
            </Link>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
