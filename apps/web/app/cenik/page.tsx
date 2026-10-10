import type { Metadata } from 'next';
import Link from 'next/link';
import { toDataURL } from 'qrcode';
import { FaqList } from '@/components/faq-list';
import { IconCheck } from '@/components/marketing-icons';
import { MarketingCta, MarketingPage, PageHero } from '@/components/marketing-page';
import { EPO_SUPPORTED_YEARS } from '@/lib/epo';
import { yearList } from '@/lib/format';
import { SOURCE_URL } from '@/lib/legal';
import { currentUser } from '@/lib/session';
import { supportAvailable, supportFromEnv, type SupportOptions } from '@/lib/support';

/**
 * Ceník se renderuje při každém požadavku, ne při buildu.
 *
 * Údaje o dobrovolném příspěvku jdou z prostředí (`lib/support.ts`) a citlivé
 * proměnné při `next build` ve Vercelu k dispozici NEJSOU — staticky
 * předrenderovaná stránka by si zapekla „žádný příspěvek“ bez ohledu na to, co
 * je nastavené. Stejnou past měl dřív ceník s klíčem Stripu (nález C-3-06).
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ceník — Danero je zdarma',
  description:
    'Danero je zdarma celé: import výpisů, limity a časové testy, podklady k přiznání včetně XML, napojení na brokery i hlídací e-maily. Bez placené verze a bez karty.',
};

/**
 * Co všechno Danero umí — JEDEN seznam, protože je jeden tarif. Do 8. 10. 2026
 * tu byly tři karty (zdarma / podklady / hlídání); jejich obsah je tady celý.
 */
const FEATURES: readonly string[] = [
  'Import výpisů — neomezeně platforem',
  'Limity 100 000 Kč i 50 000 Kč průběžně celý rok',
  'Tříleté časové testy a horizont osvobození: kdy je co bez daně',
  'Orientační daň z investic',
  'Krypto i deriváty jako samostatné druhy příjmů',
  'Podklady k přiznání: čísla přesně do řádků formuláře',
  // roky se berou z konfigurace EPO — XML existuje jen pro ty, pro které
  // finanční správa zveřejnila strukturu (nález E-29)
  `XML pro elektronické podání (roky ${yearList(EPO_SUPPORTED_YEARS)})`,
  'Rozpad na jednotlivé nákupy a použité kurzy',
  'Srovnání variant výpočtu (FIFO/LIFO, kurzy)',
  'Živé napojení na Trading 212, IBKR i Lynx',
  'Automatický denní sync a přepočet',
  'E-mailová upozornění na limity a termíny',
  'Simulátor prodeje: co udělá další obchod',
];

