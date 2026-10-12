import type { Metadata } from 'next';
import { toDataURL } from 'qrcode';
import { SpecList, SpecRow, Split } from '@/components/marketing-blocks';
import { MarketingPage, PageClosing, PageHero } from '@/components/marketing-page';
import { typeset } from '@/components/typeset';
import { buttonVariants } from '@/components/ui/button';
import { Chevron } from '@/components/ui/disclosure';
import { InfoPopover } from '@/components/ui/info-popover';
import { TextLink } from '@/components/ui/link';
import { EPO_SUPPORTED_YEARS } from '@/lib/epo';
import { yearList } from '@/lib/format';
import { SOURCE_URL } from '@/lib/legal';
import { supportAvailable, supportFromEnv, type SupportOptions } from '@/lib/support';
import { tidy } from '@/lib/typography';

/**
 * Stránka se renderuje při každém požadavku, ne při buildu.
 *
 * Údaje o dobrovolném příspěvku jdou z prostředí (`lib/support.ts`) a citlivé
 * proměnné při `next build` ve Vercelu k dispozici NEJSOU — staticky
 * předrenderovaná stránka by si zapekla „žádný příspěvek“ bez ohledu na to, co
 * je nastavené. Stejnou past měl dřív ceník s klíčem Stripu (nález C-3-06).
 */
export const dynamic = 'force-dynamic';

// Adresa `/cenik` zůstává (vedou na ni staré odkazy a přesměrování zaniklých
// tarifů), ale ceník bez cen by byl prázdné slovo: stránka odpovídá na otázku
// „proč je to zdarma“ a tak se i jmenuje v navigaci.
//
// Stránka má jedno jméno všude: v liště, v titulku dokumentu i v podmínkách
// užití (čl. 3: „Co všechno služba umí, popisuje stránka Proč zdarma“). Do
// 11. 10. 2026 podmínky odkazovaly na „Ceník“ a titulek dokumentu to slovo
// nesl jen kvůli nim. Protože na ni podmínky odkazují, musí tu zůstat výčet
// toho, co Danero umí — viz `WATCHING`, `DATA` a `FILING` níž.
export const metadata: Metadata = {
  title: 'Proč je Danero zdarma',
  description:
    'Danero je zdarma celé: import výpisů, limity a časové testy, podklady k přiznání včetně XML, napojení na brokery i hlídací e-maily. Bez placené verze a bez karty — dělá ho jeden člověk a nic neprodává.',
};

interface Fact {
  text: string;
  link: { href: string; label: string; external?: boolean };
}

/**
 * Proč je Danero zdarma — krátký seznam, jeden řádek = jedna věc a proklik,
 * kde si ji čtenář ověří. Do 10. 10. 2026 tu byly čtyři dvojice titulek +
 * odstavce („Proč se neplatí“, „Kde je háček“…) a stránka měla tři obrazovky;
 * majitel ji chtěl na jednu.
 *
 * Mluví tu autor sám za sebe, proto první osoba. „Osobní projekt“ i „open-source“
 * sem patří (jinde na webu ne — úvod mluví obyčejnými slovy pro každého);
 * u „open-source“ stojí hned vedle, co to znamená pro toho, kdo není vývojář.
 * Fakta jsou jen ta, která dokládá stránka, na kterou řádek vede.
 */
const FACTS: Fact[] = [
  {
    text: 'Je to můj osobní projekt: dělám ho sám a vznikl pro moje vlastní daně.',
    link: { href: '/o-projektu', label: 'O mně' },
  },
  {
    text: 'Je open-source — kód je veřejný a kdokoli se může podívat, jak počítá a co dělá s daty.',
    link: { href: SOURCE_URL, label: 'Zdrojový kód', external: true },
  },
  {
    text: 'Je bez reklam a sledovacích skriptů a data nikomu neprodávám.',
    link: { href: '/soukromi', label: 'Ochrana soukromí' },
  },
  {
    text: 'Klíč k brokerovi je jen pro čtení a ukládá se šifrovaný.',
    link: { href: '/bezpecnost', label: 'Bezpečnost' },
  },
  {
    text: 'Měnit to v plánu není; kdyby se někdy cokoli mělo zpoplatnit, dozvíš se to e-mailem nejméně 30 dní předem a nic ti nezačnu účtovat bez tvojí výslovné objednávky.',
    link: { href: '/podminky', label: 'Podmínky užití' },
  },
];

