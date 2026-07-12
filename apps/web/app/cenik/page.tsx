import type { Metadata } from 'next';
import Link from 'next/link';
import { FaqList } from '@/components/faq-list';
import { IconCheck } from '@/components/marketing-icons';
import { MarketingCta, MarketingPage, PageHero } from '@/components/marketing-page';

export const metadata: Metadata = {
  title: 'Ceník — Danero',
  description:
    'Teď v betě je Danero zdarma. Po spuštění 990 Kč ročně — jedna cena, žádné tarify, všechny funkce: živé napojení na brokery, hlídání limitů, podklady k přiznání včetně XML.',
};

const INCLUDED = [
  'Živé napojení na Trading 212, IBKR i Lynx a denní přepočet',
  'Hlídání limitů a časových testů s e-mailovými upozorněními',
  'Horizont osvobození a simulátor prodeje',
  'Podklady k přiznání včetně XML pro podatelnu',
  '29 podporovaných platforem — API, výpisy i univerzální šablona',
  'Krypto i deriváty jako samostatné druhy příjmů',
  'Dvoufaktorové přihlášení, klíče šifrované AES-256-GCM',
  'Export a smazání dat kdykoli — účet je tvůj',
] as const;

const CENIK_FAQ = [
  {
    q: 'Co znamená „beta zdarma“?',
    a: 'Všechny funkce bez omezení a bez karty — stačí e-mail. Hledáme první uživatele a zpětnou vazbu, ne platby.',
  },
  {
    q: 'Co se stane, až beta skončí?',
    a: 'Dáme ti vědět e-mailem. Kartu od tebe nemáme, nic se nestrhne samo — sám se rozhodneš, jestli budeš pokračovat za 990 Kč ročně. Data ti zůstanou.',
  },
  {
    q: 'Proč jedna cena, a ne tarify?',
    a: 'Protože daně nejsou prémiová funkce. Limity, časové testy i podklady k přiznání potřebuje každý investor stejně — ať má pět pozic, nebo padesát.',
  },
] as const;

export default function CenikPage() {
  return (
    <MarketingPage active="cenik">
      <PageHero
        eyebrow="Ceník"
        title="Jedna cena. Žádné tarify."
        lede="Teď v betě je všechno zdarma — stačí e-mail, kartu nechceme. Po spuštění 990 Kč ročně, tedy necelých 83 Kč měsíčně."
      />

      <section aria-label="Cena a obsah" className="mt-12">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="rounded-lg border border-ruzova/30 bg-ruzova/5 p-8">
            <p className="font-mono text-xs font-semibold uppercase tracking-wide text-ruzova-text">
              Teď v betě
            </p>
            <p className="mt-3 font-display text-5xl font-bold tracking-tight">zdarma</p>
            <p className="mt-2 text-sm text-inkoust-tlumeny">
              všechny funkce, bez karty, bez závazků
            </p>
            <div className="mt-6 border-t border-ruzova/20 pt-6">
              <p className="font-mono text-xs font-semibold uppercase tracking-wide text-inkoust-tlumeny">
                Po spuštění
              </p>
              <p className="mt-2 font-display text-3xl font-bold tracking-tight">
                990 Kč <span className="text-lg font-semibold text-inkoust-tlumeny">/ rok</span>
              </p>
              <p className="mt-1 text-sm text-inkoust-tlumeny">
                necelých 83 Kč měsíčně — méně než jedna chyba v přiznání
              </p>
            </div>
            <Link
              href="/registrace"
              className="mt-6 inline-block w-full rounded-md bg-ruzova-syta px-6 py-3 text-center font-semibold text-white hover:opacity-90"
            >
              Založit účet zdarma
            </Link>
            <p className="mt-2 text-center text-xs text-inkoust-tlumeny">
              bez karty — po betě se rozhodneš sám
            </p>
          </div>
          <div className="rounded-lg border border-linka bg-plocha p-8">
            <h2 className="font-display text-xl font-bold">Všechno je v ceně</h2>
            <ul className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {INCLUDED.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm">
                  <IconCheck />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section aria-labelledby="cenik-faq-nadpis" className="mt-24 lg:mt-32">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova-text">
          FAQ
        </p>
        <h2
          id="cenik-faq-nadpis"
          className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl"
        >
          Otázky k ceně
        </h2>
        <div className="mt-8">
          <FaqList items={[...CENIK_FAQ]} />
        </div>
      </section>

      <MarketingCta
        title="Vyzkoušej všechno — teď zdarma"
        lede="Plné demo bez registrace, nebo rovnou vlastní účet. Stačí e-mail, karta ne."
        primary="registrace"
      />
    </MarketingPage>
  );
}