const CENIK_FAQ = [
  {
    q: 'Je opravdu zdarma všechno?',
    a: 'Ano. Všechno, co Danero umí, máš od první minuty — včetně podkladů k přiznání, napojení na brokery a hlídacích e-mailů. Žádná placená verze neexistuje, takže není co odemykat ani kam upgradovat. Stačí e-mail, kartu po tobě nechceme.',
  },
  {
    q: 'Kde je háček? Vyděláváte na mých datech?',
    a: 'Ne. Data nikomu neprodáváme, nejsou tu reklamy ani sledovací skripty a tvoje transakce používáme jen k výpočtům pro tebe. Nemusíš nám to věřit: zdrojový kód je veřejný a můžeš si ho přečíst, nebo si Danero rozjet sám na vlastním serveru.',
  },
  {
    q: 'Zůstane to zdarma napořád?',
    a: 'Měnit to v plánu není. Slíbit „navždy“ ale nejde poctivě o ničem, tak aspoň to, co slíbit jde: kdyby se někdy cokoli mělo zpoplatnit, dozvíš se to e-mailem nejméně 30 dní předem, nic ti nikdy nezačneme účtovat bez tvojí výslovné objednávky a svoje data si kdykoli vyvezeš. A protože je kód otevřený, verzi, kterou používáš dnes, ti nikdo nevezme.',
  },
  {
    q: 'Za které roky dostanu XML pro elektronické podání?',
    a: `Za daňové roky ${yearList(EPO_SUPPORTED_YEARS)} — pro ně finanční správa zveřejnila oficiální strukturu písemnosti DPFDP7. Strukturu pro nový rok vydává až začátkem roku následujícího, takže do té doby za něj XML neexistuje: dostaneš kompletní čísla s odkazy na řádky formuláře, ale soubor k nahrání ne. Roky před ${Math.min(...EPO_SUPPORTED_YEARS)} v XML nepodporujeme vůbec — podklady k ručnímu vyplnění za ně spočítáme. Zbytek podkladů (rozpad prodejů, kurzy, srovnání variant) platí pro každý rok stejně.`,
  },
  {
    q: 'Proč nejsou tarify podle počtu brokerů?',
    a: 'Protože limity 100 000 Kč i 50 000 Kč se sčítají přes všechny platformy. Kdyby ti něco bránilo připojit druhého brokera, počítali bychom ti špatná čísla — a přesně před tím tě má Danero chránit.',
  },
  {
    q: 'Jak můžu pomoct, když se mi Danero hodí?',
    a: 'Nejvíc pomůže, když dáš vědět o chybě nebo o výpisu, který Danero nepřečetlo — každý takový případ zlepší čtení pro všechny. Umíš-li programovat, nejcennější příspěvek do kódu je podpora dalšího brokera. A když o Daneru řekneš někomu, komu by se hodilo, je to ta nejlepší reklama, jakou může mít.',
  },
] as const;

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
 * kdo ji neprovozuje.
 */
