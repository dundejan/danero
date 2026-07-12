import Link from 'next/link';
import { MarketingPage } from '@/components/marketing-page';

export const metadata = { title: 'Podmínky užití — Danero' };

/** ⚠️ PRACOVNÍ NÁVRH — před veřejným spuštěním musí projít právní kontrolou. */
export default function TermsPage() {
  return (
    <MarketingPage>
      <div className="mx-auto max-w-2xl space-y-6 py-12 md:py-16">
      <p className="rounded-md border border-jantar px-4 py-2 text-sm text-jantar-text">
        Pracovní návrh podmínek pro beta provoz — finální znění projde právní kontrolou.
      </p>
      <div>
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova-text">
          Právní
        </p>
        <h1 className="mt-3 font-display text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
          Podmínky užití
        </h1>
      </div>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="font-display text-lg font-semibold">1. Co Danero je (a co není)</h2>
        <p>
          Danero je výpočetní a evidenční nástroj pro sledování daňových dopadů investic
          fyzických osob v ČR. Výpočty vycházejí ze zveřejněné metodiky (zákon
          č. 586/1992 Sb., pokyny GFŘ) a z dat, která do aplikace vložíš. Danero{' '}
          <strong>není daňovým poradenstvím</strong> ve smyslu zákona č. 523/1992 Sb. ani
          investičním doporučením; výstupy jsou orientační podklady. Za správnost a podání
          daňového přiznání odpovídá vždy poplatník.
        </p>

        <h2 className="font-display text-lg font-semibold">2. Beta provoz</h2>
        <p>
          Služba běží v beta režimu a je poskytována bezplatně. Co konkrétně beta
          znamená: služba nemá garantovanou dostupnost, podpora méně obvyklých brokerů
          se teprve ladí (výpis ti ale do pár dní podpoříme) a jednotný kurz pro běžný
          rok je orientační, dokud GFŘ nevydá pokyn — všechna taková místa aplikace
          viditelně označuje. Sporné výklady daňových předpisů aplikace označuje
          a volba výkladu je na tobě. S tímhle rozsahem služby souhlasíš vytvořením účtu.
        </p>

        <h2 className="font-display text-lg font-semibold">3. Tvůj účet a data</h2>
        <p>
          Účet je osobní a nepřenosný. Do aplikace vkládej pouze data ke svým vlastním
          investičním účtům (případně účtům, ke kterým máš oprávnění). API klíče brokerů
          smí být pouze pro čtení; Danero nikdy nezadává obchodní příkazy. Data můžeš
          kdykoli smazat zrušením účtu. A kdyby Danero někdy končilo, dozvíš se to
          e-mailem nejméně 3 měsíce předem, po celou tu dobu si můžeš stáhnout export
          všech svých dat a případné nevyužité předplacené období ti vrátíme.
        </p>

        <h2 className="font-display text-lg font-semibold">4. Odpovědnost</h2>
        <p>
          Danero počítá podle zveřejněné metodiky z dat, která do něj vložíš nebo která
          načteme z tvého brokera. Neodpovídáme za výsledek, pokud vstupní data nebyla
          úplná nebo správná, ani za změny výkladu daňových předpisů — na klíčové
          nejistoty tě upozorňujeme přímo ve výstupech a sporná místa viditelně
          označujeme. Rozhodnutí, co podáš v přiznání, je vždy tvoje. Tím nejsou dotčena
          tvoje zákonná práva — zejména práva z vadného plnění a právo na náhradu újmy
          v rozsahu, v jakém je nelze smluvně omezit (jsi-li spotřebitel, neomezujeme
          je vůbec).
        </p>

        <h2 className="font-display text-lg font-semibold">5. Provozovatel a kontakt</h2>
        <p>
          Danero je osobní projekt — provozuje ho Jan Dunder, IČO 19642661, se sídlem
          Žitomírská 640/3, Vršovice, 101 00 Praha 10 (fyzická osoba podnikající dle
          živnostenského zákona, zapsaná v živnostenském rejstříku). Připomínky a chyby
          posílej na{' '}
          <a href="mailto:dunder.jan@gmail.com" className="font-medium text-ruzova">
            dunder.jan@gmail.com
          </a>
          .
        </p>

        <h2 className="font-display text-lg font-semibold">6. Když se neshodneme</h2>
        <p>
          Nejrychlejší cesta je napsat mi — snažím se každý problém vyřešit napřímo.
          Pokud se nedohodneme a jsi spotřebitel, můžeš se obrátit na Českou obchodní
          inspekci, která řeší spotřebitelské spory mimosoudně: Česká obchodní inspekce,
          Ústřední inspektorát — oddělení ADR, Gorazdova 24, 120 00 Praha 2,{' '}
          <a
            href="https://coi.gov.cz"
            className="font-medium text-ruzova"
            target="_blank"
            rel="noreferrer"
          >
            coi.gov.cz
          </a>
          ; návrh jde podat online na{' '}
          <a
            href="https://adr.coi.cz"
            className="font-medium text-ruzova"
            target="_blank"
            rel="noreferrer"
          >
            adr.coi.cz
          </a>
          .
        </p>

        <h2 className="font-display text-lg font-semibold">7. Rozhodné právo a změny podmínek</h2>
        <p>
          Tyto podmínky se řídí právem České republiky; případné spory řeší české soudy.
          Podmínky můžeme v přiměřeném rozsahu upravit — třeba když se změní zákon nebo
          přidáme funkce. O každé změně ti dáme vědět e-mailem nejméně 30 dní předem.
          Pokud s novým zněním nesouhlasíš, můžeš účet do dne účinnosti zdarma zrušit
          (a máš-li předplacené období, vrátíme ti poměrnou část); jinak platí, že se
          službou pokračuješ podle nových podmínek. Aktuální verzi s datem účinnosti
          najdeš vždy na této stránce.
        </p>
      </section>

      <p className="text-xs text-inkoust-tlumeny">
        Verze 1.1 (beta) · účinnost od 12. července 2026 · změny oznámíme e-mailem
      </p>

      <p className="text-sm">
        <Link href="/" className="font-medium text-ruzova">
          ← Zpět na úvod
        </Link>
      </p>
      </div>
    </MarketingPage>
  );
}
