import Link from 'next/link';
import { MarketingPage } from '@/components/marketing-page';

export const metadata = {
  title: 'Odstoupení od smlouvy — Danero',
  description:
    'Poučení o právu odstoupit od smlouvy do 14 dnů a vzorový formulář pro odstoupení.',
};

/** Poučení o odstoupení + vzorový formulář (§ 1820 OZ, NV 29/2023 Sb.). */
export default function OdstoupeniPage() {
  return (
    <MarketingPage>
      <div className="mx-auto max-w-2xl space-y-6 py-12 md:py-16">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova-text">
            Právní
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
            Odstoupení od smlouvy
          </h1>
        </div>

        <section className="space-y-3 text-sm leading-relaxed">
          <h2 className="font-display text-lg font-semibold">Máš 14 dní</h2>
          <p>
            Jsi-li spotřebitel, můžeš od smlouvy odstoupit do 14 dnů ode dne jejího
            uzavření, a to bez udání důvodu a bez sankce. Stačí nám to v té lhůtě
            oznámit — e-mailem na{' '}
            <a href="mailto:dunder.jan@gmail.com" className="font-medium text-ruzova">
              dunder.jan@gmail.com
            </a>
            . Peníze ti vrátíme nejpozději do 14 dnů od doručení odstoupení, stejným
            způsobem, jakým jsi platil.
          </p>

          <h2 className="font-display text-lg font-semibold">
            Kdy právo odstoupit zaniká (a proč se tě to nejspíš týká)
          </h2>
          <p>
            Danero je digitální obsah, který dodáváme okamžitě — hned po zaplacení máš
            funkce odemčené. U takového plnění právo odstoupit zaniká, pokud jsi{' '}
            <strong>výslovně požádal, abychom začali plnit před uplynutím lhůty</strong>,
            a vzal na vědomí, že tím právo odstoupit ztrácíš (§ 1837 písm. l občanského
            zákoníku). Přesně tohle potvrzuješ zaškrtnutím políčka u objednávky —
            bez něj nákup nedokončíš a políčko není předškrtnuté.
          </p>
          <p>
            Píšeme to takhle natvrdo schválně: je to jediné místo, kde ti nákupem něco
            ubude, a nechceme, aby to bylo schované v podmínkách. Pokud si dodání hned
            nepřeješ, nekupuj a napiš nám — domluvíme se.
          </p>

          <h2 className="font-display text-lg font-semibold">Vzorový formulář</h2>
          <p>
            Použít ho nemusíš, stačí jakékoli jednoznačné oznámení. Ale když se ti hodí,
            zkopíruj si tenhle:
          </p>
          <pre className="overflow-x-auto rounded-md border border-linka bg-papir-tlumeny p-4 text-xs leading-relaxed">
{`Adresát: Jan Dunder, IČO 19642661
adresa-provozovatele-v-promenne-prostredi
dunder.jan@gmail.com

Oznamuji, že tímto odstupuji od smlouvy o poskytnutí
digitálního obsahu / služby:

Objednáno dne: ..........................................
Jméno spotřebitele: .....................................
E-mail účtu v Daneru: ...................................
Adresa spotřebitele: ....................................

Podpis (jen pokud posíláš v listinné podobě): ...........
Datum: ..................................................`}
          </pre>

          <h2 className="font-display text-lg font-semibold">Když něco nefunguje</h2>
          <p>
            Odstoupení není jediná cesta. Když Danero nepočítá, co má, nebo ti nesedí
            výsledek, napiš — vady řešíme podle zákona (práva z vadného plnění) a
            v praxi to skoro vždycky znamená, že chybu opravíme, nebo ti vrátíme peníze
            bez ohledu na lhůty.
          </p>
        </section>

        <p className="text-sm">
          <Link href="/podminky" className="font-medium text-ruzova">
            ← Podmínky užití
          </Link>
        </p>
      </div>
    </MarketingPage>
  );
}
