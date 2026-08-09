import { EPO_SUPPORTED_YEARS } from '@/lib/epo';
import { yearList } from '@/lib/format';
import {
  PRICE_REPORT_CZK,
  PRICE_SUBSCRIPTION_CZK,
  priceLabel,
  SUBSCRIPTION_PER_MONTH_CZK,
} from '@/lib/pricing';

/**
 * Co je v kterém tarifu — JEDEN zdroj pro veřejný ceník i pro /predplatne
 * uvnitř aplikace (docs/19).
 *
 * Do 9. 8. 2026 měl seznamy funkcí jen `cenik/page.tsx` a /predplatne
 * popisovalo totéž vlastními větami. Dvě prózy o jedné věci se rozejdou vždycky
 * — a rozejít se tady znamená slíbit u placení něco jiného než v ceníku.
 *
 * Hranice tarifů musí sedět na `Entitlements` (lib/entitlements.ts): co je tu
 * napsané pod hlídáním, to tam musí být `brokerSync`/`notifications`/`simulator`.
 */
export type PlanId = 'free' | 'report' | 'subscription';

export interface Plan {
  id: PlanId;
  /** Název tarifu — stejný v ceníku i v aplikaci. */
  name: string;
  price: string;
  /** Doplněk pod cenou (perioda, podmínka). */
  priceNote: string;
  features: readonly string[];
  /** Tarif, na kterém stojí celá nabídka — vizuálně zvýrazněný. */
  highlight?: boolean;
}

export const PLANS: readonly Plan[] = [
  {
    id: 'free',
    name: 'Zdarma',
    price: '0 Kč',
    priceNote: 'navždy, bez karty',
    features: [
      'Import výpisů — neomezeně platforem',
      'Limity 100 000 Kč i 50 000 Kč v reálném čase',
      'Stav tříletých časových testů',
      'Horizont osvobození: kdy je co bez daně',
      'Orientační daň z investic',
      'Krypto i deriváty jako samostatné druhy příjmů',
    ],
  },
  {
    id: 'report',
    name: 'Podklady za rok',
    price: priceLabel(PRICE_REPORT_CZK),
    priceNote: 'jednorázově za jeden daňový rok',
    features: [
      'Všechno ze zdarma',
      'Čísla přesně do řádků přiznání',
      // roky se berou z konfigurace EPO — kupující musí vědět PŘED zaplacením,
      // za které roky XML existuje (§ 1820/1 r OZ, nález E-29)
      `XML pro elektronické podání (roky ${yearList(EPO_SUPPORTED_YEARS)})`,
      'Rozpad na jednotlivé nákupy a použité kurzy',
      'Srovnání variant výpočtu (FIFO/LIFO, kurzy)',
    ],
  },
  {
    id: 'subscription',
    name: 'Celoroční hlídání',
    price: `${priceLabel(PRICE_SUBSCRIPTION_CZK)} / rok`,
    priceNote: `necelých ${priceLabel(SUBSCRIPTION_PER_MONTH_CZK)} měsíčně — méně než jedna chyba v přiznání`,
    features: [
      'Všechno z podkladů — za všechny daňové roky',
      'Živé napojení na Trading 212, IBKR i Lynx',
      'Automatický denní sync a přepočet',
      'E-mailová upozornění na limity a termíny',
      'Simulátor prodeje: co udělá další obchod',
    ],
    highlight: true,
  },
] as const;
