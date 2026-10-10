import { OPERATOR } from '@/lib/contact';
import { PlatformSearch, type PlatformSearchGroup } from '@/components/platform-search';
import { typeset, typesetText } from '@/components/typeset';
import { DisclosureRow } from '@/components/ui/disclosure';
import { TextLink } from '@/components/ui/link';
import {
  PLATFORM_GROUPS,
  PLATFORMS,
  TEMPLATE_RULES,
  UNIVERSAL_INFO,
  type PlatformInfo,
} from '@/lib/brokers-catalog';

/**
 * Jak se platforma načítá — jedním obyčejným slovem vpravo v řádku. Odpovídá
 * na to, co člověk u svého brokera potřebuje vědět dřív, než řádek rozbalí.
 */
const METHOD_WORD: Record<PlatformInfo['method'], string> = {
  api: 'živé napojení',
  file: 'výpis',
  template: 'šablona',
};

/** Co k návodu platformy dodat podle způsobu načtení. */
function MethodNote({ platform }: { platform: PlatformInfo }) {
  if (platform.method === 'template') {
    return typeset(
      <p>
        Stažený výpis přepiš do{' '}
        <TextLink href="/api/sablona" download>
          univerzální šablony
        </TextLink>{' '}
        (<TextLink href="#sablona">jak ji vyplnit</TextLink>) a nahraj ji v aplikaci na stránce
        Zdroje dat. Vlastní čtečku tohohle výpisu připravujeme — pošli nám anonymizovaný vzorek na{' '}
        <TextLink href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</TextLink> a bude to
        rychlejší.
      </p>,
    );
  }
  if (platform.method === 'api') {
    return typeset(
      <p>
        Klíč jen pro čtení připojíš po <TextLink href="/registrace">registraci</TextLink> na
        stránce Zdroje dat — i s podrobným návodem, která práva zaškrtnout. Výpis z téhle
        platformy můžeš místo toho nahrát i ručně.
      </p>,
    );
  }
  return null;
}

/**
 * Katalog platforem jako užitkový seznam: hledání, pod ním skupiny a v nich
 * řádky „název — způsob načtení“; návod, kde výpis stáhnout, se rozbalí pod
 * řádkem. Žádná loga ani dlaždice — hledá se podle jména.
 *
 * Pod seznamem stojí ve stejných dvou sloupcích to, co platí pro všechny
 * platformy naráz: šablona pro brokera, který v seznamu není, a jak se
 * skládá víc účtů dohromady.
 *
 * Je to katalog veřejné stránky `/platformy`. Aplikace (`/import`) ho
 * nepoužívá — tam člověk vybírá svou platformu z nabídky (`platform-guide`).
 */
export function PlatformCatalog() {
  const groups: PlatformSearchGroup[] = PLATFORM_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    items: PLATFORMS.filter((platform) => platform.group === group.key).map((platform) => ({
      id: platform.id,
      keywords: `${platform.name} ${platform.id}`,
      row: (
        <DisclosureRow
          className="border-t border-line/70"
          title={<span className="type-body font-medium">{platform.name}</span>}
          meta={<span className="type-footnote">{METHOD_WORD[platform.method]}</span>}
        >
          <div className="space-y-2">
            <p>{typesetText(platform.guide)}</p>
            <MethodNote platform={platform} />
          </div>
        </DisclosureRow>
      ),
    })),
  }));

  return (
    <div className="@container">
      <PlatformSearch groups={groups} />

      {/* stejné dva sloupce jako seznam platforem nad tím — jedna pravá hrana
          místo tří (text 608 px, řádky 672 px, seznam přes celou šířku) */}
      <div className="mt-12 grid items-start gap-x-(--column-gap) gap-y-12 @2xl:grid-cols-2">
        {/* kotva #sablona: odkazují na ni řádky platforem s vedeným importem */}
        <section id="sablona" aria-labelledby="sablona-nadpis" className="scroll-mt-24">
          <h2 id="sablona-nadpis" className="type-title-3">
            {UNIVERSAL_INFO.name}
          </h2>
          <p className="type-body mt-2 text-pretty text-ink-muted">
            {typesetText(UNIVERSAL_INFO.guide)}{' '}
            <TextLink href="/api/sablona" download>
              Stáhnout šablonu
            </TextLink>
            .
          </p>
          {/* pravidla vyplnění: nadpisy jsou vidět jako rejstřík, znění po rozbalení */}
          <div role="list" className="mt-4 divide-y divide-line/70 border-y border-line/70">
            {TEMPLATE_RULES.map((rule) => (
              <DisclosureRow key={rule.label} title={rule.label}>
                <p>{typesetText(rule.text)}</p>
              </DisclosureRow>
            ))}
          </div>
        </section>

        {/* Oddíl tu byl před redesignem a při něm vypadl (nález R5-24). Kdo má
            dva brokery, potřebuje vědět dřív, než nahraje první výpis, že se
            limity počítají přes všechny účty dohromady. */}
        <section aria-labelledby="vice-uctu-nadpis">
          <h2 id="vice-uctu-nadpis" className="type-title-3">
            Víc brokerů najednou
          </h2>
          <p className="type-body mt-2 text-pretty text-ink-muted">
            {typesetText(
              'Účty a výpisy se skládají vedle sebe. Danero všechno převede do jednoho formátu a limity hlídá přes všechny účty dohromady — tak, jak se posuzují v daňovém přiznání. Opakované nahrání nic nezdvojí.',
            )}
          </p>
        </section>
      </div>
    </div>
  );
}