/**
 * Co Danero umí — JEDEN výčet, protože žádné stupně nejsou. Do 8. 10. 2026 tu
 * byly tři karty (zdarma / podklady / hlídání); jejich obsah je tady celý, jen
 * seřazený podle toho, k čemu slouží.
 *
 * Výčet nesmí zmizet (odkazují na něj podmínky užití), ale stránku nemá
 * natahovat: stojí na jejím konci sbalený a rozbalí se na místě. Sbalený
 * `<details>` je ve stránce celý — hledání i vyhledávače ho vidí.
 *
 * Čte to kdokoli, kdo investuje: žádné zkratky brokerů („IBKR“), vývojářská
 * slova („sync“) ani názvy metod („FIFO/LIFO“). Části aplikace se jmenují
 * stejně jako v ní — Report, Simulátor, Horizont osvobození (hlídá
 * `test/public-pages.test.ts`).
 */
const WATCHING: readonly string[] = [
  'Limity 100 000 Kč i 50 000 Kč průběžně celý rok',
  'Horizont osvobození: kdy je která pozice po třech letech bez daně',
  'E-mailová upozornění na limity a termíny',
  'Simulátor: co s daní udělá prodej, než ho zadáš',
];

const DATA: readonly string[] = [
  'Výpisy z více platforem najednou',
  'Živé napojení na Trading 212, Interactive Brokers a Lynx',
  'Napojený účet se každý den načte a přepočítá sám',
  'Krypto i deriváty jako samostatné druhy příjmů',
];

const FILING: readonly string[] = [
  'Orientační daň z investic',
  'Report: čísla přesně do řádků přiznání',
  'Rozpad na jednotlivé nákupy a použité kurzy',
  'Porovnání metod výpočtu vedle sebe',
];

function FeatureList({ items, children }: { items: readonly string[]; children?: React.ReactNode }) {
  return (
    <ul className="space-y-2 text-ink">
      {items.map((item) => (
        <li key={item}>{typeset(item)}</li>
      ))}
      {children}
    </ul>
  );
}

/** QR platba jako obrázek — vzniká na serveru, stránka nenačítá nic cizího (CSP). */
async function paymentQr(code: string): Promise<string | null> {
  try {
    // úroveň M: QR platbu čtou bankovní aplikace z displeje, ne z pomačkaného
    // papíru — vyšší korekce by jen zahustila kód
    return await toDataURL(code, { margin: 1, width: 224, errorCorrectionLevel: 'M' });
  } catch {
    return null;
  }
}

/**
 * Dobrovolný příspěvek. Vykreslí se jen na instanci, která ho má nastavený
 * (`lib/support.ts`) — cizí vlastní instance tak nesbírá peníze pro někoho,
 * kdo ji neprovozuje. Nic neodemyká a text to říká dřív než cokoli jiného.
 * Stojí hned pod seznamem faktů, ať ho nikdo nemusí hledat.
 */
