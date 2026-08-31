import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingCta, MarketingPage, PageHero } from '@/components/marketing-page';
import { verifiedRateSourceNote } from '@/lib/tax-config';

export const metadata: Metadata = {
  title: 'Jak počítáme — Danero',
  description:
    'Daňová metodika Danera v lidské řeči: časový test 3 roky, limit 100 000 Kč, kryptoaktiva, dividendy, deriváty, kurzy i párování prodejů — každé pravidlo s odkazem na paragraf a poctivě označenými spornými výklady.',
};

/** Jedno pravidlo metodiky: lidský výklad + citace zdroje drobným písmem. Obsah výhradně dle docs/02. */
const PRAVIDLA: { id: string; title: string; body: React.ReactNode; zdroj: string }[] = [
  {
    id: 'casovy-test',
    title: 'Časový test: po 3 letech bez daně',
    body: (
      <>
        <p>
          Prodáš-li cenný papír (akcii, ETF, podílový list) po více než 3 letech od
          nabytí, je příjem osvobozený od daně — bez ohledu na výši zisku. Lhůta musí
          uplynout celá: prodej přesně na třetí výročí ještě osvobozený není, den po
          něm už ano.
        </p>
        <p>
          Každý nákup má vlastní lhůtu. Přikupoval jsi stejné ETF postupně? Danero
          vede každý nákup zvlášť a při prodeji přesně ví, které kusy už testem
          prošly a které ne — na časové ose uvidíš datum osvobození každého lotu.
        </p>
        <p>
          Lhůta běží ode dne vypořádání obchodu (dne, kdy se ti kusy skutečně
          připíšou na účet — u amerických akcií den po obchodu, v Evropě typicky dva
          dny), ne ode dne kliknutí na „koupit“. Část praxe počítá den obchodu —
          bereme to jako sporný výklad a defaultně počítáme bezpečnější den
          vypořádání.
        </p>
        <p>
          Pro rok 2025 navíc platil strop: takto osvobodit šlo nejvýš 40 mil. Kč
          příjmů za rok. Od roku 2026 je strop pro cenné papíry zrušený — pro
          kryptoaktiva platí dál.
        </p>
      </>
    ),
    zdroj:
      '§ 4 odst. 1 písm. u) a § 4 odst. 3 zákona č. 586/1992 Sb. o daních z příjmů; pokyn GFŘ D-59 (okamžik nabytí = den vypořádání); zák. č. 349/2023 Sb. a č. 360/2025 Sb. (strop 40 mil. Kč a jeho zrušení pro cenné papíry).',
  },
  {
    id: 'limit-100k',
    title: 'Limit 100 000 Kč: malé prodeje se neřeší',
    body: (
      <>
        <p>
          Jsou-li tvoje celkové tržby z prodejů cenných papírů za rok nejvýš
          100 000 Kč, jsou osvobozené — i když jsi nic nedržel 3 roky. Pozor: počítá
          se objem prodejů (kolik ti z nich přišlo), ne zisk. I prodej za 101 000 Kč
          se ztrátou limit prolomí.
        </p>
        <p>
          A je to útes, ne odpočet: do 100 000 Kč je osvobozené všechno, od
          100 001 Kč padá tohle osvobození celé. Limit se navíc sčítá přes všechny
          tvoje brokery a účty dohromady.
        </p>
        <p>
          Sporné je, jestli se do úhrnu počítají i prodeje osvobozené časovým
          testem. Převažující (striktní) výklad říká, že ano — a ten máme jako
          default. Mírnější výklad je nepočítá; Danero ti vedle vyčíslí, co by pro
          tebe znamenal, i s poctivým popisem rizika.
        </p>
        <p>
          Limit pro cenné papíry a limit pro kryptoaktiva jsou dva oddělené limity —
          čerpají se nezávisle na sobě.
        </p>
      </>
    ),
    zdroj:
      '§ 4 odst. 1 písm. t) zákona o daních z příjmů; pokyn GFŘ D-59 (bod 20 k § 4 odst. 1: osvobození podle písm. t) a u) nelze kombinovat — opora striktního výkladu).',
  },
  {
    id: 'krypto',
    title: 'Kryptoaktiva: od 15. 2. 2025 vlastní pravidla',
    body: (
      <>
        <p>
          Od 15. 2. 2025 mají kryptoaktiva vlastní osvobození po vzoru cenných
          papírů: vlastní limit 100 000 Kč ročních tržeb i vlastní tříletý časový
          test. Doba držby před účinností zákona se započítává — bitcoin koupený
          v roce 2020 a prodaný v březnu 2025 je osvobozený.
        </p>
        <p>
          Prodeje mezi 1. 1. a 14. 2. 2025 ale osvobodit nejdou — daní se celé
          (a do limitu 100 000 Kč se nepočítají). Za rok 2024 a dřív krypto žádné
          osvobození nemělo.
        </p>
        <p>
          Stablecoiny (tokeny navázané na měnu, třeba USDT nebo USDC) zákon
          z limitu 100 000 Kč výslovně vylučuje — hodnotové osvobození na ně
          neplatí. U tříletého testu je naopak nevylučuje; je to sporné místo
          a v aplikaci na něj u dotčených prodejů upozorníme.
        </p>
        <p>
          Směna krypta za jiné krypto je daňově prodej — daní se v obvyklé ceně,
          i když jsi žádné koruny neviděl. A krypto je jiný druh příjmu než cenné
          papíry: ztráty z krypta nejde odečíst od zisků z akcií, ani naopak.
        </p>
      </>
    ),
    zdroj:
      '§ 4 odst. 1 písm. zj) a zk) zákona o daních z příjmů (zák. č. 32/2025 Sb., účinnost 15. 2. 2025); koordinační výbor KOOV 625/30.04.25 se souhlasem GFŘ (započtení držby, okno 1. 1.–14. 2. 2025); Informace GFŘ č. j. 18809/22 (směna krypto–krypto, druh příjmu).',
  },
  {
    id: 'dividendy',
    title: 'Dividendy a úroky: brutto a zápočet po státech',
    body: (
      <>
        <p>
          Zahraniční dividendy se u nás daní z hrubé (brutto) částky — tedy z toho,
          co firma vyplatila před stržením zahraniční daně, ne z toho, co ti
          přistálo na účtu.
        </p>
        <p>
          Daň sraženou v zahraničí si můžeš započíst proti české dani, a to po
          jednotlivých státech — vždy ale jen do stropu ze smlouvy o zamezení
          dvojího zdanění: USA, Německo či Japonsko 15 %, Nizozemsko jen 10 %.
          Co je sraženo nad smluvní strop, fakticky propadá.
        </p>
        <p>
          U amerických akcií rozhoduje formulář W-8BEN (potvrzení brokerovi, že
          nejsi americký daňový rezident): s ním se sráží 15 %, bez něj 30 % —
          započíst jde i tak jen 15 %. Nebudeme se tě na něj ptát, poznáme ho
          z výše srážek ve tvých datech.
        </p>
        <p>
          České dividendy jsou vyřešené srážkou 15 % u zdroje — do přiznání se
          neuvádějí a do žádných limitů nevstupují. Úroky od brokera se daní celé,
          bez výdajů.
        </p>
        {/* K7a-02: § 7a odst. 5 — uplatnění zápočtu v přiznání ruší rovnost daně
            paušální dani za celý rok. Bez téhle výhrady tvrdila stránka
            paušalistovi zápočet bez omezení. Text schválený 23. 8. 2026. */}
        <p>
          <strong>
            Jsi OSVČ v paušálním režimu a limit 50 000 Kč jsi nepřekročil? Pak si
            sraženou daň ze zahraničí v Česku nezapočteš — a je to tak v pořádku.
          </strong>{' '}
          V paušálním režimu je tvoje daň rovna paušální dani (§ 7a), takže
          z těchhle dividend a úroků tu žádnou daň neplatíš. Není proti čemu
          srážku započítat.
        </p>
        <p>
          Kdybys ji <strong>v přiznání uplatnil</strong>, přestala by ti daň být
          rovna paušální dani za celý rok (§ 7a odst. 5). Kromě přiznání by přišly
          přehledy pro ČSSZ i zdravotní pojišťovnu a doplatek pojistného ze
          skutečných příjmů. V paušálním režimu bys přitom zůstal a zálohy platil
          dál. Co dává smysl místo toho: hlídat, ať ti v zahraničí nesrazí víc, než
          dovoluje smlouva — u amerických dividend bez formuláře W-8BEN je to 30 %
          místo 15 %. Rozdíl se žádá zpět ve státě zdroje, ne v českém přiznání.
          (Kdo limit 50 000 Kč překročil, přiznání podává tak jako tak a zápočet
          uplatní v plné výši.)
        </p>
      </>
    ),
    zdroj:
      '§ 8 a § 38f zákona o daních z příjmů (metoda prostého zápočtu); § 7a odst. 5 (uplatnění zápočtu v přiznání ruší rovnost daně paušální dani); smlouvy o zamezení dvojího zdanění, čl. 10 — USA č. 32/1994 Sb., Německo č. 18/1984 Sb., Nizozemsko č. 138/1974 Sb.',
  },
  {
    id: 'derivaty',
    title: 'Deriváty: samostatný svět bez osvobození',
    body: (
      <>
        <p>
          CFD, opce a futures (nástroje odvozené od ceny něčeho jiného) nejsou
          cenné papíry — daní se jako ostatní příjem a tvoří samostatný druh vedle
          akcií a krypta.
        </p>
        <p>
          Nevztahuje se na ně žádné osvobození: ani tříletý test, ani limit
          100 000 Kč. Zisky a ztráty se sčítají jen mezi deriváty navzájem —
          derivátovou ztrátu nejde odečíst od zisků z akcií a celková ztráta za
          rok zaniká, do dalšího roku se nepřenáší.
        </p>
        <p>
          K derivátům drobných investorů neexistuje oficiální metodika ani
          judikatura — pravidla stojí na obecném textu zákona a ustálené praxi
          daňových poradců. Kde je výklad nejistý, volíme bezpečnou variantu
          a říkáme to nahlas.
        </p>
      </>
    ),
    zdroj:
      '§ 10 zákona o daních z příjmů; pokyn GFŘ D-59 k § 10 odst. 4 (samostatné druhy příjmů, kompenzace jen uvnitř druhu); ustálená výkladová praxe (bez oficiálního pokynu k derivátům).',
  },
  {
    id: 'limity-podani',
    title: 'Kdy vůbec podávat přiznání',
    body: (
      <>
        <p>
          OSVČ v paušálním režimu: aby daň zůstala „rovna paušální dani“, smí
          tvoje příjmy z kapitálu, nájmu a ostatní příjmy (mimo podnikání) dělat
          v úhrnu nejvýš 50 000 Kč za rok. Počítají se hrubé tržby, ne zisk —
          prodej akcií za 120 000 Kč se ziskem 5 000 Kč znamená 120 000 Kč do
          limitu. Osvobozené příjmy a české dividendy se srážkou se nepočítají
          vůbec.
        </p>
        <p>
          Prolomení limitu paušální režim neukončuje — jen za ten rok podáš běžné
          přiznání a přehledy pojistného; zaplacené paušální zálohy se započtou.
        </p>
        <p>
          Zaměstnanec podává přiznání, přesáhnou-li jeho zdanitelné příjmy mimo
          zaměstnání 20 000 Kč za rok. Pro ostatní platí obecný limit 50 000 Kč
          zdanitelných příjmů. Jestli se tě to týká, zjistíš za minutu v{' '}
          <Link
            href="/kalkulacka"
            className="font-medium text-ruzova-text underline underline-offset-2"
          >
            kalkulačce přiznání
          </Link>
          .
        </p>
        {/* E-3-07: § 38v je v kalkulačce i v hlídání limitů, ale tady chyběl —
            a je to jediná povinnost, která se týká i příjmu OSVOBOZENÉHO. */}
        <p>
          Zvlášť stojí <strong>oznámení osvobozeného příjmu nad 5 000 000 Kč</strong>.
          Týká se i příjmu, který danit nemusíš — třeba prodeje akcií po třech
          letech držby. Přiznání kvůli němu nevzniká, ale finanční správě se ta
          jediná částka musí oznámit. Pokuta za neoznámení jde do procent
          z neoznámené částky, takže se to vyplatí nepřehlédnout. Danero takové
          příjmy označí samo.
        </p>
        {/* K7a-03: „ve stejné lhůtě jako přiznání“ platilo jen pro toho, kdo
            přiznání podává. Měsíc navíc dává § 136 odst. 2 písm. a) daňového
            řádu výslovně jen tomu, kdo „následně“ přiznání podá elektronicky —
            kdo ho nepodává vůbec, zůstává na základních třech měsících. */}
        <p>
          <strong>Lhůta na oznámení je kratší, než čekáš.</strong> Kdo přiznání
          podává, oznamuje ve stejné lhůtě jako přiznání. Kdo ho nepodává, má na
          oznámení jen tři měsíce po konci roku — měsíc navíc totiž zákon dává
          jen tomu, kdo přiznání skutečně podá elektronicky, a půl roku jen
          tomu, komu ho podá poradce.
        </p>
      </>
    ),
    zdroj:
      '§ 7a, § 38g a § 38v zákona o daních z příjmů; § 136 odst. 1 a 2 daňového řádu a pokyn GFŘ D-59, str. 45 („K § 38v“ — lhůta oznámení u toho, kdo přiznání nepodává); FAQ Finanční správy k paušální dani (otázka 61 — limit 50 000 Kč).',
  },
  {
    id: 'kurzy',
    title: 'Kurzy: jednotný, nebo denní — spočítáme oba',
    body: (
      <>
        <p>
          Obchody v cizí měně se přepočítávají do korun. Zákon nabízí dvě soustavy:
          jednotný kurz GFŘ (jeden kurz za celý rok, vyhlašovaný zpětně v lednu)
          nebo denní kurzy ČNB. V jednom roce se nesmí kombinovat — ale vybrat si
          smíš tu výhodnější.
        </p>
        <p>
          Danero proto spočítá obě varianty a ukáže rozdíl v korunách (klidně
          i desítky tisíc). Jednotný kurz za běžný rok je do lednového vyhlášení
          jen orientační — a v aplikaci ho tak i označujeme.
        </p>
        <p>
          Nákupní cena (výdaj) se přepočítává kurzem roku nákupu, ne roku prodeje.
          Přesně tohle je nejčastější chyba ručních výpočtů.
        </p>
      </>
    ),
    // rozsah let ani čísla pokynů se nepišou ručně — po lednové údržbě by
    // věta zůstala pozadu za tabulkou, podle které se doopravdy počítá (K1-03)
    zdroj: `§ 38 odst. 1 zákona o daních z příjmů; ${verifiedRateSourceNote()}.`,
  },
  {
    id: 'parovani',
    title: 'Které kusy prodáváš? FIFO — a varianty vedle sebe',
    body: (
      <>
        <p>
          Když prodáš část pozice, kterou jsi nakupoval postupně, musí se určit,
          které kusy to byly — na tom závisí zisk i časový test. Zákon metodu
          nepředepisuje: FIFO (nejstarší kusy první), LIFO (nejnovější první)
          i vlastní výběr konkrétních kusů jsou přípustné. Podmínkou je
          průkaznost a konzistence.
        </p>
        <p>
          Default je FIFO — nejběžnější a nejsnáz obhajitelná metoda. Danero ale
          spočítá i ostatní varianty vedle sebe; zvolenou metodu na daný rok
          zafixuje a vytiskne do podkladů, ať je výpočet doložitelný.
        </p>
      </>
    ),
    zdroj:
      '§ 10 odst. 4 a 5 zákona o daních z příjmů; stanovisko GFŘ (metoda párování pro neúčtující fyzické osoby není předepsána).',
  },
];

