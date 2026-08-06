import type { Metadata } from 'next';
import { PLATFORM_COUNTS } from '@/lib/brokers-catalog';
import Link from 'next/link';
import { FaqList, type FaqItem } from '@/components/faq-list';
import { MarketingCta, MarketingPage, PageHero } from '@/components/marketing-page';

export const metadata: Metadata = {
  title: 'Časté otázky — Danero',
  description:
    'Musím kvůli investicím podávat přiznání? Které brokery Danero načte? Jak je to s bezpečností, kryptem a deriváty? Odpovědi na nejčastější otázky k hlídání daní z investic.',
};

const FAQ: FaqItem[] = [
  {
    q: 'Musím kvůli investicím vůbec podávat přiznání?',
    a: (
      <>
        Často ne: do 100 000 Kč tržeb z prodejů za rok se daň z prodejů neřeší vůbec
        a kusy držené přes 3 roky jsou osvobozené úplně. Pozor ale na zahraniční
        dividendy a úroky — do těchhle limitů nespadají a hlavně u OSVČ v paušálu
        můžou samy prolomit hranici 50 000 Kč, i bez jediného prodeje. Orientačně to
        zjistíš za minutu v{' '}
        <Link
          href="/kalkulacka"
          className="font-medium text-ruzova-text underline underline-offset-2"
        >
          kalkulačce
        </Link>
        ; přesně ti to Danero spočítá z dat.
      </>
    ),
  },
  {
    q: 'Které brokery a platformy umíte načíst?',
    a: (
      <>
        Trading 212, Interactive Brokers a Lynx živě přes API klíč jen pro čtení.
        Výpisy z {PLATFORM_COUNTS.file} dalších platforem čteme automaticky — XTB,
        Degiro, eToro, Charles Schwab, Saxo, Portu, Coinbase, Kraken a další.
        U {PLATFORM_COUNTS.template} dalších platforem — českých bank, fondů a dalších —
        tě provedeme univerzální šablonou.
        Kompletní seznam s návody, kde výpis stáhnout, je na stránce{' '}
        <Link
          href="/platformy"
          className="font-medium text-ruzova-text underline underline-offset-2"
        >
          Platformy
        </Link>
        .
      </>
    ),
  },
  {
    q: 'Pro koho je Danero?',
    a: 'Pro české investory — a speciálně pro OSVČ v paušálním režimu, kterým neosvobozené příjmy z investic nad 50 000 Kč ročně prolomí paušální daň. Hlídáme ale i limit 20 000 Kč vedlejších příjmů pro zaměstnance a limit 50 000 Kč pro podání přiznání — automaticky, včetně zahraničních dividend, na které se zapomíná.',
  },
  {
    q: 'Jak je to s bezpečností?',
    a: 'API klíč od brokera je jen pro čtení a ukládáme ho šifrovaný (AES-256-GCM). Data leží v EU, přihlášení chrání volitelné dvoufaktorové ověření. Nepotřebujeme tvoje jméno ani rodné číslo — stačí e-mail.',
  },
  {
    q: 'Co když změním brokera nebo jich mám víc?',
    a: 'Účty a výpisy se skládají vedle sebe — všechno převádíme do jednoho kanonického formátu a výpočty se vždy přepočítají od nuly nad celou historií. Nic se neztratí a limity se hlídají přes všechny účty dohromady.',
  },
  {
    q: 'Umí Danero i krypto a deriváty?',
    a: 'Ano. Kryptoaktiva mají od 15. 2. 2025 vlastní limit 100 000 Kč i vlastní tříletý časový test — hlídáme obojí zvlášť, nezávisle na akciích. Opce a další deriváty se počítají jako samostatný druh příjmu bez osvobození. Všechno si můžeš prohlédnout v demu.',
  },
  {
    q: 'Co je zdarma a za co se platí?',
    a: 'Zdarma je import výpisů ze všech podporovaných platforem a přehled, který z nich Danero spočítá — limity, časové testy a orientační daň. Platí se podklady k přiznání (490 Kč za jeden daňový rok) a celoroční hlídání s napojením na brokery přes API a hlídacími e-maily (990 Kč ročně). Ceny jsou konečné — nejsme plátcem DPH. Účet založíš zdarma a bez karty; podklady jsou jednorázový nákup, celoroční hlídání se po roce automaticky obnovuje — e-mail ti přijde 14 dní předem a zrušit obnovu můžeš kdykoli jedním kliknutím.',
  },
  {
    q: 'Co znamená „ověřeno zkušební podatelnou EPO“?',
    a: 'Finanční správa provozuje zkušební podatelnu EPO, kde si jde podání nanečisto zvalidovat: nic se nepodá, jen se vrátí seznam kontrol. Posíláme jí vzorová podání každého typu, který Danero umí vygenerovat, a děláme to pokaždé, když sáhneme na strukturu XML nebo když finanční správa vydá novou verzi formuláře. Kontroluje se struktura, vazby mezi řádky a formální správnost podání. Tvoje konkrétní XML tam neposíláme — jsou v něm tvoje osobní údaje, a podatelna je veřejná, takže si ho tam můžeš poslat sám. Věcnou správnost výpočtu hlídáme sami: každé pravidlo má odkaz na paragraf a testy a metodiku zveřejňujeme. Neznamená to, že finanční správa schválila naše výpočty — to žádný nástroj tvrdit nemůže.',
  },
  {
    q: 'Nahrazuje Danero daňového poradce?',
    a: 'Ne. Danero je výpočetní a evidenční nástroj — počítá podle zveřejněné metodiky a sporné výklady označuje. Za přiznání odpovídá vždy poplatník.',
  },
];

export default function CasteOtazkyPage() {
  return (
    <MarketingPage active="caste-otazky">
      <PageHero
        eyebrow="FAQ"
        title="Časté otázky"
        lede="Co lidi nejčastěji zajímá, než pustí Danero ke svým daním. Nenašel jsi odpověď? Napiš na dunder.jan@gmail.com — odpovídám osobně."
      />

      <div className="mt-12">
        <FaqList items={FAQ} />
      </div>

      <p className="mt-8 max-w-3xl text-sm text-inkoust-tlumeny">
        Otázky přímo k ceně najdeš na stránce{' '}
        <Link
          href="/cenik"
          className="font-medium text-ruzova-text underline underline-offset-2"
        >
          Ceník
        </Link>
        .
      </p>

      <MarketingCta
        title="Nejrychlejší odpověď: prostě si to vyzkoušej"
        lede="Plné demo běží nad vzorovým portfoliem — ukazatele limitů, horizont osvobození i report. Bez registrace, nic se neukládá."
      />
    </MarketingPage>
  );
}
