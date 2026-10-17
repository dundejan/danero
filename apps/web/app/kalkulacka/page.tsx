import type { Metadata } from 'next';
import { FilingCalculator } from '@/components/filing-calculator';
import { MarketingPage, PageHero } from '@/components/marketing-page';
import { DisclosureRow } from '@/components/ui/disclosure';
import { TextLink } from '@/components/ui/link';
import { Group } from '@/components/ui/list';
import { currentTaxYear } from '@/lib/clock';
import { filingLimitTexts } from '@/lib/filing-limits';
import { tidy } from '@/lib/typography';

export const metadata: Metadata = {
  title: 'Musím kvůli investicím podat přiznání? Kalkulačka — Danero',
  description:
    'Odpověz na pár otázek a zjisti orientačně, jestli se tě kvůli akciím, ETF či kryptu týká daňové přiznání. Limit 100 000 Kč, tříletý časový test i limit 50 000 Kč pro paušální daň.',
};

/**
 * Pravidla pod kalkulačkou — sbalené řádky, celé znění po rozbalení (nástroj
 * má na obrazovce otázky a verdikt, výklad je na požádání). Na rok vázaná
 * nejsou, takže limity § 38g jmenují s oběma roky i částkami (R-09a, R-09b) —
 * hlídá `test/public-filing-limits.test.ts`, který čte řádky `body:`.
 *
 * `guide` je článek průvodce, který pravidlo rozvádí — jeden odkaz pod
 * rozbaleným zněním (SEO audit, K6: články jinak visely jen na rozcestníku).
 */
const RULES = [
  {
    title: 'Limit 100 000 Kč',
    guide: { href: '/pruvodce/limit-100-000-kc', label: 'Článek: limit 100 000 Kč' },
    body: 'Jsou-li tvoje celkové tržby z prodeje cenných papírů za rok do 100 000 Kč, jsou všechny osvobozené — bez ohledu na zisk a bez tříletého čekání. Počítá se, kolik ti z prodejů přiteklo, ne kolik jsi vydělal. Kryptoaktiva mají od 15. 2. 2025 stejný limit zvlášť.',
  },
  {
    title: 'Tříletý časový test',
    body: 'Cenné papíry držené déle než 3 roky se při prodeji nedaní vůbec (u prodejů v roce 2025 do úhrnu 40 mil. Kč ročně, od roku 2026 bez stropu). Od 15. 2. 2025 má vlastní tříletý test i krypto — tam strop 40 mil. Kč trvá a u stablecoinů je test sporný (počítáme bezpečně, jako by neplatil). Rozhoduje datum nákupu a prodeje konkrétních kusů — přesně to, co Danero hlídá v horizontu osvobození.',
  },
  {
    title: 'Limity pro podání přiznání',
    guide: { href: '/pruvodce/pausalni-rezim-a-investice', label: 'Článek: OSVČ v paušálu' },
    body: 'OSVČ v paušálním režimu má hranici 50 000 Kč zdanitelných příjmů mimo podnikání. Překročení z režimu nevyhazuje — jen daň přestane být rovna paušální dani, takže vzniká povinnost podat přiznání a přehledy. Do hranice patří neosvobozené prodeje, zahraniční dividendy (v hrubé výši před srážkou), úroky i kladná plnění z derivátů. Zaměstnanci hlídají vedlejší příjmy — za rok 2026 do 20 000 Kč, od roku 2027 do 40 000 Kč; kdo není zaměstnanec ani OSVČ, má obecný limit 50 000 Kč za rok 2026 a 100 000 Kč od roku 2027. OSVČ mimo paušální režim podává přiznání kvůli podnikání tak jako tak a zdanitelné příjmy z investic do něj patří v jakékoli výši. Osvobozené prodeje se do limitů nepočítají, stejně jako české dividendy a úroky z banky zdaněné srážkou. Deriváty (CFD, opce, futures) žádné osvobození nemají — do limitu vstupuje součet kladných plnění, ne čistý zisk po odečtení ztrát.',
  },
] as const;

export default function KalkulackaPage() {
  const year = currentTaxYear();
  return (
    <MarketingPage active="kalkulacka">
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
        <FilingCalculator
          filingLimits={filingLimitTexts(year)}
          previousFilingLimits={filingLimitTexts(year - 1)}
        >
          <section aria-labelledby="pravidla-nadpis" className="pt-6 lg:pt-10">
            <h2 id="pravidla-nadpis" className="type-title-2 text-balance">
              Tři pravidla, která rozhodují
            </h2>
            <Group className="mt-3">
              {RULES.map((rule) => (
                <DisclosureRow key={rule.title} title={tidy(rule.title)}>
                  <p>{tidy(rule.body)}</p>
                  {'guide' in rule && (
                    <p className="mt-2">
                      <TextLink href={rule.guide.href} chevron>
                        {tidy(rule.guide.label)}
                      </TextLink>
                    </p>
                  )}
                </DisclosureRow>
              ))}
            </Group>
            <p className="type-callout mt-4">
              <TextLink href="/jak-pocitame" chevron>
                Celá metodika s paragrafy
              </TextLink>
            </p>
          </section>
        </FilingCalculator>
      </div>
      {/* bez závěru stránky: obě akce (demo, založení účtu) nese verdikt, kde
          dávají smysl — druhá výzva o obrazovku níž je jen opakovala */}
    </MarketingPage>
  );
}
