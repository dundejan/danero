import type { Metadata } from 'next';
import { MarketingPage, PageClosing, PageHero } from '@/components/marketing-page';
import {
  ArticleBody,
  ArticleFooter,
  ArticleIntro,
  ArticleLink,
  ArticleSection,
  ArticleUpdated,
  Example,
} from '@/components/guide-article';
import type { ContentsItem } from '@/components/long-read';
import { ARTICLES } from '@/lib/articles';
import { czk, pct, qty } from '@/lib/format';
import {
  CURRENT_FILING_YEAR,
  filingLimits,
  nlTreatyCap,
  progressiveThreshold,
  US_RATE_WITHOUT_W8BEN,
  usDividendExample,
} from '@/lib/guide-examples';

const PATH = '/pruvodce/dividendy-ze-zahranici';

export const metadata: Metadata = {
  title: 'Dividendy ze zahraničí a z USA v přiznání — Danero',
  description:
    'Zahraniční dividenda jde do přiznání v hrubé výši, před srážkou. Sraženou daň započteš jen do sazby ze smlouvy: USA 15 %, Nizozemsko 10 %. Co dělá formulář W-8BEN, příklad s čísly a co platí pro OSVČ v paušálu.',
};

const CONTENTS: ContentsItem[] = [
  { id: 'brutto', title: 'Do přiznání jde brutto' },
  { id: 'zapocet', title: 'Zápočet sražené daně' },
  { id: 'w8ben', title: 'Bez formuláře W-8BEN' },
  { id: 'jine-staty', title: 'Jiné státy, jiný strop' },
  { id: 'ceske-dividendy', title: 'České dividendy' },
  { id: 'pausal', title: 'OSVČ v paušálu' },
  { id: 'samostatny-zaklad', title: 'Samostatný základ 15 %' },
  { id: 'limity', title: 'Dividendy a limity' },
];

/** „15 %“ z desetinného podílu (`0.15`). */
const percent = (fraction: { toNumber(): number }): string => pct(fraction.toNumber() * 100);

/**
 * Článek průvodce B z plánu propagace (40, kap. 3): zahraniční dividendy
 * v přiznání. Pravidla R-07a, R-07b, R-07c, R-07d, R-07i, R-06 a R-08b
 * (§ 7a odst. 5) z docs/02. Čísla příkladu počítá `lib/guide-examples.ts`
 * z ověřeného jednotného kurzu a ze smluvních stropů enginu; že engine
 * nad stejnou dividendou dojde k témuž zápočtu, hlídá test.
 */
