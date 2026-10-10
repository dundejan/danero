import type { Metadata } from 'next';
import { SpecList, SpecRow } from '@/components/marketing-blocks';
import { MarketingCta, MarketingPage, PageHero } from '@/components/marketing-page';
import { TextLink } from '@/components/ui/link';
import { OPERATOR } from '@/lib/contact';
import { SOURCE_URL } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Bezpečnost — Danero',
  description:
    'Jak Danero chrání tvoje data: API klíče jen pro čtení šifrované AES-256-GCM, volitelné dvoufaktorové přihlášení, data v EU, žádné trackery třetích stran, export a smazání dat kdykoli.',
};

interface Fact {
  term: string;
  detail: React.ReactNode;
}

/**
 * Stránka je list faktů, ne sada dlaždic: čtyři otázky, které si člověk klade
 * („co smíte u brokera“, „co o mně máte“, „co s tím můžu dělat“, „jak si to
 * ověřím“), a pod každou řádky pojem → co přesně se děje. Žádná věta, která
 * jen uklidňuje — každý řádek jde ověřit v kódu nebo v Nastavení.
 */
const SECTIONS: { title: string; facts: Fact[] }[] = [
  {
    title: 'Přístup k brokerovi',
    facts: [
      {
        term: 'API klíče jen pro čtení',
        detail: (
          <>
            Čteme historii obchodů a stav pozic. Zadat obchodní příkaz, převést peníze ani změnit
            nastavení účtu Danero neumí — takový kód v něm není. Rozsah klíče nastavuješ u brokera
            ty; u každého napojení je návod, která práva zaškrtnout.
          </>
        ),
      },
      {
        term: 'Heslo k brokerovi',
        detail: 'Nikdy ho nechceme.',
      },
      {
        term: 'Šifrování klíčů',
        detail: (
          <>
            Uložený klíč je šifrovaný algoritmem AES-256-GCM a dešifruje se jen v okamžiku
            synchronizace. Do exportů dat, e-mailů ani logů se nedostane — ani v zašifrované podobě.
          </>
        ),
      },
    ],
  },
  {
    title: 'Co ukládáme a kde',
    facts: [
      {
        term: 'Osobní údaje',
        detail: (
          <>
            K účtu stačí e-mail. Jméno, rodné číslo ani adresu nepotřebujeme. Co přesně zpracováváme
            a proč, popisuje <TextLink href="/soukromi">ochrana soukromí</TextLink>.
          </>
        ),
      },
      {
        term: 'Umístění dat',
        detail: 'Aplikace běží na infrastruktuře v Evropské unii.',
      },
      {
        term: 'Skripty třetích stran',
        detail: 'Žádné. Web nenačítá reklamní síť, sledovací pixel ani cizí fonty.',
      },
      {
        term: 'Oddělení účtů',
        detail: (
          <>
            Každý dotaz do databáze je vázaný na tvůj účet — data různých uživatelů se nepotkají v
            jednom výpočtu ani výpisu. Výpočty běží v odděleném enginu, který vidí jen transakce, ne
            účet.
          </>
        ),
      },
    ],
  },
  {
    title: 'Co máš pod kontrolou',
    facts: [
      {
        term: 'Dvoufaktorové ověření',
        detail: 'Volitelné, kódem z aplikace (TOTP). Zapneš ho v Nastavení.',
      },
      {
        term: 'Přihlášená zařízení',
        detail:
          'V Nastavení vidíš přihlášená zařízení i poslední aktivitu účtu a všechna ostatní zařízení odhlásíš jedním tlačítkem.',
      },
      {
        term: 'Export dat',
        detail: 'Kdykoli si stáhneš JSON se všemi transakcemi a nastavením.',
      },
      {
        term: 'Smazání účtu',
        detail: 'Kdykoli a nevratně — včetně všech dat, šifrovaných klíčů a historie.',
      },
    ],
  },
  {
    title: 'Jak si to ověřit',
    facts: [
      {
        term: 'Nemusíš nám věřit — můžeš si to přečíst',
        detail: (
          <>
            Celý zdrojový kód Danera je veřejný na{' '}
            <TextLink href={SOURCE_URL} external>
              GitHubu
            </TextLink>{' '}
            pod licencí AGPL-3.0 — včetně toho, jak nakládáme s klíči a hesly.
          </>
        ),
      },
      {
        term: 'Hlavičky prohlížeče',
        detail: (
          <>
            Web posílá Content Security Policy, HSTS a zákaz vkládání do cizích stránek. Prohlížeč
            nesmí načíst skript, styl, font ani obrázek odjinud než z Danera; vlastní skripty, které
            Next.js potřebuje ke svému běhu přímo ve stránce, povolené jsou.
          </>
        ),
      },
      {
        term: 'Omezení počtu pokusů',
        detail: 'Citlivé operace chrání rate limit proti skriptovanému zneužití.',
      },
      {
        term: 'Nahlášení zranitelnosti',
        detail: (
          <>
            Napiš na <TextLink href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</TextLink> —
            soukromě podle{' '}
            <TextLink href={`${SOURCE_URL}/blob/main/SECURITY.md`} external>
              SECURITY.md
            </TextLink>
            , ne do veřejného issue. Odpovídá autor osobně: přijetí potvrdí do 72 hodin, v sezóně
            daňových přiznání (únor–duben) to může trvat déle. Nahlášené chyby opravujeme přednostně
            a nálezce rádi (se souhlasem) uvedeme.
          </>
        ),
      },
    ],
  },
];

export default function BezpecnostPage() {
  return (
    <MarketingPage>
      {/* bez perexu: nadpisy oddílů říkají totéž a jsou hned pod titulkem */}
      <PageHero eyebrow="Bezpečnost" title="Co se děje s tvými daty" />

      {/* list se specifikacemi: pojem vlevo, co k němu platí, vpravo — stejný
          jako „Co všechno dostaneš“ na /cenik */}
      {SECTIONS.map((section, index) => (
        <section
          key={section.title}
          aria-labelledby={`oddil-${index}`}
          className="mt-14 md:mt-20"
        >
          <h2 id={`oddil-${index}`} className="type-title-1 text-balance">
            {section.title}
          </h2>
          <SpecList className="mt-8">
            {section.facts.map((fact) => (
              <SpecRow key={fact.term} label={fact.term}>
                {fact.detail}
              </SpecRow>
            ))}
          </SpecList>
        </section>
      ))}

      <MarketingCta
        title="Vyzkoušej to na vymyšlených datech"
        lede="Demo po tobě nic nechce. K účtu pak stačí e-mail a u brokera klíč jen pro čtení."
      />
    </MarketingPage>
  );
}