async function SupportSplit({ support }: { support: SupportOptions }) {
  const qr = support.paymentCode ? await paymentQr(support.paymentCode) : null;
  return (
    <Split title="Příspěvek na provoz" className="mt-12 md:mt-16">
      <p>
        Nemusíš. Příspěvkem si <strong className="font-semibold text-ink">nic neodemkneš</strong>{' '}
        — všechno už máš. Pomůže zaplatit doménu, provoz a čas na další brokery.
      </p>
      <p className="type-footnote">
        Je to dobrovolný příspěvek, ne platba za službu: nevzniká ti jím žádný nárok a nic se jím
        nemění na tom, co ti Danero poskytuje. Není to ani dar na veřejně prospěšný účel, takže si
        ho z daní neodečteš.
      </p>
      {support.paymentCode && (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4 pt-2">
          {qr && (
            // QR je data URL vygenerovaná na serveru — obyčejný <img> stačí;
            // bílý podklad drží i v tmavém režimu, jinak ho čtečka nepřečte
            <img
              src={qr}
              width={160}
              height={160}
              alt="QR platba — dobrovolný příspěvek na provoz Danera"
              className="rounded-lg bg-white"
            />
          )}
          <div className="type-body">
            <p>Převodem — částku si zvol sám.</p>
            <p className="mt-1 text-ink">
              Číslo účtu{' '}
              <strong className="font-semibold tabular-nums">{support.accountNumber}</strong>
            </p>
          </div>
        </div>
      )}
      {support.url && (
        <p>
          <a
            href={support.url}
            className={buttonVariants({ variant: 'secondary' })}
            target="_blank"
            rel="noreferrer"
          >
            Přispět kartou ({new URL(support.url).hostname.replace(/^www\./, '')})
          </a>
        </p>
      )}
    </Split>
  );
}

export default async function CenikPage() {
  const support = supportFromEnv();
  const xmlYears = yearList(EPO_SUPPORTED_YEARS);
  return (
    <MarketingPage active="cenik">
      <PageHero
        eyebrow="Proč zdarma"
        title="Danero je zdarma. Celé."
        lede="Bez placené verze, bez zkušební doby a bez karty."
      />

      <ul
        aria-label="Proč je Danero zdarma"
        className="mt-10 divide-y divide-line/70 border-y border-line/70 md:mt-14"
      >
        {FACTS.map((fact) => (
          <li
            key={fact.text}
            className="grid gap-x-(--column-gap) py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-baseline md:py-5"
          >
            <p className="type-reading measure text-pretty">{typeset(fact.text)}</p>
            <TextLink
              href={fact.link.href}
              chevron
              external={fact.link.external}
              className="type-body justify-self-start"
            >
              {fact.link.label}
            </TextLink>
          </li>
        ))}
      </ul>

      {supportAvailable(support) && <SupportSplit support={support} />}

      <details className="disclosure mt-12 border-y border-line/70 md:mt-16">
        <summary className="row-hover row-pressable -mx-2 flex min-h-11 items-center gap-4 rounded-lg px-2 py-4">
          <h2 className="type-title-3 min-w-0 flex-1">Co všechno Danero umí</h2>
          <Chevron className="h-3 text-ink-muted" />
        </summary>
        <SpecList className="border-b-0">
          <SpecRow label="Hlídání">
            <FeatureList items={WATCHING} />
          </SpecRow>
          <SpecRow label="Data">
            <FeatureList items={DATA} />
          </SpecRow>
          <SpecRow label="Přiznání">
            <FeatureList items={FILING}>
              {/* roky se berou z konfigurace EPO — XML existuje jen pro ty, pro
                  které finanční správa zveřejnila strukturu (nález E-29) */}
              <li className="flex items-center gap-1.5">
                XML pro elektronické podání (roky {xmlYears})
                <InfoPopover label="XML pro elektronické podání" title="Proč jen některé roky">
                  <p>
                    {tidy(
                      `Za roky ${xmlYears} finanční správa zveřejnila oficiální strukturu podání. Strukturu pro nový rok vydává až začátkem roku následujícího — do té doby dostaneš kompletní čísla s odkazy na řádky formuláře, ale soubor k nahrání ne.`,
                    )}
                  </p>
                  <p>
                    {tidy(
                      `Roky před ${Math.min(...EPO_SUPPORTED_YEARS)} v XML nepodporujeme vůbec; podklady k ručnímu vyplnění za ně spočítáme.`,
                    )}
                  </p>
                </InfoPopover>
              </li>
            </FeatureList>
          </SpecRow>
        </SpecList>
      </details>

      <PageClosing />
    </MarketingPage>
  );
}
