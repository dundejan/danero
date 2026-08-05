import Link from 'next/link';
import { MarketingPage } from '@/components/marketing-page';

export const metadata = {
  title: 'Ochrana soukromí — Danero',
  description:
    'Jaká data Danero zpracovává, proč, jak dlouho a jaká máš práva — bez cookie lišty a bez trackerů.',
};

/** ⚠️ PRACOVNÍ NÁVRH — před veřejným spuštěním musí projít právní kontrolou. */
export default function PrivacyPage() {
  return (
    <MarketingPage>
      <div className="mx-auto max-w-2xl space-y-6 py-12 md:py-16">
      <p className="rounded-md border border-jantar px-4 py-2 text-sm text-jantar-text">
        Pracovní návrh zásad pro beta provoz — finální znění projde právní kontrolou.
      </p>
      <div>
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova-text">
          Právní
        </p>
        <h1 className="mt-3 font-display text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
          Ochrana soukromí
        </h1>
      </div>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="font-display text-lg font-semibold">Kdo tvoje data spravuje</h2>
        <p>
          Danero je osobní projekt Jana Dundera (IČO 19642661, Žitomírská 640/3, Vršovice,
          101 00 Praha 10) — on je i správcem tvých údajů. Kontakt:{' '}
          <a href="mailto:dunder.jan@gmail.com" className="font-medium text-ruzova">
            dunder.jan@gmail.com
          </a>
          .
        </p>

        <h2 className="font-display text-lg font-semibold">Co o tobě víme a proč</h2>
        <p>
          Jen to nejnutnější: <strong>e-mail a heslo</strong> (heslo jako Argon2 otisk),
          volitelně nastavení dvoufaktorového ověření, tvůj daňový profil (režim,
          zvolené metody výpočtu) a <strong>transakční historii</strong>, kterou nahraješ
          nebo kterou stáhneme z brokera. K tomu technické údaje o přihlášení (IP adresa
          a typ prohlížeče u aktivních relací, záznamy o přihlášeních a synchronizacích)
          — kvůli bezpečnosti účtu. Nepotřebujeme jméno, adresu ani rodné číslo.
        </p>

        <h2 className="font-display text-lg font-semibold">Na jakém základě data zpracováváme</h2>
        <p>
          Účet, daňový profil a transakce zpracováváme, protože bez nich ti službu nejde
          poskytnout (plnění smlouvy, čl. 6 odst. 1 písm. b GDPR). Bezpečnostní záznamy
          a technické logy držíme z oprávněného zájmu na ochraně tvého účtu a provozu
          služby (čl. 6 odst. 1 písm. f). E-mail zadaný do čekací listiny používáme jen
          na základě tvého souhlasu — pošleme ti jediné oznámení o otevření a adresu pak
          smažeme. A pokud ti někdy budeme chtít poslat něco jiného než upozornění ze
          služby, zeptáme se předem na souhlas (čl. 6 odst. 1 písm. a) — a půjde kdykoli
          odvolat.
        </p>

        <h2 className="font-display text-lg font-semibold">Jak s daty zacházíme</h2>
        <p>
          Data leží v EU. API klíče brokerů jsou šifrované (AES-256-GCM) a nikdy se
          nezobrazují; jsou jen pro čtení. Data nikomu neprodáváme a nepoužíváme je k
          ničemu jinému než k výpočtům pro tebe. Přístup k produkční databázi je omezen
          na provozovatele.
        </p>

        <h2 className="font-display text-lg font-semibold">Jak dlouho data držíme</h2>
        <p>
          Účet, daňový profil a transakční historii držíme, dokud účet nesmažeš — pak
          všechno odstraníme. Technický audit log (záznamy o přihlášeních a synchronizacích)
          držíme 90 dní a starší se každý den automaticky mažou. Zálohy databáze se
          přepisují průběžně, nejdéle po dvou měsících — smazaná data tedy zmizí i ze
          záloh nejpozději do 60 dnů. Když se odhlásíš z e-mailových
          upozornění, e-maily ti přestanou chodit okamžitě — nastavení si pamatujeme
          u tvého účtu, dokud ho nesmažeš.
        </p>

        <h2 className="font-display text-lg font-semibold">Cookies</h2>
        <p>
          Používáme jen nezbytné cookies pro přihlášení a bezpečnost relace (session a
          auth cookies). Žádná analytika třetích stran, žádné marketingové ani sledovací
          cookies — proto tu nenajdeš ani cookie lištu.
        </p>

        <h2 className="font-display text-lg font-semibold">Zpracovatelé a předání mimo EU</h2>
        <p>
          Provoz zajišťují: hosting aplikace (Vercel) a databáze (Neon) — obojí
          v regionu Frankfurt, odesílání e-mailů (Resend) a rozhraní tvého brokera
          (např. Trading 212) pro čtení historie — broker je vůči tobě samostatný
          správce tvých dat, my z něj jen čteme. Se všemi dodavateli máme zpracovatelské
          smlouvy. Vercel, Neon i Resend jsou americké společnosti — data drží v EU,
          ale při provozu (podpora, logy) může dojít k omezenému předání do USA.
          Vercel a Resend jsou certifikované v rámci EU-U.S. Data Privacy Framework,
          který Evropská komise uznává jako odpovídající ochranu; kde certifikace
          nestačí, kryjí předání standardní smluvní doložky EU (SCC). Až spustíme
          platby, přibude Stripe (platební údaje zpracovává Stripe sám, my tvoji kartu
          nikdy nevidíme) — tuhle stránku předem aktualizujeme.
        </p>
        <p>
          Zdrojový kód Danera je veřejný na GitHubu. Když nám tam napíšeš — issue,
          pull request, diskuse — zpracovává tvoje údaje GitHub podle svých vlastních
          podmínek a to, co napíšeš, je veřejné. <strong>Do veřejných issue nikdy
          nevkládej výpis od brokera</strong>; jsou to osobní údaje. Když potřebuješ
          poslat vzorek, aby Danero tvůj formát naučilo číst, pošli ho e-mailem —
          používáme ho jen na převod do anonymního testovacího vzorku a pak ho mažeme.
        </p>

        <h2 className="font-display text-lg font-semibold">Tvoje práva</h2>
        <p>
          Kdykoli můžeš chtít vědět, co o tobě máme (přístup), nechat to opravit,
          omezit zpracování, vznést námitku proti zpracování z oprávněného zájmu,
          odnést si data ve strojově čitelném formátu (export máš přímo v aplikaci)
          nebo všechno smazat zrušením účtu — smazání odstraní všechna tvoje data
          včetně transakcí a šifrovaných klíčů. Dotazy a žádosti posílej
          na{' '}
          <a href="mailto:dunder.jan@gmail.com" className="font-medium text-ruzova">
            dunder.jan@gmail.com
          </a>
          . Pokud si myslíš, že s tvými údaji zacházíme špatně, máš právo podat stížnost
          u dozorového úřadu — Úřadu pro ochranu osobních údajů (
          <a
            href="https://uoou.gov.cz"
            className="font-medium text-ruzova"
            target="_blank"
            rel="noreferrer"
          >
            uoou.gov.cz
          </a>
          ).
        </p>
      </section>

      <p className="text-xs text-inkoust-tlumeny">
        Verze 1.2 (beta) · účinnost od 5. srpna 2026 · změny oznámíme e-mailem
      </p>

      <p className="text-sm">
        <Link href="/" className="font-medium text-ruzova">
          ← Zpět na úvod
        </Link>
      </p>
      </div>
    </MarketingPage>
  );
}
