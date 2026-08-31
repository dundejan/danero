import Link from 'next/link';
import type { FaqItem } from '@/components/faq-list';
import { PLATFORM_COUNTS } from '@/lib/brokers-catalog';
import { PRICE_REPORT_CZK, PRICE_SUBSCRIPTION_CZK, priceLabel } from '@/lib/pricing';

/**
 * Obsah stránky /caste-otazky. Samostatný modul proto, že se dá otestovat:
 * strukturovaná data (`faqPageJsonLd`) potřebují ke každé odpovědi prostý text
 * a z vyrenderované stránky se to neověří. Routu v `app/` dělají jen vyhrazená
 * jména souborů (`page`, `layout`, `route`, …), takže tenhle soubor žádnou
 * adresu nezakládá.
 */
export const FAQ: FaqItem[] = [
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
    plain:
      'Často ne: do 100 000 Kč tržeb z prodejů za rok se daň z prodejů neřeší vůbec a kusy držené přes 3 roky jsou osvobozené úplně. Pozor ale na zahraniční dividendy a úroky — do těchhle limitů nespadají a hlavně u OSVČ v paušálu můžou samy prolomit hranici 50 000 Kč, i bez jediného prodeje. Orientačně to zjistíš za minutu v kalkulačce; přesně ti to Danero spočítá z dat.',
  },
  {
    q: 'Od roku 2026 prý burzy hlásí obchody úřadu. Platí to?',
    a: 'Zčásti ano — týká se to hlavně kryptoburz a směnáren. Evropská pravidla (zkratkou DAC8, celosvětově CARF) jim od roku 2026 ukládají hlásit finanční správě, co jejich klienti obchodovali, a úřady si pak údaje vyměňují mezi státy; banky a zahraniční brokeři si informace o účtech takhle předávají už roky. Český zákon, který to má zavést, zatím leží ve sněmovně, takže se přesný start ještě může posunout — směr je ale daný a mít vlastní čísla spočítaná a doložená se vyplatí. Danero samo nikam nic nehlásí: nedrží tvoje peníze ani kryptoaktiva a neprovádí směny, takže se na něj žádná ohlašovací povinnost nevztahuje.',
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
    plain: `Trading 212, Interactive Brokers a Lynx živě přes API klíč jen pro čtení. Výpisy z ${PLATFORM_COUNTS.file} dalších platforem čteme automaticky — XTB, Degiro, eToro, Charles Schwab, Saxo, Portu, Coinbase, Kraken a další. U ${PLATFORM_COUNTS.template} dalších platforem — českých bank, fondů a dalších — tě provedeme univerzální šablonou. Kompletní seznam s návody, kde výpis stáhnout, je na stránce Platformy.`,
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
    a: `Zdarma je import výpisů ze všech podporovaných platforem a přehled, který z nich Danero spočítá — limity, časové testy a orientační daň. Platí se podklady k přiznání (${priceLabel(PRICE_REPORT_CZK)} za jeden daňový rok) a celoroční hlídání s napojením na brokery přes API a hlídacími e-maily (${priceLabel(PRICE_SUBSCRIPTION_CZK)} ročně). Ceny jsou konečné — nejsme plátcem DPH. Účet založíš zdarma a bez karty; podklady jsou jednorázový nákup, celoroční hlídání se po roce automaticky obnovuje — e-mail ti přijde 14 dní předem a zrušit obnovu můžeš kdykoli jedním kliknutím.`,
  },
  {
    q: 'Co znamená „ověřeno zkušební podatelnou EPO“?',
    a: 'Finanční správa provozuje zkušební podatelnu EPO, kde si jde podání nanečisto zvalidovat: nic se nepodá, jen se vrátí seznam kontrol. Posíláme jí vzorová podání pokrývající struktury, které Danero umí vygenerovat — obě varianty výpočtu, rok bez zdanitelných příjmů, čistě tuzemský prodej i rok jen se ztrátou. Běží to automaticky při každé změně kódu, ne jen když si na to vzpomeneme. Kontroluje se struktura, vazby mezi řádky a formální správnost podání. Tvoje konkrétní XML tam neposíláme — jsou v něm tvoje osobní údaje, a podatelna je veřejná, takže si ho tam můžeš poslat sám. Věcnou správnost výpočtu hlídáme sami: každé pravidlo má odkaz na paragraf a testy a metodiku zveřejňujeme. Neznamená to, že finanční správa schválila naše výpočty — to žádný nástroj tvrdit nemůže.',
  },
  {
    q: 'Nahrazuje Danero daňového poradce?',
    a: 'Ne. Danero je výpočetní a evidenční nástroj — počítá podle zveřejněné metodiky a sporné výklady označuje. Za přiznání odpovídá vždy poplatník.',
  },
];
