import type { Metadata } from 'next';
import { KalkulackaPriznani } from '@/components/filing-calculator';
import { MarketingCta, MarketingPage, PageHero } from '@/components/marketing-page';
import { DisclosureRow } from '@/components/ui/disclosure';
import { TextLink } from '@/components/ui/link';
import { Group } from '@/components/ui/list';
import { currentTaxYear } from '@/lib/clock';
import { filingLimitTexts } from '@/lib/filing-limits';

export const metadata: Metadata = {
  title: 'Musím podat daňové přiznání kvůli investicím? Kalkulačka zdarma — Danero',
  description:
    'Odpověz na pár otázek a zjisti orientačně, jestli se tě kvůli akciím, ETF či kryptu týká daňové přiznání. Zlaté pravidlo 100 000 Kč, tříletý časový test i limit 50 000 Kč pro paušální daň.',
};

/**
 * Pravidla pod kalkulačkou — sbalené řádky, celé znění po rozbalení (nástroj
 * má na obrazovce otázky a verdikt, výklad je na požádání). Na rok vázaná
 * nejsou, takže limity § 38g jmenují s oběma roky i částkami (R-09a, R-09b) —
 * hlídá `test/public-filing-limits.test.ts`, který čte řádky `body:`.
 */
const RULES = [
  {
    title: 'Zlaté pravidlo 100 000 Kč',
    body: 'Jsou-li tvoje celkové tržby z prodeje cenných papírů za rok do 100 000 Kč, jsou všechny osvobozené — bez ohledu na zisk a bez tříletého čekání. Počítá se, kolik ti z prodejů přiteklo, ne kolik jsi vydělal. Kryptoaktiva mají od 15. 2. 2025 stejný limit zvlášť.',
  },
  {
    title: 'Tříletý časový test',
    body: 'Cenné papíry držené déle než 3 roky se při prodeji nedaní vůbec (u prodejů v roce 2025 do úhrnu 40 mil. Kč ročně, od roku 2026 bez stropu). Od 15. 2. 2025 má vlastní tříletý test i krypto — tam strop 40 mil. Kč trvá a u stablecoinů je test sporný (počítáme bezpečně, jako by neplatil). Rozhoduje datum nákupu a prodeje konkrétních kusů — přesně to, co Danero hlídá v horizontu osvobození.',
  },
  {
    title: 'Limity pro podání přiznání',
    body: 'OSVČ v paušálním režimu má hranici 50 000 Kč zdanitelných příjmů mimo podnikání. Překročení z režimu nevyhazuje — jen daň přestane být rovna paušální dani, takže vzniká povinnost podat přiznání a přehledy. Do hranice patří neosvobozené prodeje, zahraniční dividendy (v hrubé výši před srážkou), úroky i kladná plnění z derivátů. Zaměstnanci hlídají vedlejší příjmy — za rok 2026 do 20 000 Kč, od roku 2027 do 40 000 Kč; pro ostatní platí obecný limit 50 000 Kč za rok 2026 a 100 000 Kč od roku 2027. Osvobozené prodeje se do limitů nepočítají. Deriváty (CFD, opce, futures) žádné osvobození nemají — do limitu vstupuje součet kladných plnění, ne čistý zisk po odečtení ztrát.',
  },
] as const;

export default function KalkulackaPage() {
  const year = currentTaxYear();
  return (
    <MarketingPage>
      <PageHero
        eyebrow="Kalkulačka"
        title="Musím kvůli investicím podat daňové přiznání?"
        lede="Pár otázek, orientační odpověď. Nic se neukládá."
      />

      <div className="mt-10 md:mt-14">
        {/* Stránka se vykresluje při každém požadavku (patička marketingového
            rámu volá `connection()`), takže běžný rok zná server a kalkulačce
            stačí poslat limity § 38g toho roku. Limity roku předchozího jdou
            s nimi: v sezóně přiznání se rozhoduje o něm (R-09a, R-09b). */}
        <KalkulackaPriznani
          filingLimits={filingLimitTexts(year)}
          previousFilingLimits={filingLimitTexts(year - 1)}
        >
          <section aria-labelledby="pravidla-nadpis" className="pt-6 lg:pt-10">
            <h2 id="pravidla-nadpis" className="type-title-2 text-balance">
              Tři pravidla, která rozhodují
            </h2>
            <Group className="mt-3">
              {RULES.map((rule) => (
                <DisclosureRow key={rule.title} title={rule.title}>
                  <p>{rule.body}</p>
                </DisclosureRow>
              ))}
            </Group>
            <p className="type-callout mt-4">
              <TextLink href="/jak-pocitame" chevron>
                Celá metodika s paragrafy
              </TextLink>
            </p>
          </section>
        </KalkulackaPriznani>
      </div>

      <MarketingCta
        title="Ať to za tebe hlídá Danero — celý rok"
        lede="Napoj brokera nebo nahraj výpis. Danero se ozve dřív, než nějaký limit překročíš."
        primary="registrace"
      />
    </MarketingPage>
  );
}
