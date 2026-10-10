import { LinkList } from '@/components/marketing-blocks';
import { MarketingPage, PageHero } from '@/components/marketing-page';

/** Nejčastější cíle toho, kdo zabloudil — stejné tři, co tu byly vždycky. */
const EXITS: { href: string; title: string; summary: string }[] = [
  { href: '/', title: 'Úvodní stránka', summary: 'Co Danero hlídá a jak funguje' },
  { href: '/platformy', title: 'Platformy', summary: 'Podporovaní brokeři a návody k výpisům' },
  { href: '/kalkulacka', title: 'Kalkulačka', summary: 'Musíš kvůli investicím podat přiznání?' },
];

/**
 * Česká 404 v marketingovém shellu — žádný mrtvý konec bez navigace. Krátce:
 * co se stalo a tři cesty ven jako klikací řádky (stejný seznam jako rozcestník
 * průvodce). Nic se tu neprodává; kdo zabloudil, chce cestu ven, ne výzvu
 * k registraci.
 */
export default function NotFound() {
  return (
    <MarketingPage>
      <title>Stránka nenalezena — Danero</title>
      <PageHero
        eyebrow="Chyba 404"
        title="Tahle stránka neexistuje"
        lede="Odkaz se změnil, nebo v adrese něco přebývá."
      />
      <nav aria-label="Kam dál" className="mt-10 md:mt-14">
        <LinkList items={EXITS} />
      </nav>
    </MarketingPage>
  );
}
