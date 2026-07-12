import type { Metadata } from 'next';
import { MarketingCta, MarketingPage, PageHero } from '@/components/marketing-page';
import {
  ClanekOdkaz,
  ClanekPata,
  ClanekSekce,
  ClanekTelo,
  ClanekUvod,
  Priklad,
  SpornyVyklad,
} from '@/components/pruvodce-clanek';

export const metadata: Metadata = {
  title: 'Limit 100 000 Kč z prodeje akcií: počítá se objem, ne zisk — Danero',
  description:
    'Osvobození prodejů cenných papírů do 100 000 Kč ročně se počítá z hrubých tržeb, ne ze zisku — nejčastější omyl českých investorů. Jak funguje překročení limitu, vztah k tříletému testu a proč má krypto vlastní stovku.',
};

export default function Limit100000KcPage() {
  return (
    <MarketingPage>
      <PageHero
        eyebrow="Průvodce"
        title="Limit 100 000 Kč: počítá se objem prodejů, ne zisk"
        lede="Nejrozšířenější omyl českých investorů. Kdy se prodeje akcií a ETF nedaní vůbec, co udělá jediná koruna nad limit a jak do toho vstupují časový test a krypto."
      />

      <ClanekTelo>
        <ClanekUvod>
          <strong>
            Do limitu 100 000 Kč se počítá, za kolik jsi za rok prodal — úhrn hrubých
            tržeb ze všech prodejů cenných papírů dohromady — a ne, kolik jsi na nich
            vydělal.
          </strong>{' '}
          Prodej za 105 000 Kč se ztrátou tedy limit překračuje, zatímco prodej za
          99 000 Kč se ziskem 40 000 Kč je celý osvobozený. Přesně 100 000 Kč ještě
          vyhovuje; první koruna navíc shazuje osvobození celé.
        </ClanekUvod>

        <ClanekSekce title="Jak limit funguje">
          <p>
            Zákon o daních z příjmů (§ 4 odst. 1 písm. t) osvobozuje příjmy z prodeje
            cenných papírů, pokud jejich <strong>úhrn za kalendářní rok nepřesáhne
            100 000 Kč</strong>. Nezkoumá se zisk, ztráta ani doba držení — jen součet
            toho, co ti prodeje hrubě vynesly. Tři důsledky, které se pletou nejčastěji:
          </p>
          <Priklad title="Tři situace, stejné pravidlo">
            <p>
              Prodáš akcie za 105 000 Kč se ztrátou 10 000 Kč → limit překročen, prodeje
              osvobozené limitem nejsou.
            </p>
            <p>
              Prodáš ETF za 99 000 Kč se ziskem 40 000 Kč → tržby do limitu, všechno
              osvobozeno, daň z prodejů nula.
            </p>
            <p>
              Prodáš za 60 000 Kč u jednoho brokera a za 50 000 Kč u druhého → úhrn
              110 000 Kč, limit překročen. Sčítá se přes všechny brokery a účty — limit
              nejde „rozložit mezi platformy“.
            </p>
          </Priklad>
          <p>
            Limit se počítá každý kalendářní rok znovu a je stejný pro rok 2025 i 2026.
            Jestli se tě týká přiznání, zjistíš orientačně za minutu v{' '}
            <ClanekOdkaz href="/kalkulacka">kalkulačce Musím podat přiznání?</ClanekOdkaz>
          </p>
        </ClanekSekce>

        <ClanekSekce title="Koruna navíc a osvobození padá celé">
          <p>
            Limit funguje jako práh, ne jako odpočet: při překročení se nedaní jen částka
            nad 100 000 Kč, ale <strong>osvobození padá pro všechny prodeje</strong>.
            Každý prodej se pak posuzuje tříletým testem, a co jím neprojde, patří do
            přiznání — daní se rozdíl mezi prodejní a nabývací cenou včetně poplatků,
            zisky a ztráty z prodejů se v rámci roku vzájemně započtou.
          </p>
          <Priklad title="99 000 vs. 101 000 Kč">
            <p>
              Koupíš akcie za 100 000 Kč a za rok je prodáš za 101 000 Kč: limit je
              překročen, zisk 1 000 Kč se daní 15 % — daň 150 Kč, ale přiznání podáváš.
            </p>
            <p>
              Kdybys prodal za 99 000 Kč (a jiné prodeje neměl), je všechno osvobozené
              a kvůli prodejům se přiznání neřeší vůbec.
            </p>
          </Priklad>
          <p>
            A pozor: povinnost podat přiznání se posuzuje z <strong>hrubých</strong>{' '}
            příjmů, ne ze zisku. Neosvobozené prodeje za 101 000 Kč jsou nad obecnou
            hranicí 50 000 Kč zdanitelných příjmů (u zaměstnance stačí 20 000 Kč
            vedlejších příjmů) — přiznání tak může vyjít i s nulovou daní, třeba když jsi
            prodával se ztrátou. A platí to i naruby: když jsou prodeje osvobozené,
            ztráty z nich nikam neuplatníš.
          </p>
        </ClanekSekce>

        <ClanekSekce title="Vztah k tříletému testu">
          <p>
            Limit 100 000 Kč a tříletý časový test jsou <strong>dvě nezávislá
            osvobození</strong>. Kusy držené déle než 3 roky jsou osvobozené bez ohledu na
            objem — klidně i milionové prodeje. (Jen v roce 2025 pro časově osvobozené
            příjmy platil strop 40 mil. Kč ročně; od roku 2026 je pro cenné papíry
            zrušený, pro krypto trvá.) Kdy tvému nákupu doběhnou tři roky, hlídá Danero
            u každého nákupu zvlášť na horizontu osvobození.
          </p>
          <SpornyVyklad>
            <p>
              Sporné je, jestli se prodeje osvobozené časovým testem počítají do úhrnu
              100 000 Kč. Převažující (přísnější) výklad říká, že ano; menšinový je
              nepočítá. Danero standardně počítá přísně — a zároveň ti ukáže, co by
              znamenal výklad výhodnější, ať se rozhoduješ s otevřenýma očima.
            </p>
            <p>
              Příklad rozdílu: prodáš za 80 000 Kč akcie držené 5 let a za 90 000 Kč
              akcie držené rok. Přísně je úhrn 170 000 Kč → limit překročen a zisk
              z prodeje za 90 000 Kč se daní — daní se vždy zisk (prodejní minus nákupní
              cena), ne celá tržba (těch 80 000 Kč chrání časový test dál). Podle
              mírnějšího výkladu se počítá jen 90 000 Kč → pod limitem, osvobozeno všechno.
            </p>
          </SpornyVyklad>
        </ClanekSekce>

        <ClanekSekce title="Krypto má vlastní stovku">
          <p>
            Od 15. 2. 2025 mají kryptoaktiva <strong>vlastní limit 100 000 Kč</strong>{' '}
            a vlastní tříletý test — oddělené od cenných papírů, oba limity se čerpají
            nezávisle. V jednom roce tak můžeš osvobozeně prodat cenné papíry za
            100 000 Kč a krypto za dalších 100 000 Kč. Do doby držení se počítá i držba
            před účinností novely (nákup 2020, prodej v březnu 2025 = osvobozeno).
          </p>
          <p>
            Tři háčky: prodeje krypta z 1. 1. až 14. 2. 2025 jsou plně zdanitelné a do
            limitu se nepočítají (novela platí až od účinnosti). Prodejem je i{' '}
            <strong>směna krypta za jiné krypto</strong>, nejen výběr do korun. A na
            stablecoiny (tzv. elektronické peněžní tokeny, třeba USDT) se limit 100 000 Kč
            ze zákona nevztahuje; u tříletého testu je jejich postavení sporné.
          </p>
        </ClanekSekce>

        <ClanekSekce title="Jak limit uhlídat v praxi">
          <p>
            Zrada limitu je v tom, že o něm rozhoduje součet za celý rok přes všechny
            účty — a v prosinci už bývá pozdě. Danero průběžně sčítá tržby ze všech
            napojených platforem, vede stovku pro cenné papíry a pro krypto zvlášť,
            a prodej si můžeš nanečisto nasimulovat ještě před obchodem: uvidíš, co udělá
            s limitem i s časovými testy. Když se hranice blíží, přijde e-mail. Které
            platformy umíme načíst, najdeš na stránce{' '}
            <ClanekOdkaz href="/platformy">Platformy</ClanekOdkaz>.
          </p>
        </ClanekSekce>

        <ClanekPata
          dalsi={[
            {
              href: '/pruvodce/pausalni-rezim-a-investice',
              title: 'OSVČ v paušálu: jak ti investice můžou vrátit přiznání',
            },
            { href: '/jak-pocitame', title: 'Jak počítáme — celá metodika s paragrafy' },
            { href: '/kalkulacka', title: 'Kalkulačka: Musím podat přiznání?' },
          ]}
        />
      </ClanekTelo>

      <MarketingCta
        title="Kolik ze stovky máš letos vyčerpáno?"
        lede="Napoj brokera nebo nahraj výpis — Danero sečte tržby přes všechny platformy, vede limit pro akcie i krypto zvlášť a při 60, 85 a 100 % čerpání ti napíše."
        primary="registrace"
      />
    </MarketingPage>
  );
}
