import type { Metadata } from 'next';
import { DemoCta } from '@/components/marketing-blocks';
import { MarketingPage, PageHero } from '@/components/marketing-page';
import { PlatformCatalog } from '@/components/platform-catalog';
import { PLATFORM_COUNTS } from '@/lib/brokers-catalog';
import { plural } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Podporovaní brokeři a platformy — Danero',
  description:
    'Trading 212, Interactive Brokers a Lynx živě přes API. Výpisy čteme z XTB, Degiro, eToro, Charles Schwab, Saxo, Swissquote, Portu, Coinbase i Krakenu; u českých bank a fondů tě provedeme univerzální šablonou. U každé platformy návod, kde přesně výpis stáhnout.',
};

const platforms = (count: number): string =>
  `${count} ${plural(count, 'platforma', 'platformy', 'platforem')}`;

export default function PlatformyPage() {
  return (
    <MarketingPage active="platformy">
      <PageHero
        eyebrow="Platformy"
        title="Odkud načte obchody"
        lede={`Živě, klíčem jen pro čtení, se připojí ${platforms(PLATFORM_COUNTS.api)}. U ${PLATFORM_COUNTS.file} dalších přečte Danero výpis samo, zbytek jde přes univerzální šablonu. U každé je návod, kde výpis stáhnout.`}
      />

      <div className="mt-10 md:mt-14">
        <PlatformCatalog variant="public" />
      </div>

      <DemoCta />
    </MarketingPage>
  );
}
