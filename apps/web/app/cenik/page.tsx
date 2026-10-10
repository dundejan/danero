import type { Metadata } from 'next';
import { toDataURL } from 'qrcode';
import { DemoCta, SpecList, SpecRow, Split } from '@/components/marketing-blocks';
import { Band, MarketingPage, PageHero } from '@/components/marketing-page';
import { buttonVariants } from '@/components/ui/button';
import { InfoPopover } from '@/components/ui/info-popover';
import { TextLink } from '@/components/ui/link';
import { OPERATOR } from '@/lib/contact';
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
// „proč je to zdarma a v čem je háček“ a tak se i jmenuje v navigaci.
export const metadata: Metadata = {
  title: 'Proč je Danero zdarma',
  description:
    'Danero je zdarma celé: import výpisů, limity a časové testy, podklady k přiznání včetně XML, napojení na brokery i hlídací e-maily. Bez placené verze a bez karty — je to osobní projekt s otevřeným kódem.',
};

/**
 * Co všechno Danero umí — JEDEN výčet, protože žádné stupně nejsou. Do
 * 8. 10. 2026 tu byly tři karty (zdarma / podklady / hlídání); jejich obsah je
 * tady celý, jen seřazený podle toho, k čemu slouží.
 */
const WATCHING: readonly string[] = [
  'Limity 100 000 Kč i 50 000 Kč průběžně celý rok',
  'Tříleté časové testy a horizont osvobození: kdy je co bez daně',
  'E-mailová upozornění na limity a termíny',
  'Simulátor prodeje: co udělá další obchod',
];

const DATA: readonly string[] = [
  'Import výpisů — neomezeně platforem',
  'Živé napojení na Trading 212, IBKR i Lynx',
  'Automatický denní sync a přepočet',
  'Krypto i deriváty jako samostatné druhy příjmů',
];

const FILING: readonly string[] = [
  'Orientační daň z investic',
  'Podklady k přiznání: čísla přesně do řádků formuláře',
  'Rozpad na jednotlivé nákupy a použité kurzy',
  'Srovnání variant výpočtu (FIFO/LIFO, kurzy)',
];

function FeatureList({ items, children }: { items: readonly string[]; children?: React.ReactNode }) {
  return (
    <ul className="space-y-2 text-ink">
      {items.map((item) => (
        <li key={item}>{tidy(item)}</li>
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
 */
async function SupportSplit({ support }: { support: SupportOptions }) {
  const qr = support.paymentCode ? await paymentQr(support.paymentCode) : null;
  return (
    <Split divided title="Příspěvek na provoz">
      <p>
        Nemusíš. Příspěvkem si <strong className="font-semibold text-ink">nic neodemkneš</strong>{' '}
        — všechno už máš. Pomůže zaplatit doménu, provoz a čas na další brokery.
      </p>
      <p className="type-footnote">
        {tidy(
          'Je to dobrovolný příspěvek, ne platba za službu: nevzniká ti jím žádný nárok a nic se jím nemění na tom, co ti Danero poskytuje. Není to ani dar na veřejně prospěšný účel, takže si ho z daní neodečteš.',
        )}
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
        lede="Bez placené verze, bez zkušební doby a bez karty. Všechno, co umí, máš od první minuty."
      />

      <Band tone="canvas" wide className="mt-14 md:mt-20" aria-labelledby="obsah-nadpis">
        <h2 id="obsah-nadpis" className="type-title-1">
          Co všechno dostaneš
        </h2>
        <SpecList className="mt-8">
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
      </Band>

      <Band wide className="pb-0">
        <Split title="Proč se neplatí">
          <p>
            {tidy(
              'Danero je osobní projekt jednoho člověka, ne firma. Vzniklo proto, že jsem sám potřeboval hlídat limity a časové testy přes několik platforem — a pořád ho ladím na vlastním portfoliu.',
            )}
          </p>
          <p>
            {tidy(
              'Do října 2026 mělo placené tarify. Zrušil jsem je: kód je otevřený a chci, aby Danero mohl celé používat každý, komu se hodí.',
            )}
          </p>
        </Split>

        <Split divided title="Kde je háček">
          <p>
            {tidy(
              'V datech ne. Nikomu je neprodávám, nejsou tu reklamy ani sledovací skripty a tvoje transakce slouží jen k výpočtům pro tebe.',
            )}{' '}
            <TextLink href={SOURCE_URL} external>
              Kód je veřejný
            </TextLink>{' '}
            {tidy(
              'pod licencí AGPL-3.0 — můžeš si ho přečíst, nebo si Danero rozjet na vlastním serveru.',
            )}
          </p>
          <p>
            {tidy(
              'Háček je jinde: není tu podpora po telefonu ani garantovaná dostupnost. Odpovídám e-mailem a osobně. Jak je to s odpovědností a co platí, kdyby projekt někdy končil, je',
            )}{' '}
            v&nbsp;<TextLink href="/podminky">podmínkách užití</TextLink>.
          </p>
        </Split>

        <Split divided title="Zůstane to zdarma?">
          <p>
            {tidy(
              'Měnit to v plánu není. Slíbit „navždy“ ale poctivě nejde, tak aspoň to, co slíbit jde: kdyby se někdy cokoli mělo zpoplatnit, dozvíš se to e-mailem nejméně 30 dní předem, nic ti nikdy nezačnu účtovat bez tvojí výslovné objednávky a svoje data si kdykoli vyvezeš.',
            )}
          </p>
          <p>
            {tidy('A protože je kód otevřený, verzi, kterou používáš dnes, ti nikdo nevezme.')}
          </p>
        </Split>

        <Split divided title="Jak můžeš pomoct">
          <p>
            {tidy('Dej vědět o chybě nebo o výpisu, který Danero nepřečetlo — na')}{' '}
            <TextLink href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</TextLink>.{' '}
            {tidy('Každý takový případ zlepší čtení pro všechny.')}
          </p>
          <p>
            {tidy(
              'Umíš programovat? Nejcennější příspěvek do kódu je podpora dalšího brokera. A řekni o Daneru někomu, komu by se hodilo.',
            )}
          </p>
        </Split>

        {supportAvailable(support) && <SupportSplit support={support} />}
      </Band>

      <DemoCta />
    </MarketingPage>
  );
}
