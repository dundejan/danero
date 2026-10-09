import Link from 'next/link';
import { MarketingPage } from '@/components/marketing-page';
import { OPERATOR } from '@/lib/contact';
import { EPO_SUPPORTED_YEARS } from '@/lib/epo';
import { yearList } from '@/lib/format';
import {
  ADR,
  PREVIOUS_TERMS_URL,
  TERMS_EFFECTIVE_FROM,
  TERMS_OVERLAP_UNTIL,
  TERMS_VERSION,
} from '@/lib/legal';

export const metadata = {
  title: 'Podmínky užití — Danero',
  description:
    'Práva a povinnosti při užívání Danera: co služba dělá a nedělá, že je zdarma, a jak je to s odpovědností — srozumitelně a bez kliček.',
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
        {/*
          Verze 3.0 (8. 10. 2026): placené tarify zanikly. Do verze 2.4 tu byla
          cena, závazek aktualizací jako protiplnění ročního hlídání (E-3-09)
          a náhrada za výpadek. Poslední znění s placenou službou je
          v repozitáři pod značkou `placene-tarify`.
        */}
        <p>
          <strong>Danero je zdarma, a to celé</strong> — všechny funkce, bez časového
          omezení a bez platební karty. Placená verze neexistuje. Co všechno služba
          umí, popisuje stránka{' '}
          <Link href="/cenik" className="font-medium text-ruzova-text">
            Ceník
          </Link>
          .
        </p>
        <p>
          Na provoz jde dobrovolně přispět. Příspěvek <strong>není platbou za
          službu</strong>: nic se jím neodemyká, nevzniká ti jím žádný nárok a nic se
          jím nemění na tom, co ti Danero poskytuje.
        </p>
        <p>
          Kdyby se někdy cokoli mělo zpoplatnit, dozvíš se to předem podle článku 10
          a <strong>nic ti nikdy nezačneme účtovat bez tvojí výslovné objednávky</strong>{' '}
          — žádné údaje o platební kartě ani nemáme.
        </p>
        <p>
          <strong>Aktuálnost.</strong> Aplikaci držíme aktuální, jak nejlíp umíme:
          doplňujeme jednotný kurz vyhlášený GFŘ, nové hranice a limity pro uplynulý
          daňový rok a strukturu formuláře pro elektronické podání, jakmile ji finanční
          správa zveřejní. Do té doby počítáme s orientačními hodnotami a je to
          v aplikaci vidět. Je to ale projekt jednoho člověka — termín, do kdy bude
          která změna hotová, slíbit nemůžeme.
        </p>
        <p id="dostupnost">
          <strong>Dostupnost.</strong> Usilujeme o nepřetržitý provoz, ale
          negarantujeme ho: odstávky kvůli údržbě nebo výpadku dodavatele nastat
          můžou. O data při nich nepřijdeš a export všech svých dat si můžeš stáhnout
          kdykoli, kdy služba běží.
        </p>
        <p>
          Dvě věci, které se jako výhrada číst daly, výhradou nejsou: jednotný kurz pro
          právě probíhající rok je do vydání pokynu GFŘ orientační a aplikace ho tak
          i označuje — jakmile pokyn vyjde, čísla dopočítáme. A u sporných výkladů
          daňových předpisů počítáme obě varianty a ukazujeme rozdíl i riziko, takže
          rozhodnutí je na tobě, ale podklad k němu dostaneš.
        </p>

        <h2 className="font-display text-lg font-semibold">
          4. Co Danero potřebuje k provozu a co z něj vypadne
        </h2>
        <p>Ať víš předem, s čím Danero funguje a co si z něj odneseš:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Co potřebuješ:</strong> běžný webový prohlížeč v aktuální verzi
            (Chrome, Firefox, Safari, Edge) a připojení k internetu. Nic se neinstaluje —
            Danero běží celé v prohlížeči, na počítači i na telefonu. Dál potřebuješ{' '}
            <strong>funkční e-mailovou adresu</strong>: registraci potvrzuješ odkazem
            z e-mailu a na tutéž adresu chodí upozornění. Data do
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

        <h2 className="font-display text-lg font-semibold">5. Jak dlouho to trvá a jak skončit</h2>
        {/*
          Do verze 2.4 tu byly placené objednávky a 14denní odstoupení (§ 1829
          a násl. OZ) se samostatnou stránkou /odstoupeni. Bez plateb není od
          čeho odstupovat se lhůtou — odejít jde kdykoli a hned, což je víc.
        */}
        <p>
          Danero užíváš, dokud chceš. Skončit můžeš <strong>kdykoli, hned a bez udání
          důvodu</strong>: účet zrušíš v Nastavení a tím smažeš i všechna svoje data.
          Žádná výpovědní lhůta, žádné závazky, které by tě přežily — nic neplatíš,
          takže není co vracet ani doplácet.
        </p>

        <h2 className="font-display text-lg font-semibold">6. Tvůj účet a data</h2>
        <p>
          Účet je osobní a nepřenosný. Do aplikace vkládej pouze data ke svým vlastním
          investičním účtům (případně účtům, ke kterým máš oprávnění). API klíče brokerů
          smí být pouze pro čtení; Danero nikdy nezadává obchodní příkazy. Data můžeš
          kdykoli smazat zrušením účtu. A kdyby Danero někdy končilo, dozvíš se to
          e-mailem nejméně 3 měsíce předem a po celou tu dobu si můžeš stáhnout export
          všech svých dat.
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

        <h2 id="kontakt" className="font-display text-lg font-semibold">
          8. Provozovatel a kontakt
        </h2>
        {/* § 435 OZ: podnikatel uvádí na webu jméno, sídlo a IČO. Danero je sice
            zdarma, ale provozuje ho člověk se živností v oboru a přijímá na něj
            dobrovolné příspěvky — tvrdit, že to s podnikáním nesouvisí, by bylo
            na hraně, a údaje jsou stejně veřejné v živnostenském rejstříku.
            Berou se z lib/contact.ts, ať se stránky nerozejdou (E-3-15).

            Telefon se vypíše jen tehdy, když je nastavený. Povinný byl kvůli
            prodeji na dálku (§ 1820 odst. 1 písm. c OZ); bez prodeje stačí
            e-mail a `DANERO_CONTACT_PHONE` jde nechat prázdné. Stejnou
            podmínku má i věta, která e-mail s telefonem srovnává — bez čísla
            by čtenáře posílala hledat údaj, který na webu není (L7s-05). */}
        <p>
          Danero je osobní projekt — provozuje ho {OPERATOR.name}, IČO {OPERATOR.ico}, se
          sídlem {OPERATOR.address} (fyzická osoba podnikající dle živnostenského zákona,
          zapsaná v živnostenském rejstříku).{' '}
          {OPERATOR.phone ? (
            <>
              <strong>Piš radši e-mailem</strong> — na telefon se nedovoláš vždycky, kdežto
              na zprávu odpovím a zůstane z ní stopa pro obě strany.
            </>
          ) : (
            <>
              <strong>Piš e-mailem</strong> — na zprávu odpovím a zůstane z ní stopa pro obě
              strany.
            </>
          )}{' '}
          Připomínky a chyby posílej na{' '}
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
          Pokud s novým zněním nesouhlasíš, můžeš účet do dne účinnosti zrušit; jinak
          platí, že se službou pokračuješ podle nových podmínek. Aktuální verzi
          s datem účinnosti najdeš vždy na této stránce.
        </p>
        {/*
          Přechod z 2.4 na 3.0. Znění 2.4 slibovalo oznámit změnu 30 dní předem;
          zrušení plateb ale nemělo smysl o měsíc odkládat (nikomu by neprospělo,
          že si funkce ještě měsíc musí kupovat). Účtům založeným dřív proto
          vedle nového znění platí po tu dobu i to staré — slib je dodržen
          v tom, na čem záleží: nic se jim nezhorší dřív než za 30 dní.
        */}
        <p>
          <strong>Co se změnilo ve verzi {TERMS_VERSION}.</strong> Danero přestalo
          cokoli prodávat. Z podmínek proto zmizelo všechno o cenách, objednávkách
          a odstoupení od smlouvy; žádnou novou povinnost ti tohle znění nepřidává.
          Máš-li účet z dřívějška, platí pro tebe do {TERMS_OVERLAP_UNTIL} vedle
          něj i{' '}
          <a
            href={PREVIOUS_TERMS_URL}
            className="font-medium text-ruzova-text"
            target="_blank"
            rel="noreferrer"
          >
            předchozí znění 2.4
          </a>{' '}
          — kde by pro tebe bylo výhodnější, použije se ono.
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
