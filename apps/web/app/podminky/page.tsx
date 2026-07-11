import Link from 'next/link';

export const metadata = { title: 'Podmínky užití — Danero' };

/** ⚠️ PRACOVNÍ NÁVRH — před veřejným spuštěním musí projít právní kontrolou. */
export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-16">
      <p className="rounded-md border border-jantar px-4 py-2 text-sm text-jantar">
        Pracovní návrh podmínek pro beta provoz — finální znění projde právní kontrolou.
      </p>
      <h1 className="font-display text-3xl font-bold">Podmínky užití</h1>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="font-display text-lg font-semibold">1. Co Danero je (a co není)</h2>
        <p>
          Danero je výpočetní a evidenční nástroj pro sledování daňových dopadů investic
          fyzických osob v ČR. Výpočty vycházejí ze zveřejněné metodiky (zákon
          č. 586/1992 Sb., pokyny GFŘ) a z dat, která do aplikace vložíš. Danero{' '}
          <strong>není daňovým poradenstvím</strong> ve smyslu zákona č. 523/1992 Sb. ani
          investičním doporučením; výstupy jsou orientační podklady. Za správnost a podání
          daňového přiznání odpovídá vždy poplatník.
        </p>

        <h2 className="font-display text-lg font-semibold">2. Beta provoz</h2>
        <p>
          Služba běží v beta režimu a je poskytována „tak, jak je“, bezplatně a bez záruky
          dostupnosti či úplnosti výpočtů. Sporné výklady daňových předpisů aplikace
          viditelně označuje a volba výkladu je na tobě.
        </p>

        <h2 className="font-display text-lg font-semibold">3. Tvůj účet a data</h2>
        <p>
          Účet je osobní a nepřenosný. Do aplikace vkládej pouze data ke svým vlastním
          investičním účtům (případně účtům, ke kterým máš oprávnění). API klíče brokerů
          smí být pouze pro čtení; Danero nikdy nezadává obchodní příkazy. Data můžeš
          kdykoli smazat zrušením účtu.
        </p>

        <h2 className="font-display text-lg font-semibold">4. Odpovědnost</h2>
        <p>
          V maximálním rozsahu povoleném právem neodpovídáme za škody vzniklé rozhodnutími
          učiněnými na základě výstupů aplikace, za výpadky služby ani za změny výkladů
          daňových předpisů. Aplikace tě na klíčové nejistoty upozorňuje přímo ve
          výstupech.
        </p>

        <h2 className="font-display text-lg font-semibold">5. Provozovatel a kontakt</h2>
        <p>
          Danero je osobní projekt — provozuje ho Jan Dunder. Připomínky a chyby posílej
          na{' '}
          <a href="mailto:dunder.jan@gmail.com" className="font-medium text-ruzova">
            dunder.jan@gmail.com
          </a>
          .
        </p>

        <h2 className="font-display text-lg font-semibold">6. Rozhodné právo a změny podmínek</h2>
        <p>
          Tyto podmínky se řídí právem České republiky; případné spory řeší české soudy.
          Podmínky můžeme upravit — o každé změně ti dáme vědět e-mailem předem a na této
          stránce vždy najdeš aktuální verzi s datem účinnosti.
        </p>
      </section>

      <p className="text-xs text-inkoust-tlumeny">
        Verze 1.0 (beta) · účinnost od 10. července 2026 · změny oznámíme e-mailem
      </p>

      <p className="text-sm">
        <Link href="/" className="font-medium text-ruzova">
          ← Zpět na úvod
        </Link>
      </p>
    </main>
  );
}
