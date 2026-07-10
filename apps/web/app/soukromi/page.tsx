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

        <h2 className="font-display text-lg font-semibold">Zpracovatelé</h2>
        <p>
          Provoz zajišťují: hosting aplikace a databáze v EU (Vercel, Neon — region
          Frankfurt), odesílání e-mailů (Resend) a rozhraní brokera (Trading212) pro
          čtení tvé historie. S dodavateli máme zpracovatelské smlouvy.
        </p>

        <h2 className="font-display text-lg font-semibold">Tvoje práva</h2>
        <p>
          Kdykoli můžeš požádat o export svých dat nebo smazat účet — smazání odstraní
          všechna tvoje data včetně transakcí a šifrovaných klíčů. Dotazy a žádosti posílej
          na{' '}
          <a href="mailto:dunder.jan@gmail.com" className="font-medium text-ruzova">
            dunder.jan@gmail.com
          </a>
          .
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