export default function JakPocitamePage() {
  return (
    <MarketingPage>
      <PageHero
        eyebrow="Metodika"
        title="Každé pravidlo má svůj paragraf"
        lede="Tady je celá daňová metodika Danera přeložená do lidštiny — pravidlo po pravidlu, vždy s odkazem na zákon. A kde zákon mlčí nebo se výklady liší, dozvíš se to na rovinu."
      />

      <section aria-label="Daňová metodika" className="mt-12 space-y-6">
        {PRAVIDLA.map((pravidlo, i) => (
          <article
            key={pravidlo.id}
            id={pravidlo.id}
            className="max-w-3xl scroll-mt-24 rounded-lg border border-linka bg-plocha p-6 sm:p-8"
          >
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova-text">
              {String(i + 1).padStart(2, '0')}
            </p>
            <h2 className="mt-2 font-display text-xl font-semibold tracking-tight sm:text-2xl">
              {pravidlo.title}
            </h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-inkoust-tlumeny">
              {pravidlo.body}
            </div>
            <p className="mt-5 border-t border-linka pt-3 text-xs text-inkoust-tlumeny">
              Zdroj: {pravidlo.zdroj}
            </p>
          </article>
        ))}
      </section>

      <section aria-labelledby="sporne-vyklady" className="mt-16">
        <div className="max-w-3xl rounded-lg border border-ruzova/30 bg-ruzova/5 p-6 sm:p-8">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova-text">
            Naše zásada
          </p>
          <h2
            id="sporne-vyklady"
            className="mt-2 font-display text-xl font-semibold tracking-tight sm:text-2xl"
          >
            Sporné výklady přiznáváme
          </h2>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-inkoust-tlumeny">
            <p>
              Ne všechno v zákoně je jednoznačné — a nástroj, který dělá, že ano,
              ti lže. Kde existuje víc obhajitelných výkladů, Danero vždy počítá
              defaultně bezpečnou (přísnější) variantu, vedle v korunách vyčíslí,
              co by znamenal výhodnější výklad, a na rovinu popíše riziko, kdyby ho
              správce daně neuznal. Rozhodnutí je pak na tobě — přepínačem.
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                Limit 100 000 Kč: defaultně do něj počítáme i prodeje osvobozené
                časovým testem (striktní výklad); mírnější výklad je vynechává.
              </li>
              <li>
                Začátek časového testu: defaultně den vypořádání obchodu; část
                praxe počítá den zadání obchodu.
              </li>
              <li>
                Opce, která propadla bezcenná: zaplacenou prémii defaultně
                neuplatňujeme jako výdaj; mírnější výklad ji uplatní proti ostatním
                derivátovým příjmům.
              </li>
              <li>
                Stablecoiny a tříletý test: z limitu 100 000 Kč je zákon vylučuje,
                u tříletého testu mlčí — označujeme to jako sporné a u dotčených
                prodejů tě upozorníme.
              </li>
            </ul>
            <p>
              Zvolené přepínače se tisknou přímo do výstupních podkladů — kdyby se
              úřad ptal, máš černé na bílém, jak bylo počítáno.
            </p>
          </div>
        </div>
        <p className="mt-6 max-w-3xl text-xs text-inkoust-tlumeny">
          Danero je výpočetní a evidenční nástroj, nikoli daňové poradenství ve
          smyslu zákona č. 523/1992 Sb. — za správnost přiznání odpovídá poplatník.
          Metodika vychází ze zákona o daních z příjmů, pokynů GFŘ a závěrů
          koordinačních výborů ve stavu k červenci 2026 (pravidla pro roky 2025
          a 2026). U složitých situací (obchodní majetek, dědictví, velké objemy)
          se poraď s daňovým poradcem.
        </p>
      </section>

      <MarketingCta
        title="Paragrafy jsme přečetli za tebe"
        lede="Napoj brokera nebo nahraj výpis — Danero všechna tahle pravidla aplikuje na tvoje skutečné obchody a ukáže, co z nich plyne."
      />
    </MarketingPage>
  );
}
