import Link from 'next/link';
import { MarketingPage } from '@/components/marketing-page';
import { OPERATOR } from '@/lib/contact';
import { TERMS_EFFECTIVE_FROM, TERMS_VERSION } from '@/lib/legal';

export const metadata = {
  title: 'Ochrana soukromí — Danero',
  description:
    'Jaká data Danero zpracovává, proč, jak dlouho a jaká máš práva — bez cookie lišty a bez trackerů.',
};

export default function PrivacyPage() {
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
        {/* údaje z lib/contact.ts — čl. 13 odst. 1 písm. a) GDPR i § 1820 odst. 1
            písm. c) OZ chtějí totožnost a kontakt správce, a musí sedět všude
            stejně (nálezy E-3-02 a E-3-15) */}
        <p>
          Danero je osobní projekt {OPERATOR.name.split(' ')[0]}a {OPERATOR.name.split(' ')[1]}a
          (IČO {OPERATOR.ico}, {OPERATOR.address}) — on je i správcem tvých údajů. Kontakt:{' '}
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
          bezpečnosti účtu. Nepotřebujeme jméno, adresu ani rodné číslo.
        </p>
        <p>
          Když si něco koupíš, přibude k účtu <strong>historie nákupů</strong>: co a kdy
          sis koupil (celoroční hlídání, nebo podklady za konkrétní daňový rok), do kdy
          máš zaplaceno, jestli je obnova zrušená, identifikátory, pod kterými platbu
          vede Stripe (zákazník, předplatné, platba), případný promokód a čas, kdy jsi
          u objednávky odsouhlasil zahájení plnění — ten musíme umět doložit kvůli
          14denní lhůtě na odstoupení. Číslo karty ani fakturační adresu nedostáváme,
          ty zůstávají u Stripu.
        </p>

        <h2 className="font-display text-lg font-semibold">Na jakém základě data zpracováváme</h2>
        <p>
          Účet, daňový profil, transakce i historii nákupů zpracováváme, protože bez
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
          jeho zpracování pracujeme.
          Používáme ho k jedinému účelu: doplnit formát a výpis ti pak naimportovat
          (napsat nám k němu, ze které platformy je, můžeš, ale nemusíš). Provozovateli
          o tom chodí upozornění, ve kterém je název souboru, první řádek s názvy sloupců
          a chybová hláška — a ta může citovat jednu hodnotu z místa, kde se čtení
          zastavilo. <strong>Samotný výpis se e-mailem neposílá</strong> a soubor nikomu
          dalšímu nepředáváme. Mažeme ho nejpozději po 90 dnech, a hned, když
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
          historii pro obnovu do bodu v čase (v řádu dnů). Když se odhlásíš z e-mailových
          upozornění, přestaneme ti posílat hlídací e-maily. Nepřestanou tím chodit
          zprávy, bez kterých by služba nefungovala nebo bys přišel o peníze:
          potvrzení objednávky, upomínka před automatickou obnovou předplatného
          (tu slibují i podmínky, čl. 5), obnova hesla a ověření adresy.
          Nastavení si pamatujeme u tvého účtu, dokud ho nesmažeš.
        </p>
        <p>
          Historie nákupů a stav předplatného žijí u účtu stejně jako zbytek dat:
          smazáním účtu zmizí i ony (aktivní předplatné přitom ve Stripu zrušíme, ať
          se nestrhne další platba). Doklad o zaplacení a údaje o samotné platbě
          zůstávají u Stripu, který je drží podle svých pravidel a zákonných lhůt —
          my je u sebe nemáme.
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
          svým službám měli — u Vercelu, Neonu, Resendu i Stripu je součástí podmínek,
          za kterých jejich službu používáme. Vercel, Neon i Resend jsou americké
          společnosti — data drží v EU,
          ale při provozu (podpora, logy) může dojít k omezenému předání do USA.
          Vercel a Resend jsou certifikované v rámci EU-U.S. Data Privacy Framework,
          který Evropská komise uznává jako odpovídající ochranu; kde certifikace
          nestačí, kryjí předání standardní smluvní doložky EU (SCC). Platby vyřizuje{' '}
          <strong>Stripe</strong> (Stripe Payments Europe, Irsko) — platební údaje
          zpracovává sám, číslo tvojí karty se k nám nikdy nedostane. Předáváme mu
          tvůj e-mail, identifikátor účtu a informaci, co si kupuješ; zpátky dostáváme
          jen to, že platba
          proběhla, do kdy je zaplaceno a identifikátory, pod kterými platbu vede.
        </p>
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
          nechává jako přepínač a obě čísla ukazuje vedle sebe. Ani cenu ti podle žádných
          dat nepřizpůsobujeme — platí ta z ceníku, pro všechny stejná.
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
