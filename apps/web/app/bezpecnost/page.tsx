import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingCta, MarketingPage, PageHero } from '@/components/marketing-page';

export const metadata: Metadata = {
  title: 'Bezpečnost — Danero',
  description:
    'Jak Danero chrání tvoje data: API klíče jen pro čtení šifrované AES-256-GCM, volitelné dvoufaktorové přihlášení, data v EU, žádné trackery třetích stran, export a smazání dat kdykoli.',
};

/** Jedna zásada: nadpis + věcné vysvětlení bez marketingu. */
const ZASADY: { title: string; body: React.ReactNode }[] = [
  {
    title: 'API klíče jen pro čtení',
    body: (
      <>
        K brokerovi se připojujeme výhradně klíčem, který umí data číst — nikdy
        obchodovat, převádět peníze ani měnit nastavení účtu. U každého napojení
        máme návod, která práva při vytváření klíče zaškrtnout (a která ne).
        Hesla od brokera po tobě nikdy nechceme.
      </>
    ),
  },
  {
    title: 'Klíče šifrujeme, nikdy je neukazujeme',
    body: (
      <>
        Uložený API klíč šifrujeme algoritmem AES-256-GCM a dešifruje se jen
        v okamžiku synchronizace. Do exportů dat, e-mailů ani logů se klíče
        nikdy nedostanou — ani v zašifrované podobě.
      </>
    ),
  },
  {
    title: 'Minimum osobních údajů',
    body: (
      <>
        K účtu stačí e-mail. Nepotřebujeme jméno, rodné číslo ani adresu —
        počítáme daně, ne identitu. Co přesně zpracováváme a proč, popisuje{' '}
        <Link
          href="/soukromi"
          className="font-medium text-ruzova-text underline underline-offset-2"
        >
          ochrana soukromí
        </Link>
        .
      </>
    ),
  },
  {
    title: 'Přihlášení pod tvou kontrolou',
    body: (
      <>
        Volitelné dvoufaktorové ověření (TOTP aplikace), přehled přihlášených
        zařízení s možností všechna ostatní odhlásit jedním tlačítkem a záznam
        poslední aktivity účtu — všechno v Nastavení.
      </>
    ),
  },
  {
    title: 'Tvoje data zůstávají tvoje',
    body: (
      <>
        Kdykoli si stáhneš kompletní export (JSON se všemi transakcemi a
        nastavením) a kdykoli můžeš účet nevratně smazat — včetně všech dat,
        šifrovaných klíčů a historie. Bez e-mailů „opravdu odcházíte?“.
      </>
    ),
  },
  {
    title: 'Data v EU, žádné trackery',
    body: (
      <>
        Aplikace běží na infrastruktuře v Evropské unii. Web nenačítá žádné
        skripty třetích stran — žádná reklamní síť, žádný sledovací pixel,
        žádné cizí fonty. Co vidíš, servírujeme sami.
      </>
    ),
  },
  {
    title: 'Oddělené účty od základu',
    body: (
      <>
        Každý dotaz do databáze je vázaný na tvůj účet — data různých uživatelů
        se nikdy nepotkají v jednom výpočtu ani výpisu. Výpočty navíc jedou
        v odděleném enginu, který vidí jen transakce, ne účet.
      </>
    ),
  },
  {
    title: 'Zamčený prohlížeč',
    body: (
      <>
        Web posílá přísné bezpečnostní hlavičky (Content Security Policy,
        HSTS, zákaz vkládání do cizích stránek) a citlivé operace chrání
        omezení počtu pokusů (rate limit) proti skriptovanému zneužití.
      </>
    ),
  },
];

export default function BezpecnostPage() {
  return (
    <MarketingPage>
      <PageHero
        eyebrow="Bezpečnost"
        title="Svěřuješ nám čísla o svém majetku. Bereme to vážně."
        lede="Tady je bez marketingu popsané, jak s tvými daty zacházíme — od API klíčů po smazání účtu."
      />

      <section aria-label="Bezpečnostní zásady" className="mt-12">
        <div className="grid gap-4 sm:grid-cols-2">
          {ZASADY.map((zasada) => (
            <div key={zasada.title} className="rounded-lg border border-linka bg-plocha p-6">
              <h2 className="font-display text-lg font-semibold">{zasada.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-inkoust-tlumeny">{zasada.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Nahlášení zranitelnosti" className="mt-16">
        <div className="max-w-3xl rounded-lg border border-linka bg-plocha p-6">
          <p className="font-mono text-xs font-semibold uppercase tracking-wide text-inkoust-tlumeny">
            Našel jsi zranitelnost?
          </p>
          <p className="mt-2 text-sm leading-relaxed text-inkoust-tlumeny">
            Napiš prosím rovnou na{' '}
            <a
              href="mailto:dunder.jan@gmail.com"
              className="font-medium text-ruzova-text underline underline-offset-2"
            >
              dunder.jan@gmail.com
            </a>{' '}
            — odpovídá autor osobně, zpravidla do 24 hodin. Nahlášené chyby
            opravujeme přednostně a nálezce rádi (se souhlasem) uvedeme.
          </p>
        </div>
      </section>

      <MarketingCta
        title="Přesvědč se sám — bez rizika"
        lede="Demo běží nad vymyšlenými daty a nic po tobě nechce. Účet pak stačí e-mail — a broker jen klíč pro čtení."
      />
    </MarketingPage>
  );
}
