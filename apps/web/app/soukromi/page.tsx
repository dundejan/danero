import Link from 'next/link';

export const metadata = { title: 'Ochrana soukromí — Danero' };

/** ⚠️ PRACOVNÍ NÁVRH — před veřejným spuštěním musí projít právní kontrolou. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-16">
      <p className="rounded-md border border-jantar px-4 py-2 text-sm text-jantar">
        Pracovní návrh zásad pro beta provoz — finální znění projde právní kontrolou.
      </p>
      <h1 className="font-display text-3xl font-bold">Ochrana soukromí</h1>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="font-display text-lg font-semibold">Kdo tvoje data spravuje</h2>
        <p>
          Danero je osobní projekt Jana Dundera — on je i správcem tvých údajů. Kontakt:{' '}
          <a href="mailto:dunder.jan@gmail.com" className="font-medium text-ruzova">
            dunder.jan@gmail.com
          </a>
          .
        </p>

        <h2 className="font-display text-lg font-semibold">Co o tobě víme</h2>
        <p>
          Jen to nejnutnější: <strong>e-mail a heslo</strong> (heslo jako Argon2 otisk),
          volitelně nastavení dvoufaktorového ověření, tvůj daňový profil (režim,
          zvolené metody výpočtu) a <strong>transakční historii</strong>, kterou nahraješ
          nebo kterou stáhneme z brokera. Nepotřebujeme jméno, adresu ani rodné číslo.
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
          držíme 90 dní, zálohy databáze se přepisují po 30 dnech — smazaná data tedy
          zmizí i ze záloh nejpozději do 30 dní. Když se odhlásíš z e-mailových
          upozornění, tvůj e-mail si necháme jen v seznamu potlačených adres — aby ti už
          opravdu nic nepřišlo.
        </p>

        <h2 className="font-display text-lg font-semibold">Cookies</h2>
        <p>
          Používáme jen nezbytné cookies pro přihlášení a bezpečnost relace (session a
          auth cookies). Žádná analytika třetích stran, žádné marketingové ani sledovací
          cookies — proto tu nenajdeš ani cookie lištu.
        </p>

        <h2 className="font-display text-lg font-semibold">Zpracovatelé a předání mimo EU</h2>
        <p>
          Provoz zajišťují: hosting aplikace a databáze v EU (Vercel, Neon — region
          Frankfurt), odesílání e-mailů (Resend) a rozhraní brokera (Trading212) pro
          čtení tvé historie. S dodavateli máme zpracovatelské smlouvy. Vercel a Resend
          jsou společnosti z USA — data drží primárně v EU, ale při provozu může dojít
          k omezenému předání do USA; to je kryté standardními smluvními doložkami EU
          (SCC).
        </p>

        <h2 className="font-display text-lg font-semibold">Tvoje práva</h2>
        <p>
          Kdykoli můžeš požádat o export svých dat nebo smazat účet — smazání odstraní
          všechna tvoje data včetně transakcí a šifrovaných klíčů. Dotazy a žádosti posílej
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

      <p className="text-sm">
        <Link href="/" className="font-medium text-ruzova">
          ← Zpět na úvod
        </Link>
      </p>
    </main>
  );
}
