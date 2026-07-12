import type { Metadata } from 'next';
import { MarketingCta, MarketingPage, PageHero } from '@/components/marketing-page';
import { PlatformCatalog } from '@/components/platform-catalog';

export const metadata: Metadata = {
  title: 'Podporovaní brokeři a platformy — Danero',
  description:
    'Trading 212, Interactive Brokers a Lynx živě přes API. Výpisy čteme z XTB, Degiro, eToro, Charles Schwab, Saxo, Swissquote, Portu, Coinbase i Krakenu; u českých bank a fondů tě provedeme univerzální šablonou. U každé platformy návod, kde přesně výpis stáhnout.',
};

export default function PlatformyPage() {
  return (
    <MarketingPage active="platformy">
      <PageHero
        eyebrow="Podporované platformy"
        title="Odkud umíme načíst obchody"
        lede="Trading 212, Interactive Brokers a Lynx se připojí živě přes API klíč jen pro čtení — žádná hesla, žádné právo obchodovat. Z většiny ostatních nahraješ výpis a formát poznáme sami; u zbylých tě krok za krokem provedeme univerzální šablonou. Rozklikni si svou platformu: u každé je návod, kde přesně výpis stáhnout."
      />

      <div className="mt-12">
        <PlatformCatalog variant="public" />
      </div>

      <MarketingCta
        title="Účty a výpisy se skládají vedle sebe"
        lede="Máš víc brokerů? Danero všechno převede do jednoho formátu, deduplikuje a limity hlídá přes všechny účty dohromady — tak, jak se posuzují v daňovém přiznání."
      />
    </MarketingPage>
  );
}
