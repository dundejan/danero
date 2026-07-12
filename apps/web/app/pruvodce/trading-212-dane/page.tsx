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
  title: 'Trading 212 a české daně: co se daní a jak získat data — Danero',
  description:
    'Jak z Trading 212 dostat kompletní data (CSV export i API klíč jen pro čtení), co se v Česku daní — prodeje a limit 100 000 Kč, dividendy v hrubé výši s W-8BEN a úroky z hotovosti — a jak to pohlídá Danero.',
};

export default function Trading212DanePage() {
  return (
    <MarketingPage>
      <PageHero
        eyebrow="Průvodce"
        title="Trading 212 a české daně"
        lede="Co všechno z účtu u Trading 212 patří do českého přiznání, jak z platformy dostat kompletní historii a na kterou položku se zapomíná nejčastěji."
      />

      <ClanekTelo>
        <ClanekUvod>
          <strong>
            U Trading 212 platí běžná česká pravidla: prodeje akcií a ETF jsou osvobozené,
            když tvoje tržby ze všech prodejů za rok nepřesáhnou 100 000 Kč, nebo když kusy
            držíš přes 3 roky. Zahraniční dividendy patří do přiznání v hrubé výši
            a zdanitelný je i úrok, který ti Trading 212 platí z nezainvestované hotovosti.
          </strong>{' '}
          Broker za tebe českou daň neodvádí — všechno stojí na tvých datech. Dobrá zpráva:
          z Trading 212 se dají dostat kompletní, a to hned dvěma způsoby.
        </ClanekUvod>

        <ClanekSekce title="Jak z Trading 212 dostat data">
          <p>
            <strong>Export CSV:</strong> v aplikaci otevři sekci History a nech si
            vygenerovat export. Soubor se připravuje chvíli na pozadí — Trading 212 ti
            o hotovém dokumentu pošle notifikaci. Export je omezený na jeden rok, takže za
            delší historii stáhneš víc souborů; rok bez obchodů vyjde jako prázdný soubor,
            to je v pořádku.
          </p>
          <p>
            <strong>API klíč jen pro čtení:</strong> v aplikaci Nastavení → API vygeneruješ
            klíč, kterým si aplikace jako Danero můžou historii načítat samy. Klíč jen pro
            čtení nemůže obchodovat, vybírat peníze ani nic měnit na účtu — u nás je navíc
            uložený šifrovaně (podrobnosti na stránce{' '}
            <ClanekOdkaz href="/bezpecnost">Bezpečnost</ClanekOdkaz>). Výhoda proti CSV:
            nemusíš na nic myslet, nové obchody a dividendy se načítají průběžně.
          </p>
        </ClanekSekce>

        <ClanekSekce title="Prodeje: limit 100 000 Kč a tříletý test">
          <p>
            Prodeje akcií a ETF se nedaní, když platí aspoň jedno ze dvou osvobození.
            Za prvé <strong>hodnotový limit</strong>: úhrn tvých hrubých tržeb z prodejů
            cenných papírů za kalendářní rok nepřesáhne 100 000 Kč — počítá se objem
            prodejů, ne zisk, a sčítá se přes všechny brokery dohromady (podrobně
            v článku{' '}
            <ClanekOdkaz href="/pruvodce/limit-100-000-kc">
              Limit 100 000 Kč: počítá se objem prodejů, ne zisk
            </ClanekOdkaz>
            ). Za druhé <strong>časový test</strong>: kusy držené déle než 3 roky jsou
            osvobozené bez ohledu na částku. Za den nabytí se přitom zpravidla bere den
            vypořádání obchodu (u amerických akcií T+1 po zadání pokynu) — datum svého
            osvobození si spočítáš v{' '}
            <ClanekOdkaz href="/casovy-test">kalkulačce časového testu</ClanekOdkaz>.
          </p>
          <p>
            Co neprojde ani jedním osvobozením, patří do přiznání jako ostatní příjem:
            daní se rozdíl mezi prodejní cenou a nabývací cenou včetně poplatků, zisky
            a ztráty z prodejů se v rámci roku vzájemně započtou.
          </p>
          <SpornyVyklad>
            <p>
              Trading 212 umožňuje kupovat zlomky akcií. U zlomkových akcií není právně
              vyjasněné, zda jde vždy o cenný papír — Danero s nimi jako s cennými papíry
              počítá (běžný přístup) a v reportu je pro průkaznost označí.
            </p>
          </SpornyVyklad>
        </ClanekSekce>

        <ClanekSekce title="Dividendy: do přiznání jde hrubá částka">
          <p>
            Dividendy zahraničních firem se v přiznání uvádějí <strong>brutto</strong> —
            v částce před daní sraženou v zahraničí, přepočtené na koruny. Sraženou daň si
            pak můžeš započíst na českou daň, po jednotlivých státech a nejvýš do sazby
            podle mezinárodní smlouvy.
          </p>
          <p>
            U amerických akcií rozhoduje W-8BEN — formulář, kterým brokerovi potvrzuješ,
            že nejsi americký daňový rezident. S ním USA srazí smluvních 15 %, bez něj
            30 % — na českou daň ale jde započíst nejvýš 15 %, zbytek si od české daně
            neodečteš (někdy ho lze žádat zpět přímo v zemi zdroje, jednoduchá cesta to
            není). Jestli máš W-8BEN vyřízený, pozná Danero přímo z výše srážek — na nic
            se tě ptát nemusí.
          </p>
          <Priklad title="Americká dividenda 100 USD">
            <p>
              S podepsaným W-8BEN ti na účet přijde 85 USD. Do přiznání ale patří celých
              100 USD přepočtených na koruny; sražených 15 USD si započteš na českou daň.
              Bez W-8BEN přijde jen 70 USD — a započíst jde pořád nejvýš 15 USD.
            </p>
          </Priklad>
          <p>
            České dividendy jsou jednodušší: 15% daň srazí plátce a tím je vyřízeno — do
            přiznání se neuvádějí a žádné limity neplní.
          </p>
        </ClanekSekce>

        <ClanekSekce title="Úroky z hotovosti: položka, na kterou se zapomíná">
          <p>
            Trading 212 nabízí úročení nezainvestované hotovosti. Každý připsaný úrok je
            <strong> zdanitelný příjem z kapitálového majetku</strong> — daní se hrubý, bez
            výdajů, a žádné osvobození typu limitu 100 000 Kč pro něj neexistuje. Úroky
            navíc vstupují do limitu 50 000 Kč pro OSVČ v paušálním režimu i do limitu
            20 000 Kč vedlejších příjmů zaměstnance — spolu se zahraničními dividendami je
            tak umí naplnit i účet, který celý rok nic neprodal. Kolik ti do limitu zbývá,
            ukáže orientačně <ClanekOdkaz href="/pausalmetr">Paušálmetr</ClanekOdkaz>.
          </p>
          <Priklad title="Úroky za rok">
            <p>
              Kdo drží průměrně 5 000 EUR volné hotovosti při úroku 2 % ročně, dostane za
              rok zhruba 100 EUR — asi 2 500 Kč zdanitelného příjmu. Samo o sobě málo,
              ale do limitu 50 000 Kč se počítá každá koruna a s dividendami se to sčítá.
            </p>
          </Priklad>
        </ClanekSekce>

        <ClanekSekce title="Jak s tím pomůže Danero">
          <p>
            Danero se na Trading 212 napojí živě přes API klíč jen pro čtení (nebo mu
            nahraješ CSV exporty). Každý obchod, dividendu i úrok převede do jednoho
            formátu, přepočítá správnými kurzy a průběžně ukazuje čerpání limitů, datum
            osvobození u každého nákupu a stav dividend včetně srážek. Když se některý
            limit blíží, přijde e-mail — a když je potřeba přiznání, podklady vzniknou ze
            stejných dat. Seznam všech podporovaných platforem najdeš na stránce{' '}
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
              href: '/pruvodce/pausalni-rezim-a-investice',
              title: 'OSVČ v paušálu: jak ti investice můžou vrátit přiznání',
            },
            { href: '/casovy-test', title: 'Kalkulačka časového testu' },
          ]}
        />
      </ClanekTelo>

      <MarketingCta
        title="Napoj Trading 212 a měj daně pod dohledem"
        lede="API klíč jen pro čtení vygeneruješ za minutu. Danero pak průběžně počítá limit 100 000 Kč, časové testy, dividendy i úroky — a ozve se, když se něco blíží."
        primary="registrace"
      />
    </MarketingPage>
  );
}