async function SupportSection({ support }: { support: SupportOptions }) {
  const qr = support.paymentCode ? await paymentQr(support.paymentCode) : null;
  return (
    <section id="podpora" aria-labelledby="podpora-nadpis" className="mt-24 lg:mt-32">
      <p className="tabular-nums text-xs font-semibold uppercase tracking-[0.18em] text-accent-text">
        Dobrovolně
      </p>
      <h2
        id="podpora-nadpis"
        className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl"
      >
        Chceš přispět na provoz?
      </h2>
      <div className="mt-6 grid items-start gap-8 rounded-lg border border-line bg-surface p-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4 text-ink-muted">
          <p>
            Nemusíš. Danero je zdarma a příspěvkem si{' '}
            <strong className="text-ink">nic neodemkneš</strong> — všechno už máš.
            Když ti ale ušetřilo večer nad tabulkou nebo chybu v přiznání a chceš se
            odvděčit, pomůže to zaplatit doménu, provoz a čas na další brokery.
          </p>
          <p className="text-sm">
            Je to dobrovolný příspěvek, ne platba za službu: nevzniká ti jím žádný
            nárok a nic se jím nemění na tom, co ti Danero poskytuje. Není to ani dar
            na veřejně prospěšný účel, takže si ho z daní neodečteš.
          </p>
          {support.url && (
            <p>
              <a
                href={support.url}
                className="inline-block rounded-md border border-line-control bg-surface px-6 py-3 font-semibold text-ink shadow-sm hover:border-accent hover:text-accent"
                target="_blank"
                rel="noreferrer"
              >
                Přispět kartou ({new URL(support.url).hostname.replace(/^www\./, '')})
              </a>
            </p>
          )}
        </div>
        {support.paymentCode && (
          <div className="space-y-3 text-sm">
            <p className="tabular-nums text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Převodem
            </p>
            {qr && (
              // QR je data URL vygenerovaná na serveru — obyčejný <img> stačí
              <img
                src={qr}
                width={224}
                height={224}
                alt="QR platba — dobrovolný příspěvek na provoz Danera"
                className="rounded-md border border-line bg-white"
              />
            )}
            <p className="text-ink-muted">
              Naskenuj v bankovní aplikaci a částku si zvol sám.
            </p>
            <p>
              Číslo účtu:{' '}
              <strong className="tabular-nums text-ink">{support.accountNumber}</strong>
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export default async function CenikPage() {
  // Ceník je veřejná stránka, ale čte ji i přihlášený uživatel (odkaz
  // z patičky). Registrační CTA by ho poslalo do slepé uličky.
  const signedIn = Boolean(await currentUser());
  const support = supportFromEnv();
  return (
    <MarketingPage active="cenik">
      <PageHero
        eyebrow="Ceník"
        title="Danero je zdarma. Celé."
        lede="Žádná placená verze, žádná zkušební doba, žádná karta. Všechno, co Danero umí, máš od první minuty."
      />

      <section aria-label="Cena a obsah" className="mt-12">
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-8 sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div>
              <p className="tabular-nums text-xs font-semibold uppercase tracking-wide text-accent-text">
                Všechno v jednom
              </p>
              <p className="mt-3 text-5xl font-bold tracking-tight">0 Kč</p>
              <p className="mt-2 text-sm text-ink-muted">
                bez časového omezení a bez karty
              </p>
              <Link
                href={signedIn ? '/prehled' : '/registrace'}
                className="mt-6 inline-block rounded-md bg-accent-fill px-6 py-3 text-center font-semibold text-white hover:opacity-90"
              >
                {signedIn ? 'Přejít do aplikace' : 'Založit účet'}
              </Link>
            </div>
            <ul className="grid content-start gap-3 sm:grid-cols-2">
              {FEATURES.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm">
                  <IconCheck />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-6 text-center text-sm text-ink-muted">
          Danero si můžeš{' '}
          <a
            href={SOURCE_URL}
            className="font-medium text-accent-text underline underline-offset-2"
            target="_blank"
            rel="noreferrer"
          >
            provozovat i sám
          </a>{' '}
          — kód je otevřený pod licencí AGPL-3.0.
        </p>
      </section>

      <section aria-labelledby="proc-zdarma-nadpis" className="mt-24 lg:mt-32">
        <p className="tabular-nums text-xs font-semibold uppercase tracking-[0.18em] text-accent-text">
          Proč
        </p>
        <h2
          id="proc-zdarma-nadpis"
          className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl"
        >
          Proč je to zdarma
        </h2>
        <div className="mt-6 max-w-3xl space-y-4 leading-relaxed text-ink-muted">
          <p>
            Danero je osobní projekt jednoho člověka, ne firma. Vzniklo proto, že jsem
            sám potřeboval hlídat limity a časové testy přes několik platforem — a
            pořád ho ladím na vlastním portfoliu.
          </p>
          <p>
            Do října 2026 mělo placené tarify. Zrušil jsem je — kód je otevřený a chci,
            aby Danero mohl celé používat každý, komu se hodí. Co se tím nemění, je
            péče: metodika je veřejná, každé pravidlo má odkaz na paragraf a výpočty
            kryjí testy.
          </p>
          <p>
            Co se naopak hodí vědět: není tu podpora po telefonu ani garantovaná
            dostupnost. Odpovídám e-mailem a osobně. Jak je to s odpovědností a co
            platí, kdyby projekt někdy končil, najdeš v{' '}
            <Link
              href="/podminky"
              className="font-medium text-accent-text underline underline-offset-2"
            >
              podmínkách užití
            </Link>
            .
          </p>
        </div>
      </section>

      {supportAvailable(support) && <SupportSection support={support} />}

      <section aria-labelledby="cenik-faq-nadpis" className="mt-24 lg:mt-32">
        <p className="tabular-nums text-xs font-semibold uppercase tracking-[0.18em] text-accent-text">
          FAQ
        </p>
        <h2
          id="cenik-faq-nadpis"
          className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl"
        >
          Otázky k ceně
        </h2>
        <div className="mt-8">
          <FaqList items={[...CENIK_FAQ]} />
        </div>
      </section>

      <MarketingCta
        title="Vyzkoušej všechno — zdarma"
        lede="Plné demo bez registrace, nebo rovnou vlastní účet. Stačí e-mail, karta ne."
        primary="registrace"
      />
    </MarketingPage>
  );
}