export default function DividendyZeZahraniciPage() {
  const us = usDividendExample();
  const nlCap = nlTreatyCap();
  const threshold = progressiveThreshold(CURRENT_FILING_YEAR);
  const limits = filingLimits(CURRENT_FILING_YEAR);

  return (
    <MarketingPage>
      <PageHero eyebrow="Průvodce" title={ARTICLES[PATH].headline} />
      <ArticleUpdated path={PATH} />

      <ArticleBody contents={CONTENTS}>
        <ArticleIntro>
          <strong>
            Když kvůli investicím podáváš přiznání, patří do něj zahraniční dividenda v hrubé
            výši, tedy před daní sraženou v zahraničí. Sraženou daň si pak započteš proti české
            dani, ale jen do sazby ze smlouvy o zamezení dvojího zdanění: u USA{' '}
            {percent(us.treatyCap)}.
          </strong>{' '}
          Co se srazilo navíc, v Česku propadá. Jestli přiznání vůbec podáváš, rozhodují{' '}
          <ArticleLink href="/pruvodce/kdy-podat-priznani">limity</ArticleLink>.
        </ArticleIntro>

        <ArticleSection id="brutto" title="Do přiznání jde částka před srážkou">
          <p>
            Firma vyplatí dividendu, stát, kde sídlí, z ní rovnou srazí daň a na účet ti
            přijde zbytek. Česká daň se ale počítá z <strong>částky, kterou firma vyplatila
            před srážkou</strong> (brutto), ne z toho, co ti přišlo. Výdaje se od dividend neodečítají.
          </p>
          <p>
            Pozor na výpisy, které ukazují čistou částku. Třeba u Trading 212 je „Price /
            share“ u dividendy už po srážce a hrubá částka je teprve součet výplaty a sražené
            daně („Withholding tax“).
          </p>
          <p>
            Na koruny se dividenda přepočítá jednotným kurzem za celý rok, nebo denními kurzy
            ČNB. V jednom roce se soustavy nesmí míchat (
            <ArticleLink href="/jak-pocitame#kurzy">jak se volí kurz</ArticleLink>).
          </p>
        </ArticleSection>

        <ArticleSection id="zapocet" title="Zápočet: sraženou daň odečteš, ale jen do stropu">
          <p>
            Aby se jedna dividenda nedanila dvakrát, odečteš daň sraženou v zahraničí od české
            daně. Zápočet má dvě meze: <strong>nejvýš tolik, kolik dovoluje sazba ze
            smlouvy</strong> se státem, odkud dividenda přišla, a nejvýš tolik, kolik česká
            daň z příjmů z toho státu dělá.
            Počítá se po jednotlivých státech, v přiznání v příloze č. 3.
          </p>
          <Example title={`Americká dividenda ${qty(us.grossUsd)} USD s formulářem W-8BEN`}>
            <p>
              Jednotným kurzem za rok {us.year} ({qty(us.rateUsd)} Kč za dolar) je to{' '}
              <strong>{czk(us.grossCzk)} příjmu</strong> do přiznání. USA srazily{' '}
              {percent(us.treatyCap)}, tedy {qty(us.withW8ben.withheldUsd)} USD ={' '}
              {czk(us.withW8ben.withheldCzk)}.
            </p>
            <p>
              Strop ze smlouvy je taky {percent(us.treatyCap)}, takže smlouva dovolí započíst
              celých <strong>{czk(us.withW8ben.creditableCzk)}</strong>. Česká daň z dividendy
              při sazbě 15 % vyjde zhruba stejně, takže z ní v Česku nedoplácíš nic, nebo jen
              pár korun.
            </p>
          </Example>
        </ArticleSection>

        <ArticleSection id="w8ben" title="Bez formuláře W-8BEN ztrácíš polovinu srážky">
          <p>
            Formulářem W-8BEN potvrzuješ brokerovi, že nejsi americký daňový rezident. S ním
            USA srážejí {percent(us.treatyCap)}, bez něj {percent(US_RATE_WITHOUT_W8BEN)}.
            Smluvní strop se tím ale nemění.
          </p>
          <Example title={`Tatáž dividenda bez W-8BEN`}>
            <p>
              Sraženo {qty(us.withoutW8ben.withheldUsd)} USD = {czk(us.withoutW8ben.withheldCzk)}.
              Započíst jde pořád jen <strong>{czk(us.withoutW8ben.creditableCzk)}</strong>.
              Zbylých <strong>{czk(us.withoutW8ben.lostCzk)}</strong> v Česku propadá. Vrátit
              si je jde nanejvýš žádostí přímo v USA.
            </p>
          </Example>
          <p>
            Danero se na formulář neptá. Pozná ho z výše srážek ve tvých datech, a když je
            srážka vyšší než strop, upozorní tě.
          </p>
        </ArticleSection>

        <ArticleSection id="jine-staty" title="Každý stát má vlastní strop">
          <p>
            Stropy jsou ve smlouvách o zamezení dvojího zdanění a liší se. USA, Německo,
            Japonsko a Irsko mají {percent(us.treatyCap)}, <strong>Nizozemsko jen{' '}
            {percent(nlCap)}</strong>. Když ti nizozemská firma srazí 15 %, započteš jen{' '}
            {percent(nlCap)}. Zbytek v Česku propadá a vrátit si ho jde nanejvýš žádostí
            v Nizozemsku.
          </p>
          <p>
            U států, jejichž smlouvu jsme zatím neověřili, počítá Danero se stropem 15 %
            a řekne ti to. Skutečný strop může být nižší.
          </p>
        </ArticleSection>

        <ArticleSection id="ceske-dividendy" title="České dividendy do přiznání nepatří">
          <p>
            Z dividend českých firem srazí 15% daň už ten, kdo je vyplácí, a tím je vyřízená.
            Do přiznání se neuvádějí a do žádného limitu se nepočítají.
          </p>
        </ArticleSection>

        <ArticleSection id="pausal" title="OSVČ v paušálu pod limitem: zápočet neuplatňuješ">
          <p>
            <strong>
              Jsi v paušálním režimu a limit 50 000 Kč jsi nepřekročil? Pak si sraženou daň
              ze zahraničí v Česku nezapočteš, a je to tak v pořádku.
            </strong>{' '}
            Tvoje daň je rovna paušální dani, z dividend tu žádnou daň neplatíš, takže není
            proti čemu srážku započítat.
          </p>
          <p>
            Kdybys zápočet v přiznání uplatnil, přestala by ti daň být rovna paušální dani za
            celý rok a čekalo by tě přiznání, přehledy pro ČSSZ i zdravotní pojišťovnu
            a doplatek pojistného. V paušálním režimu bys přitom zůstal. Srážka nad smluvní
            strop se žádá zpět ve státě, kde se srazila. Kdo limit překročil, přiznání podává
            tak jako tak a zápočet uplatní běžně, do smluvního stropu. Víc v článku{' '}
            <ArticleLink href="/pruvodce/pausalni-rezim-a-investice">
              OSVČ v paušálu a investice
            </ArticleLink>
            .
          </p>
        </ArticleSection>

        <ArticleSection id="samostatny-zaklad" title="Samostatný základ 15 %: jen pro vysoké příjmy">
          <p>
            Zahraniční dividendy a úroky jde v přiznání dát do samostatného základu se sazbou
            15 % (§ 16a). Smysl to má jen tehdy, když by tě jinak zasáhla sazba 23 %
            {threshold ? (
              <>
                {' '}
                — za rok {CURRENT_FILING_YEAR} u základu daně nad {czk(threshold)}
              </>
            ) : null}
            .
          </p>
          <p>
            Má to háček: slevu na poplatníka lze uplatnit jen proti dani z ostatních příjmů
            (mzda, podnikání, prodeje), ne proti dani ze samostatného základu. Kdo kromě
            dividend a úroků jiné příjmy nemá, může o slevu přijít, a samostatný základ ho pak
            vyjde dráž. Danero spočítá obě varianty a ztrátu slevy vyčíslí.
          </p>
        </ArticleSection>

        <ArticleSection id="limity" title="Dividendy a limity pro přiznání">
          <p>
            Do limitů pro podání přiznání se zahraniční dividendy počítají taky brutto.
            Zaměstnanec za rok {CURRENT_FILING_YEAR} podává přiznání, když příjmy mimo
            zaměstnání přesáhnou {czk(limits.employee)}, paušalista hlídá{' '}
            {czk(limits.flatTax)}. Kdo limit nepřesáhne a jiný důvod k přiznání nemá, dividendu
            do přiznání nedává, českou daň z ní neplatí a srážka v zahraničí zůstane, jak je.
            Celý přehled je v článku{' '}
            <ArticleLink href="/pruvodce/kdy-podat-priznani">
              Kdy kvůli investicím podáváš přiznání
            </ArticleLink>
            .
          </p>
          <p>
            Danero z výpisů dopočítá hrubé částky, srážky rozdělí po státech, zápočet omezí
            stropy ze smluv a připraví podklad pro přílohu č. 3. Které platformy umíme načíst,
            najdeš na stránce <ArticleLink href="/platformy">Platformy</ArticleLink>.
          </p>
        </ArticleSection>

        <ArticleFooter
          next={[
            {
              href: '/pruvodce/kdy-podat-priznani',
              title: ARTICLES['/pruvodce/kdy-podat-priznani'].headline,
            },
            { href: '/jak-pocitame#dividendy', title: 'Jak počítáme dividendy a úroky' },
            { href: '/kalkulacka', title: 'Kalkulačka: Musím podat přiznání?' },
          ]}
        />
      </ArticleBody>

      <PageClosing />
    </MarketingPage>
  );
}
