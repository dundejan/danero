import type { Metadata } from 'next';
import { MarketingCta, MarketingPage, PageHero } from '@/components/marketing-page';
import {
  ClanekOdkaz,
  ClanekPata,
  ClanekSekce,
  ClanekSeznam,
  ClanekTelo,
  ClanekUvod,
  Priklad,
} from '@/components/pruvodce-clanek';

export const metadata: Metadata = {
  title: 'OSVČ v paušálu a investice: limit 50 000 Kč — Danero',
  description:
    'Paušální daň snese nejvýš 50 000 Kč zdanitelných příjmů mimo podnikání — a investice do limitu počítají hrubé částky: zahraniční dividendy před srážkou, tržby z neosvobozených prodejů i úroky. Co znamená prolomení a termín 10. ledna.',
};

export default function PausalniRezimAInvesticePage() {
  return (
    <MarketingPage>
      <PageHero
        eyebrow="Průvodce"
        title="OSVČ v paušálu: jak ti investice můžou vrátit přiznání"
        lede="Paušální režim tě zbavil přiznání i přehledů. Investice ti je můžou vrátit — limit je 50 000 Kč ročně a počítá se z hrubých částek. Co do něj patří, co ne a co se při prolomení opravdu stane."
      />

      <ClanekTelo>
        <ClanekUvod>
          <strong>
            Aby tvoje daň zůstala rovna paušální dani, smějí tvoje zdanitelné příjmy mimo
            podnikání — z kapitálu, z nájmu a ostatní — činit v úhrnu nejvýš 50 000 Kč za
            rok. Počítají se hrubé částky: zahraniční dividendy před srážkou, tržby (ne
            zisk!) z neosvobozených prodejů i úroky od brokera.
          </strong>{' '}
          Prolomení přitom není konec světa ani konec paušálu: za daný rok podáš přiznání
          a přehledy, v paušálním režimu ale zůstáváš.
        </ClanekUvod>

        <ClanekSekce title="Proč se to týká zrovna investorů">
          <p>
            Paušální daň znamená jednu platbu měsíčně a žádné přiznání ani přehledy pro
            ČSSZ a zdravotní pojišťovnu — dokud plníš podmínky. Jednou z nich je, že vedle
            příjmů z podnikání máš nejvýš 50 000 Kč zdanitelných příjmů z kapitálového
            majetku, z nájmu a ostatních příjmů dohromady. A právě tuhle podmínku plní
            investoři nejsnáz: stačí pár zahraničních dividend a úroků — úplně bez
            prodávání. Limit se navíc počítá z hrubých příjmů, takže nepomůže ani to, že
            jsi na obchodu skoro nic nevydělal.
          </p>
        </ClanekSekce>

        <ClanekSekce title="Co se do 50 000 Kč počítá">
          <ClanekSeznam>
            <li>
              <strong>Zahraniční dividendy v hrubé výši</strong> — před daní sraženou
              v zahraničí, přepočtené na koruny. To, co ti přistálo na účtu, je míň, než
              co se počítá do limitu.
            </li>
            <li>
              <strong>Hrubé tržby z neosvobozených prodejů</strong> cenných papírů
              i krypta — celá prodejní částka, ne zisk.
            </li>
            <li>
              <strong>Zdanitelné úroky</strong> — třeba úrok z nezainvestované hotovosti,
              který platí Trading 212, XTB a další brokeři.
            </li>
            <li>
              <strong>Kladné výsledky derivátových obchodů</strong> (CFD, opce, futures)
              — hrubá kladná plnění, ne čistý zisk po odečtení ztrát.
            </li>
            <li>
              <strong>Příjmy z nájmu</strong> a další ostatní příjmy — investice nejsou
              jediné, co limit plní.
            </li>
          </ClanekSeznam>
          <Priklad title="Prodej, který limit prolomí i s minimálním ziskem">
            <p>
              Prodáš akcie za 120 000 Kč držené dva roky se ziskem 5 000 Kč. Prodej není
              osvobozený (tržby nad 100 000 Kč, test nesplněn) — a do limitu 50 000 Kč
              nevstupuje zisk 5 000 Kč, ale celých 120 000 Kč. Prolomeno jedním obchodem.
            </p>
          </Priklad>
          <Priklad title="Limit prolomený bez jediného prodeje">
            <p>
              Dividendy z amerických akcií v úhrnu 2 300 USD brutto za rok jsou zhruba
              50 000 Kč — portfolio, které celý rok jen tiše vyplácí dividendy, může limit
              naplnit samo. Počítá se hrubá částka před 15% americkou srážkou.
            </p>
          </Priklad>
        </ClanekSekce>

        <ClanekSekce title="Co se nepočítá">
          <ClanekSeznam>
            <li>
              <strong>Osvobozené prodeje</strong> — kusy držené přes 3 roky (časový
              test) a roky, kdy
              tržby z prodejů cenných papírů nepřesáhly 100 000 Kč (
              <ClanekOdkaz href="/pruvodce/limit-100-000-kc">
                jak limit funguje
              </ClanekOdkaz>
              ; krypto má vlastní stovku). Objem osvobozených příjmů není omezen — po
              třech letech můžeš prodat klidně za milion a paušál to nezasáhne.
            </li>
            <li>
              <strong>České dividendy a úroky z českých bank</strong> — 15% daň srazil
              plátce a tím jsou vyřízené, limit neplní.
            </li>
          </ClanekSeznam>
          <p>
            Rozdíl mezi „osvobozeným" a „neosvobozeným" prodejem tak pro OSVČ v paušálu
            rozhoduje o celém papírování za rok — proto se vyplatí hlídat limity 100 000
            a 50 000 Kč společně.
          </p>
        </ClanekSekce>

        <ClanekSekce title="Co se při prolomení opravdu stane">
          <p>
            Překročíš-li 50 000 Kč, tvoje daň za ten rok <strong>není rovna paušální
            dani</strong>. Znamená to: podáváš daňové přiznání (včetně příjmů z podnikání,
            standardně), přehledy pro ČSSZ a zdravotní pojišťovnu, a daň i pojistné se
            dopočítají běžným způsobem — zaplacené paušální zálohy se započtou. Přesně to
            papírování, kvůli kterému sis paušál platil.
          </p>
          <p>
            Co se <strong>nestane</strong>: z paušálního režimu nevypadáváš. V režimu
            zůstáváš, dál platíš zálohy a od dalšího roku — při dodržení limitu — zase
            jedeš bez přiznání. Termín k zapamatování: <strong>do 10. ledna</strong> se
            finančnímu úřadu oznamuje vstup do paušálního režimu nebo jeho změna
            (připadne-li na víkend, platí nejbližší pracovní den). Leden je tedy moment,
            kdy se stav za loňský rok hodí znát přesně.
          </p>
        </ClanekSekce>

        <ClanekSekce title="Jak to hlídá Danero">
          <p>
            Orientační odpověď dá zdarma a bez registrace{' '}
            <ClanekOdkaz href="/kalkulacka">kalkulačka „Musím podat přiznání?"</ClanekOdkaz>.
            V aplikaci pak běží průběžný součet nad skutečnou historií účtů: každá dividenda přepočtená
            kurzem podle zvolené soustavy (jednotný kurz běžného roku je do lednového
            vyhlášení orientační — aplikace to viditelně označuje), osvobozené prodeje
            vyřazené, úroky započtené — a e-mail při 60, 85 a 100 % limitu. Prodej si
            nasimuluješ předem a uvidíš jeho dopad na limit 50 000 Kč ještě dřív, než ho
            zadáš brokerovi. Podporované platformy najdeš na stránce{' '}
            <ClanekOdkaz href="/platformy">Platformy</ClanekOdkaz>.
          </p>
        </ClanekSekce>

        <ClanekPata
          dalsi={[
            {
              href: '/pruvodce/limit-100-000-kc',
              title: 'Limit 100 000 Kč: počítá se objem prodejů, ne zisk',
            },
            { href: '/jak-pocitame', title: 'Jak počítáme — celá metodika s paragrafy' },
            { href: '/kalkulacka', title: 'Kalkulačka: Musím podat přiznání?' },
          ]}
        />
      </ClanekTelo>

      <MarketingCta
        title="Paušál se hlídá celý rok, ne až v lednu"
        lede="Napoj brokera nebo nahraj výpis. Danero dividendy přepočítá, osvobozené prodeje vyřadí a při 60, 85 a 100 % limitu ti napíše."
        primary="registrace"
      />
    </MarketingPage>
  );
}
