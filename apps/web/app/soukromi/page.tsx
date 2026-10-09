import Link from 'next/link';
import { MarketingPage } from '@/components/marketing-page';
import { OPERATOR } from '@/lib/contact';
import { TERMS_EFFECTIVE_FROM, TERMS_VERSION } from '@/lib/legal';
import { supportAvailable, supportFromEnv } from '@/lib/support';

export const metadata = {
  title: 'Ochrana soukromí — Danero',
  description:
    'Jaká data Danero zpracovává, proč, jak dlouho a jaká máš práva — bez cookie lišty a bez trackerů.',
};

export default function PrivacyPage() {
  const support = supportFromEnv();
  return (
    <MarketingPage>
      <div className="mx-auto max-w-2xl space-y-6 py-12 md:py-16">
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
        {/* údaje z lib/contact.ts — čl. 13 odst. 1 písm. a) GDPR chce totožnost
            a kontakt správce, a musí sedět všude stejně (nálezy E-3-02 a E-3-15).

            Jméno stojí v 1. pádě a přesně tak, jak je v `DANERO_OPERATOR_NAME`.
            Strojové skloňování (přilepené „a“ ke dvěma slovům) sedělo na jediné
            jméno; ženě, titulu, firmě i výchozímu „nenastaveno“ totožnost
            správce zkomolilo (L7s-09). Věta proto nesmí předpokládat ani rod. */}
        <p>
          Danero je osobní projekt. Jeho provozovatelem a správcem tvých údajů
          je {OPERATOR.name} (IČO {OPERATOR.ico}, {OPERATOR.address}). Kontakt:{' '}
          <a href={`mailto:${OPERATOR.email}`} className="font-medium text-ruzova-text">
            {OPERATOR.email}
          </a>
          {/* Čl. 13 odst. 1 písm. a) GDPR chce kontaktní údaje správce, ne
              konkrétně telefon — e-mailem se dá vyřídit každé právo subjektu
              údajů a máme z něj písemnou stopu. Telefon je v `/podminky`. */}
          . Žádosti podle GDPR vyřizujeme e-mailem — je z nich písemná stopa
          pro obě strany.
        </p>

        <h2 className="font-display text-lg font-semibold">Co o tobě víme a proč</h2>
        <p>
          Jen to nejnutnější: <strong>e-mail a heslo</strong> (heslo neukládáme, jen
          jeho jednosměrný otisk), volitelně nastavení dvoufaktorového ověření, tvůj
          daňový profil (režim, zvolené metody výpočtu) a{' '}
          <strong>transakční historii</strong>, kterou nahraješ nebo kterou stáhneme
          z brokera. K tomu technické údaje o přihlášení (IP adresa a typ prohlížeče
          u aktivních relací, záznamy o přihlášeních a synchronizacích) — kvůli
          bezpečnosti účtu. Nepotřebujeme jméno, adresu ani rodné číslo; uložíme jen
          oslovení, pokud ho při registraci vyplníš (jinak si ho odvodíme
          z e-mailové adresy).
        </p>

        <h2 className="font-display text-lg font-semibold">Na jakém základě data zpracováváme</h2>
        <p>
          Účet, daňový profil a transakce zpracováváme, protože bez
          nich ti službu nejde poskytnout (plnění smlouvy, čl. 6 odst. 1 písm. b GDPR).
          Bezpečnostní záznamy
          a technické logy držíme z oprávněného zájmu na ochraně tvého účtu a provozu
          služby (čl. 6 odst. 1 písm. f). E-maily, které nám lidé nechali v čekací
          listině před spuštěním, pořád držíme na základě jejich souhlasu — službu
          jsme mezitím otevřeli, takže už do listiny nejde zapsat a k ničemu dalšímu
          adresy nepoužíváme; {/* E-35: „adresu pak smažeme" tady stálo dřív, ale žádný
          kód to nedělal. Odvolání souhlasu je ruční krok a jako ruční se taky popisuje. */}
          souhlas můžeš kdykoli odvolat — napiš na{' '}
          <a href={`mailto:${OPERATOR.email}`} className="font-medium text-ruzova-text">
            {OPERATOR.email}
          </a>{' '}
          a adresu ze seznamu smažeme. A pokud ti někdy budeme chtít poslat něco jiného
          než upozornění ze služby, zeptáme se předem na souhlas (čl. 6 odst. 1 písm. a)
          — a půjde kdykoli odvolat.
        </p>
        <p>
          Poskytnout nám tyhle údaje ti neukládá žádný zákon — je to{' '}
          <strong>smluvní požadavek</strong>:
          bez e-mailu a hesla ti nezaložíme účet, bez daňového profilu a transakční historie
          nemá Danero co počítat, takže bychom ti službu nedokázali poskytnout. Volitelné je
          dvoufázové ověření a napojení brokera přes API klíč — bez nich přijdeš jen o tu
          konkrétní funkci, ne o účet. A když nechceš dát nic, nemusíš: většinu toho, co
          Danero umí, si prohlédneš v demu bez registrace.
        </p>

        <h2 className="font-display text-lg font-semibold">Jak s daty zacházíme</h2>
        <p>
          Data leží v EU. API klíče brokerů jsou šifrované (AES-256-GCM) a nikdy se
          nezobrazují; jsou jen pro čtení. Data nikomu neprodáváme a nepoužíváme je k
          ničemu jinému než k výpočtům pro tebe. Přístup k produkční databázi je omezen
          na provozovatele.
        </p>

        <h2 className="font-display text-lg font-semibold">Když výpis nepřečteme</h2>
        <p>
          Když nahraješ výpis, jehož formát Danero nezná, <strong>necháme si ten soubor</strong>{' '}
          — jinak nemáme podle čeho jeho čtení doplnit; u takového importu uvidíš, že na
          jeho zpracování pracujeme. Totéž platí o výpisu, který si sami stáhneme z API
          brokera. Používáme ho k jedinému účelu: doplnit formát a výpis ti pak
          naimportovat (napsat nám k němu, ze které platformy je, můžeš, ale nemusíš).{' '}
          {/* K6a-04: dřív se tu slibovalo, že vzorek jsou názvy sloupců — jenže reálné
              exporty začínají preambulí (u banky to bylo číslo účtu a jméno
              majitele) a vzorek se bere bez ptaní. Heuristika „vypadá to jako
              hlavička?“ by zabila právě ty případy, kvůli kterým se formát
              doplňuje, takže se srovnává text, ne kód. Mění se naráz
              s `failedImportAlertEmail` v lib/email.ts a s CLAUDE.md. */}
          Provozovateli o tom chodí upozornění, ve kterém je název souboru a jeho
          velikost, tvoje e-mailová adresa, <strong>úplně první řádek souboru</strong>{' '}
          (nejvýš 200 znaků) a chybová hláška — a ta může citovat jednu hodnotu
          z místa, kde se čtení zastavilo. Když k výpisu sám dopíšeš, ze které
          platformy je, a přidáš poznámku, pošle se provozovateli i to. První řádek
          bývá hlavička s názvy sloupců, ale slíbit ti to nemůžeme: některé exporty
          začínají úvodem, ve kterém může být třeba číslo účtu. Bereme ho takový,
          jaký je — soubory s neobvyklým začátkem jsou právě ty, kvůli kterým formát
          doplňujeme. <strong>Samotný výpis se e-mailem neposílá</strong> a soubor
          nikomu dalšímu nepředáváme. Mažeme ho, jakmile případ vyřídíme — ať už se
          formát podařilo doplnit, nebo ne — nejpozději po 90 dnech, a hned, když
          smažeš účet. Nechceš-li ho u nás mít dřív, napiš nám a smažeme ho.
        </p>

        <h2 className="font-display text-lg font-semibold">Jak dlouho data držíme</h2>
        <p>
          Účet, daňový profil a transakční historii držíme, dokud účet nesmažeš — pak
          všechno odstraníme. Technický audit log (záznamy o přihlášeních a synchronizacích)
          držíme 90 dní a starší se každý den automaticky mažou.{' '}
          {/* E-32: dřív tu stálo „nejdéle po dvou měsících“, ale zálohovací skript
              nikdy nic nemazal. Retenci teď drží scripts/db.sh (56 dní) — text říká
              přesně to, co ten mechanismus umí, ne víc. */}
          <strong>Zálohy databáze uchováváme nejvýš 8 týdnů</strong> — při každé nové
          záloze se ty starší než 56 dní automaticky mažou, takže smazaná data mizí
          i ze záloh do dvou měsíců. Databázi navíc provozuje Neon, který drží krátkou
          historii pro obnovu do bodu v čase — v tarifu, který používáme, je to
          6 hodin. Když se odhlásíš z e-mailových
          upozornění, přestaneme ti posílat hlídací e-maily. Nepřestanou tím chodit
          zprávy, bez kterých by služba nefungovala nebo které ti podle podmínek
          dlužíme: obnova hesla, ověření adresy, vyrozumění o výpisu, který se
          nepodařilo přečíst, a oznámení o změně podmínek nebo o konci služby.
          Nastavení si pamatujeme u tvého účtu, dokud ho nesmažeš.
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
          správce tvých dat, my z něj jen čteme.{' '}
          {/* E-31: „se všemi dodavateli máme zpracovatelské smlouvy" bylo tvrzení
              o podpisech, které z kódu nikdo neověří. Tohle znění mluví o tom, co
              je pravda vždycky: podle čeho se dodavatel vybírá a čí podmínky platí. */}
          Dodavatele vybíráme tak, aby zpracovatelskou smlouvu podle čl. 28 GDPR ke
          svým službám měli — u Vercelu, Neonu i Resendu je součástí podmínek,
          za kterých jejich službu používáme. Vercel, Neon i Resend jsou americké
          společnosti — data drží v EU,
          ale při provozu (podpora, logy) může dojít k omezenému předání do USA.
          Vercel a Resend jsou certifikované v rámci EU-U.S. Data Privacy Framework,
          který Evropská komise uznává jako odpovídající ochranu; kde certifikace
          nestačí, kryjí předání standardní smluvní doložky EU (SCC).
        </p>
        {/*
          Do verze 2.4 tu byl jako zpracovatel plateb Stripe a v databázi historie
          nákupů. Placené tarify zanikly 8. 10. 2026 a tabulky s nimi (migrace
          0044). Odstavec zůstává, dokud může mít kdokoli u Stripu z té doby
          záznam — říct „Stripe nepoužíváme" a zamlčet, že ho tam mít může, by
          byla pravda jen napůl.
        */}
        <p>
          <strong>Platby už nezpracováváme.</strong> Do října 2026 mělo Danero
          placené tarify a platby vyřizoval Stripe (Stripe Payments Europe, Irsko).
          Záznamy o nákupech jsme ze své databáze smazali. Kdo tehdy zahájil
          objednávku, může mít u Stripu dál záznam se svým e-mailem a údaji o platbě
          — Stripe je drží jako samostatný správce podle svých pravidel a zákonných
          lhůt. Chceš-li vědět, co o tobě z té doby u Stripu je, nebo to nechat
          smazat, napiš nám.
        </p>
        {supportAvailable(support) && (
          <p>
            <strong>Když pošleš dobrovolný příspěvek.</strong>{' '}
            {support.paymentCode && (
              <>
                U převodu na účet vidíme to, co každý příjemce platby: jméno majitele
                účtu, číslo účtu, částku a zprávu, kterou k platbě připíšeš. S účtem
                v Daneru to nespojujeme a nic se podle toho v aplikaci nemění.
                Údaje o přijatých platbách držíme jako podklad k evidenci příjmů po
                dobu, po kterou může finanční úřad daň za ten rok prověřovat —
                zpravidla tři roky, nejdéle deset let (čl. 6 odst. 1 písm. c GDPR).{' '}
              </>
            )}
            {support.url && (
              <>
                Příspěvek kartou vyřizuje externí služba, na kterou tě odkaz
                zavede — ta zpracovává tvoje údaje podle vlastních podmínek jako
                samostatný správce a my od ní dostáváme jen to, co o přispěvateli
                sama zobrazí (typicky přezdívku a částku).
              </>
            )}
          </p>
        )}
        <p>
          Zdrojový kód Danera je veřejný na GitHubu. Když nám tam napíšeš — issue,
          pull request, diskuse — zpracovává tvoje údaje GitHub podle svých vlastních
          podmínek a to, co napíšeš, je veřejné. GitHub je{' '}
          <strong>americká společnost a data drží v USA</strong>; zárukou jsou tu jeho
          vlastní podmínky a hlavně to, že se předává výhradně to, co sám zveřejníš —
          tvoje jméno nebo přezdívka na GitHubu a obsah příspěvku. Nic z tvého účtu
          v Daneru se tam nedostane. <strong>Do veřejných issue nikdy
          nevkládej výpis od brokera</strong>; jsou to osobní údaje. Když potřebuješ
          poslat vzorek, aby Danero tvůj formát naučilo číst, pošli ho e-mailem —
          používáme ho jen na převod do anonymního testovacího vzorku a pak ho mažeme.
        </p>

        <h2 className="font-display text-lg font-semibold">
          Automatizované rozhodování neprobíhá
        </h2>
        <p>
          Danero o tobě nerozhoduje — počítá a upozorňuje. Žádné automatizované
          rozhodování s právním nebo obdobně závažným účinkem (čl. 22 GDPR) tu neprobíhá,
          stejně jako profilování pro marketing. Co nakonec podáš v daňovém přiznání a
          jaký výklad sporných míst zvolíš, rozhoduješ ty; sporné výklady proto aplikace
          nechává jako přepínač a obě čísla ukazuje vedle sebe.
        </p>

        <h2 className="font-display text-lg font-semibold">Tvoje práva</h2>
        <p>
          Kdykoli můžeš chtít vědět, co o tobě máme (přístup), nechat to opravit,
          omezit zpracování, vznést námitku proti zpracování z oprávněného zájmu,
          odnést si data ve strojově čitelném formátu (export máš přímo v aplikaci)
          nebo všechno smazat zrušením účtu — smazání odstraní všechna tvoje data
          včetně transakcí a šifrovaných klíčů. Dotazy a žádosti posílej
          na{' '}
          <a href={`mailto:${OPERATOR.email}`} className="font-medium text-ruzova-text">
            {OPERATOR.email}
          </a>
          . Pokud si myslíš, že s tvými údaji zacházíme špatně, máš právo podat stížnost
          u dozorového úřadu — Úřadu pro ochranu osobních údajů (
          <a
            href="https://uoou.gov.cz"
            className="font-medium text-ruzova-text"
            target="_blank"
            rel="noreferrer"
          >
            uoou.gov.cz
          </a>
          ).
        </p>
      </section>

      <p className="text-xs text-inkoust-tlumeny">
        Verze {TERMS_VERSION} · účinnost od {TERMS_EFFECTIVE_FROM} · změny oznámíme e-mailem
      </p>

      <p className="text-sm">
        <Link href="/" className="font-medium text-ruzova-text">
          ← Zpět na úvod
        </Link>
      </p>
      </div>
    </MarketingPage>
  );
}
