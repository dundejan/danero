import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingFooter, MarketingHeader } from '@/components/marketing-page';
import { PlatformCatalog } from '@/components/platform-catalog';

export const metadata: Metadata = {
  title: 'Podporovaní brokeři a platformy — Danero',
  description:
    'Trading 212, Interactive Brokers a Lynx živě přes API. Výpisy čteme z XTB, Degiro, eToro, Charles Schwab, Saxo, Swissquote, Portu, Coinbase, Krakenu i českých bank — u každé platformy návod, kde přesně výpis stáhnout.',
};

export default function PlatformyPage() {
  return (
    <div className="mx-auto max-w-4xl px-6">
      <MarketingHeader />
      <main className="pt-8 md:pt-12">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova">
          Podporované platformy
        </p>
        <h1 className="mt-3 text-balance font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Odkud umíme načíst obchody
        </h1>
        <p className="mt-4 max-w-2xl text-inkoust-tlumeny">
          Trading 212, Interactive Brokers a Lynx se připojí živě přes API klíč jen pro
          čtení — žádná hesla, žádné právo obchodovat. Z ostatních platforem nahraješ
          výpis a formát poznáme sami. Rozklikni si svou platformu: u každé je návod,
          kde přesně výpis stáhnout.
        </p>

        <div className="mt-10">
          <PlatformCatalog variant="public" />
        </div>

        <section className="mt-16 rounded-lg border border-ruzova/30 bg-ruzova/5 px-6 py-10 text-center">
          <h2 className="font-display text-2xl font-bold tracking-tight">
            Účty a výpisy se skládají vedle sebe
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm text-inkoust-tlumeny">
            Máš víc brokerů? Danero všechno převede do jednoho formátu, deduplikuje
            a limity hlídá přes všechny účty dohromady — přesně tak, jak to vidí
            finanční úřad.
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
