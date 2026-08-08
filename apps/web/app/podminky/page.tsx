import Link from 'next/link';
import { MarketingPage } from '@/components/marketing-page';
import { OPERATOR } from '@/lib/contact';
import { EPO_SUPPORTED_YEARS } from '@/lib/epo';
import { yearList } from '@/lib/format';
import { ADR, TERMS_EFFECTIVE_FROM, TERMS_VERSION } from '@/lib/legal';

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
              className="font-medium text-ruzova-text"
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
          Základní použití je zdarma a bez časového omezení: import výpisů ze všech
          podporovaných platforem a přehled limitů, časových testů a orientační daně.
          Placené jsou podklady k přiznání za konkrétní daňový rok a celoroční hlídání —
          tedy automatické napojení na brokery, hlídací e-maily a simulátor prodeje.
          Aktuální ceny najdeš vždy na stránce{' '}
          <Link href="/cenik" className="font-medium text-ruzova-text">
            Ceník
          </Link>{' '}
          a případnou změnu ti oznámíme předem podle článku 10.
        </p>
        {/*
          § 2389i odst. 2 OZ: odchylku od zákonné jakosti digitálního obsahu lze
          ujednat jen tehdy, když ji spotřebitel ZVLÁŠŤ potvrdil. Odstavec proto
          nese vlastní kotvu — registrace a objednávka na něj musí umět odkázat
          adresně, ne jen na celé podmínky (nález E-43).
        */}
        <p id="odchylky-od-jakosti">
          Co ti naopak neslibujeme: Danero nemá sjednanou garantovanou dostupnost —
          usilujeme o nepřetržitý provoz, ale krátké odstávky kvůli údržbě nebo výpadku
          dodavatele nastat můžou. Jednotný kurz pro právě probíhající rok je orientační,
          dokud GFŘ nevydá pokyn, a sporné výklady daňových předpisů nechává aplikace na
          tobě — obojí u konkrétních výpočtů viditelně označuje, ať víš, na čem stojíš.
        </p>

        <h2 className="font-display text-lg font-semibold">
          4. Co Danero potřebuje k provozu a co z něj vypadne
        </h2>
        <p>
          Povinný údaj o funkčnosti digitálního obsahu a o tom, s jakým hardwarem a
          softwarem spolupracuje (§ 1820 odst. 1 písm. r občanského zákoníku).
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Co potřebuješ:</strong> běžný webový prohlížeč v aktuální verzi
            (Chrome, Firefox, Safari, Edge) a připojení k internetu. Nic se neinstaluje —
            Danero běží celé v prohlížeči, na počítači i na telefonu. Dál potřebuješ{' '}
            <strong>funkční e-mailovou adresu</strong>: registraci potvrzuješ odkazem
            z e-mailu a na tutéž adresu chodí potvrzení objednávek i upozornění. Data do
            aplikace dostaneš buď nahráním výpisu (CSV, XLSX, XML nebo HTML podle
            platformy), nebo API klíčem k účtu u brokera, který to umí.
          </li>
          <li>
            <strong>Žádná technická ochranná opatření:</strong> nepoužíváme DRM ani jinou
            ochranu obsahu. Co si z Danera stáhneš, je obyčejný soubor, který nikam
            nevolá, není vázaný na zařízení a otevřeš ho i bez Danera.
          </li>
          <li>
            <strong>Co z Danera vypadne a s čím to funguje:</strong> XML písemnosti DPFDP7
            pro portál MOJE daně (mojedane.cz), a to <strong>za daňové roky{' '}
            {yearList(EPO_SUPPORTED_YEARS)}</strong> — pro další rok zveřejňuje finanční
            správa strukturu až začátkem roku následujícího, takže do té doby XML za něj
            neexistuje a podklady zůstávají jako čísla k opsání do formuláře. Dál si
            kdykoli stáhneš export všech svých dat ve formátu JSON a podklady k přiznání
            vytiskneš (nebo uložíš do PDF) tiskovým dialogem prohlížeče.
          </li>
        </ul>

        <h2 className="font-display text-lg font-semibold">5. Placené objednávky a odstoupení</h2>
        <p>
          Ceny jsou konečné — nejsme plátcem DPH, takže se k nim nic nepřipočítává.
          Platby vyřizuje Stripe; číslo tvojí karty se k nám nikdy nedostane. Po každé
          objednávce ti přijde e-mailem potvrzení uzavřené smlouvy, které si ulož.
          Roční předplatné se obnovuje automaticky, ale nikdy potichu: 14 dní předem
          ti přijde e-mail a zrušit obnovu můžeš kdykoli jedním kliknutím —
          do konce zaplaceného období ti služba běží dál.
        </p>
        <p>
          Jsi-li spotřebitel, máš právo odstoupit od smlouvy do 14 dnů od jejího
          uzavření. Jak dlouho to právo trvá, se liší podle toho, co sis koupil:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Podklady k přiznání za jeden rok</strong> jsou digitální obsah,
            který dodáváme okamžitě. U nich právo odstoupit zaniká ve chvíli, kdy na
            tvou výslovnou žádost začneme plnit — potvrzuješ ji zaškrtnutím
            u objednávky (§ 1837 písm. l občanského zákoníku).
          </li>
          <li>
            <strong>Celoroční hlídání</strong> je naopak služba, kterou ti poskytujeme
            průběžně celý rok. Od té můžeš odstoupit do 14 dnů i poté, co ti začne
            běžet: vrátíme ti zaplacenou částku sníženou o poměrnou část za dny, kdy
            už jsi hlídání měl (§ 1834 občanského zákoníku). Právo odstoupit u ní
            zaniká až tím, že službu poskytneme úplně, tedy po uplynutí celého
            předplaceného roku (§ 1837 písm. a). Zaškrtnutí u objednávky u ní
            znamená jen to, že si přeješ začít hned — o právo odstoupit tě
            nepřipraví.
          </li>
        </ul>
        <p>
          Podrobnosti i vzorový formulář pro obě situace najdeš v{' '}
          <Link href="/odstoupeni" className="font-medium text-ruzova-text">
            poučení o odstoupení
          </Link>
          .
        </p>

        <h2 className="font-display text-lg font-semibold">6. Tvůj účet a data</h2>
        <p>
          Účet je osobní a nepřenosný. Do aplikace vkládej pouze data ke svým vlastním
          investičním účtům (případně účtům, ke kterým máš oprávnění). API klíče brokerů
          smí být pouze pro čtení; Danero nikdy nezadává obchodní příkazy. Data můžeš
          kdykoli smazat zrušením účtu. A kdyby Danero někdy končilo, dozvíš se to
          e-mailem nejméně 3 měsíce předem, po celou tu dobu si můžeš stáhnout export
          všech svých dat a případné nevyužité předplacené období ti vrátíme.
        </p>

        <h2 className="font-display text-lg font-semibold">7. Odpovědnost</h2>
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

        <h2 className="font-display text-lg font-semibold">8. Provozovatel a kontakt</h2>
        {/* § 1820 odst. 1 písm. c) OZ chce adresu, telefon i e-mail sdělit PŘED
            uzavřením smlouvy. Do 8. 8. 2026 se telefon vypisoval jen v e-mailech,
            tedy až potom (nález E-3-02). Údaje se berou z lib/contact.ts, ať se
            jednotlivé stránky nerozejdou (E-3-15). */}
        <p>
          Danero je osobní projekt — provozuje ho {OPERATOR.name}, IČO {OPERATOR.ico}, se
          sídlem {OPERATOR.address} (fyzická osoba podnikající dle živnostenského zákona,
          zapsaná v živnostenském rejstříku). Připomínky a chyby posílej na{' '}
          <a href={`mailto:${OPERATOR.email}`} className="font-medium text-ruzova-text">
            {OPERATOR.email}
          </a>
          {OPERATOR.phone ? (
            <>
              , telefon{' '}
              <a
                href={`tel:${OPERATOR.phone.replace(/\s/g, '')}`}
                className="font-medium text-ruzova-text"
              >
                {OPERATOR.phone}
              </a>
            </>
          ) : null}
          .
        </p>

        <h2 className="font-display text-lg font-semibold">9. Když se neshodneme</h2>
        <p>
          Nejrychlejší cesta je napsat mi — snažím se každý problém vyřešit napřímo.
          Pokud se nedohodneme a jsi spotřebitel, můžeš se obrátit na Českou obchodní
          inspekci, která řeší spotřebitelské spory mimosoudně: {ADR.authority},{' '}
          {ADR.address},{' '}
          <a
            href={`https://${ADR.web}`}
            className="font-medium text-ruzova-text"
            target="_blank"
            rel="noreferrer"
          >
            {ADR.web}
          </a>
          ; návrh jde podat online na{' '}
          <a
            href={`https://${ADR.online}`}
            className="font-medium text-ruzova-text"
            target="_blank"
            rel="noreferrer"
          >
            {ADR.online}
          </a>
          .
        </p>

        <h2 className="font-display text-lg font-semibold">10. Rozhodné právo a změny podmínek</h2>
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
        Verze {TERMS_VERSION} · účinnost od {TERMS_EFFECTIVE_FROM} · změny oznámíme e-mailem
      </p>

      <p className="text-sm">
        <Link href="/" className="font-medium text-ruzova-text">
          ← Zpět na úvod
        </Link>
      </p>
      </div>
    </MarketingPage>
  );
}
