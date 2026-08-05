import Link from 'next/link';
import { MarketingPage } from '@/components/marketing-page';

export const metadata = {
  title: 'Podmínky užití — Danero',
  description:
    'Práva a povinnosti při užívání Danera: co služba dělá a nedělá, cena a odpovědnost — srozumitelně a bez kliček.',
};

export default function TermsPage() {
  return (
    <MarketingPage>
      <div className="mx-auto max-w-2xl space-y-6 py-12 md:py-16">
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

        <h2 className="font-display text-lg font-semibold">
          2. Na co se tyhle podmínky vztahují
        </h2>
        <p>
          Danero jsou dvě věci a je dobré je nesměšovat:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Služba na danero.cz</strong>, kterou provozuje níže uvedený
            provozovatel. Na ni se vztahují tyhle podmínky i všechna tvoje spotřebitelská
            práva. Je to jediná instance, kterou provozujeme my.
          </li>
          <li>
            <strong>Software Danero</strong>, jehož zdrojový kód je veřejný pod licencí{' '}
            <a
              href="https://www.gnu.org/licenses/agpl-3.0.html"
              className="font-medium text-ruzova"
              target="_blank"
              rel="noreferrer"
            >
              GNU AGPL-3.0
            </a>
            . Ten si smí kdokoli stáhnout, upravit a provozovat sám. Na takovou vlastní
            instanci se tyhle podmínky <strong>nevztahují</strong> — software se poskytuje
            „jak stojí a leží", bez záruky, v rozsahu, který připouští licence a zákon.
            Kdo si Danero provozuje sám, je vůči datům svých uživatelů sám správcem a
            odpovídá za ně, včetně povinností podle GDPR.
          </li>
        </ul>
        <p>
          Název „Danero", logo a doména danero.cz do licence nespadají. Když narazíš na
          instanci Danera, kterou neprovozujeme my, poznáš to podle adresy — a neplatí pro
          ni nic z toho, co slibujeme tady.
        </p>

        <h2 className="font-display text-lg font-semibold">3. Cena a rozsah služby</h2>
        <p>
          Za daňový rok 2026 je Danero zdarma pro všechny — včetně podkladů k přiznání,
          které se podává na jaře 2027. Od roku 2027 je celoroční hlídání placené;
          aktuální cenu najdeš vždy na stránce{' '}
          <Link href="/cenik" className="font-medium text-ruzova">
            Ceník
          </Link>{' '}
          a případnou změnu ti oznámíme předem podle článku 8.
        </p>
        <p>
          Co ti naopak neslibujeme: Danero nemá sjednanou garantovanou dostupnost —
          usilujeme o nepřetržitý provoz, ale krátké odstávky kvůli údržbě nebo výpadku
          dodavatele nastat můžou. Jednotný kurz pro právě probíhající rok je orientační,
          dokud GFŘ nevydá pokyn, a sporné výklady daňových předpisů nechává aplikace na
          tobě — obojí u konkrétních výpočtů viditelně označuje, ať víš, na čem stojíš.
        </p>

        <h2 className="font-display text-lg font-semibold">4. Tvůj účet a data</h2>
        <p>
          Účet je osobní a nepřenosný. Do aplikace vkládej pouze data ke svým vlastním
          investičním účtům (případně účtům, ke kterým máš oprávnění). API klíče brokerů
          smí být pouze pro čtení; Danero nikdy nezadává obchodní příkazy. Data můžeš
          kdykoli smazat zrušením účtu. A kdyby Danero někdy končilo, dozvíš se to
          e-mailem nejméně 3 měsíce předem, po celou tu dobu si můžeš stáhnout export
          všech svých dat a případné nevyužité předplacené období ti vrátíme.
        </p>

        <h2 className="font-display text-lg font-semibold">5. Odpovědnost</h2>
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

        <h2 className="font-display text-lg font-semibold">6. Provozovatel a kontakt</h2>
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

        <h2 className="font-display text-lg font-semibold">7. Když se neshodneme</h2>
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

        <h2 className="font-display text-lg font-semibold">8. Rozhodné právo a změny podmínek</h2>
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
        Verze 2.0 · účinnost od 5. srpna 2026 · změny oznámíme e-mailem
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
