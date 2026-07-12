import type { Metadata } from 'next';
import { MarketingCta, MarketingPage, PageHero } from '@/components/marketing-page';
import {
  ClanekOdkaz,
  ClanekPata,
  ClanekSekce,
  ClanekTelo,
  ClanekUvod,
  Priklad,
} from '@/components/pruvodce-clanek';

export const metadata: Metadata = {
  title: 'XTB a české daně: výpis z xStation, dividendy a CFD — Danero',
  description:
    'Jak z XTB stáhnout Full report (XLSX), co se v Česku daní: prodeje akcií a ETF s limitem 100 000 Kč a tříletým testem, dividendy v hrubé výši — a proč se CFD daní úplně jinak, bez jakéhokoli osvobození.',
};

export default function XtbDanePage() {
  return (
    <MarketingPage>
      <PageHero
        eyebrow="Průvodce"
        title="XTB a české daně"
        lede="Jak z xStation dostat kompletní výpis, co z účtu u XTB patří do českého přiznání — a proč se CFD daní úplně jinak než akcie."
      />

      <ClanekTelo>
        <ClanekUvod>
          <strong>
            I u XTB platí běžná česká pravidla: prodeje akcií a ETF jsou osvobozené do
            100 000 Kč tržeb za rok nebo po třech letech držení a zahraniční dividendy
            patří do přiznání v hrubé výši. CFD obchody jsou ale samostatný druh příjmu —
            bez limitu, bez časového testu a se ztrátou, která se nikam nepřenáší.
          </strong>{' '}
          A česká pobočka XTB na tom nic nemění: daně z investic si řešíš sám, stejně jako
          u kteréhokoli jiného brokera.
        </ClanekUvod>

        <ClanekSekce title="Jak z XTB dostat výpis">
          <p>
            V platformě xStation otevři <strong>Historii účtu</strong> a stáhni export
            „Full report" (soubor XLSX) — obsahuje obchody, dividendy i poplatky za
            zvolené období. Jedna zvláštnost: XTB do exportu nedává ISIN (mezinárodní
            identifikátor cenného papíru) ani měnu instrumentu. Danero tě proto při prvním
            importu požádá o doplnění a napořád si je zapamatuje — příště už jen nahraješ
            nový report.
          </p>
        </ClanekSekce>

        <ClanekSekce title="„Český broker“ neznamená vyřešené daně">
          <p>
            XTB v Česku působí přes pobočku, má českou podporu i platformu v češtině.
            Daňově jsi na tom ale úplně stejně jako u zahraničního brokera: českou daň
            z prodejů ani z dividend za tebe XTB neodvádí a přiznání nepodává. Jediné, co
            se strhává samo, je srážková daň u zdroje — u zahraničních dividend ji sráží
            stát sídla firmy, která dividendu vyplácí, u českých firem český plátce.
            Rozhoduje tedy vždy domicil akcie, ne sídlo brokera.
          </p>
          <p>
            Dividendy českých firem jsou tím vyřízené — 15% srážka je konečná, do přiznání
            se neuvádějí a žádné limity neplní. Všechno ostatní je na tobě.
          </p>
        </ClanekSekce>

        <ClanekSekce title="Prodeje akcií a ETF: dvě cesty k osvobození">
          <p>
            První cesta: úhrn hrubých <strong>tržeb</strong> z prodejů cenných papírů za
            kalendářní rok do 100 000 Kč — počítá se objem prodejů, ne zisk, a sčítá se
            přes všechny brokery a účty dohromady (obchoduješ-li i jinde, tržby se
            sčítají). Druhá cesta: kusy držené déle než 3 roky — datum osvobození
            konkrétního nákupu ti ukáže{' '}
            <ClanekOdkaz href="/casovy-test">kalkulačka časového testu</ClanekOdkaz>. Jak
            přesně limit funguje a co udělá koruna navíc, rozebírá článek{' '}
            <ClanekOdkaz href="/pruvodce/limit-100-000-kc">
              Limit 100 000 Kč: počítá se objem prodejů, ne zisk
            </ClanekOdkaz>
            .
          </p>
          <p>
            Neosvobozené prodeje patří do přiznání: daní se rozdíl mezi prodejní a nabývací
            cenou včetně poplatků, zisky a ztráty z prodejů cenných papírů se v rámci roku
            vzájemně započtou.
          </p>
        </ClanekSekce>

        <ClanekSekce title="Dividendy: hrubá výše a zápočet po státech">
          <p>
            Zahraniční dividendy se přiznávají <strong>brutto</strong> — před daní
            sraženou v zahraničí, přepočtené na koruny. Sraženou daň si započteš na českou
            daň po jednotlivých státech, vždy nejvýš do sazby podle mezinárodní smlouvy
            (u většiny států 15 %, například u Nizozemska jen 10 %). Když stát srazí víc,
            než smlouva připouští, rozdíl si od české daně neodečteš — někdy ho lze žádat
            zpět přímo v zemi zdroje. U amerických akcií drží srážku na smluvních 15 %
            formulář W-8BEN (potvrzení, že nejsi americký daňový rezident); bez něj USA
            srazí 30 % a započíst jde pořád jen 15 %.
          </p>
          <p>
            Platí ti XTB úrok z volné hotovosti? I ten je zdanitelný příjem z kapitálového
            majetku — hrubý, bez výdajů, a počítá se do limitu 50 000 Kč pro OSVČ
            v paušálním režimu i 20 000 Kč vedlejších příjmů zaměstnance.
          </p>
        </ClanekSekce>

        <ClanekSekce title="CFD: samostatný druh příjmu bez osvobození">
          <p>
            CFD (kontrakty na vyrovnání rozdílu cen) a další deriváty se nedaní jako cenné
            papíry, ale jako <strong>samostatný druh ostatních příjmů</strong>. To znamená:
            žádný limit 100 000 Kč, žádný tříletý test — daní se každý rok. Zisky a ztráty
            z uzavřených derivátových obchodů se v rámci roku vzájemně započtou, ale jen
            mezi sebou: ztrátu z CFD nepoužiješ proti zisku z akcií ani naopak. A když
            derivátový rok skončí celkově ve ztrátě, daň z derivátů je nula — ztráta ale
            zaniká, do dalšího roku se nepřenáší. (Detaily u derivátů zákon výslovně
            neřeší; popsaný postup odpovídá převažující praxi, kterou uvádí i samotné XTB.)
          </p>
          <Priklad title="Rok s CFD obchody">
            <p>
              Uzavřeš obchody s výsledky +30 000 Kč a −20 000 Kč: daníš 10 000 Kč. Kdyby
              rok skončil celkově na −20 000 Kč, daň je nula — ztrátu si ale nepřeneseš do
              dalšího roku ani ji nezapočteš proti zisku z prodeje akcií.
            </p>
          </Priklad>
          <p>
            Pro OSVČ v paušálním režimu je tu ještě jedna zrada: do limitu 50 000 Kč
            jiných příjmů vstupují <strong>hrubá kladná plnění</strong> z derivátů, ne
            čistý zisk po odečtení ztrát. Víc v článku{' '}
            <ClanekOdkaz href="/pruvodce/pausalni-rezim-a-investice">
              OSVČ v paušálu: jak ti investice můžou vrátit přiznání
            </ClanekOdkaz>
            .
          </p>
        </ClanekSekce>

        <ClanekSekce title="Jak s tím pomůže Danero">
          <p>
            Full report z XTB nahraješ a formát poznáme sami. Danero roztřídí akcie, ETF,
            dividendy i CFD do správných druhů příjmů, přepočítá kurzy, ohlídá limity přes
            všechny tvoje platformy dohromady a z týchž dat připraví podklady k přiznání.
            Které další platformy umíme načíst, ukazuje stránka{' '}
            <ClanekOdkaz href="/platformy">Platformy</ClanekOdkaz>.
          </p>
        </ClanekSekce>

        <ClanekPata
          dalsi={[
            {
              href: '/pruvodce/limit-100-000-kc',
              title: 'Limit 100 000 Kč: počítá se objem prodejů, ne zisk',
            },
            {
              href: '/pruvodce/trading-212-dane',
              title: 'Trading 212 a české daně',
            },
            { href: '/casovy-test', title: 'Kalkulačka časového testu' },
          ]}
        />
      </ClanekTelo>

      <MarketingCta
        title="Nahraj Full report a uvidíš, jak na tom jsi"
        lede="Danero rozdělí akcie, dividendy i CFD do správných kolonek, přepočítá kurzy a ukáže čerpání limitů — z jednoho souboru, přes všechny platformy dohromady."
        primary="registrace"
      />
    </MarketingPage>
  );
}
