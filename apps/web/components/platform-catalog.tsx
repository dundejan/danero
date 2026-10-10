import { OPERATOR } from '@/lib/contact';
import { PlatformSearch, type PlatformSearchGroup } from '@/components/platform-search';
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

/** Co k návodu platformy dodat podle způsobu načtení a podle toho, kde katalog stojí. */
function MethodNote({
  platform,
  variant,
}: {
  platform: PlatformInfo;
  variant: 'app' | 'public';
}) {
  if (platform.method === 'template') {
    return (
      <p>
        Stažený výpis přepiš do{' '}
        <a
          href="/api/sablona"
          className="font-medium text-accent-text underline underline-offset-2"
          download
        >
          univerzální šablony
        </a>{' '}
        (<a href="#sablona" className="font-medium text-accent-text underline underline-offset-2">
          jak ji vyplnit
        </a>
        ) a {variant === 'app' ? 'nahraj ji tady' : 'nahraj ji v aplikaci na stránce Zdroje dat'}.
        Vlastní čtečku tohohle výpisu připravujeme — pošli nám anonymizovaný vzorek na{' '}
        <TextLink href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</TextLink> a bude to
        rychlejší.
      </p>
    );
  }
  if (platform.method === 'api') {
    return variant === 'app' ? (
      <p>
        Napojení nastavíš{' '}
        <TextLink href={platform.connectAnchor ?? '#trading212'}>výš na této stránce</TextLink>.
      </p>
    ) : (
      <p>
        Klíč jen pro čtení připojíš po <TextLink href="/registrace">registraci</TextLink> na
        stránce Zdroje dat — i s podrobným návodem, která práva zaškrtnout. Výpis z téhle
        platformy můžeš místo toho nahrát i ručně.
      </p>
    );
  }
  return null;
}

/**
 * Katalog platforem jako užitkový seznam: hledání, pod ním skupiny a v nich
 * řádky „název — způsob načtení“; návod, kde výpis stáhnout, se rozbalí pod
 * řádkem. Žádná loga ani dlaždice — hledá se podle jména.
 *
 * Varianta 'app' (Zdroje dat) odkazuje na napojení a nahrání na téže stránce;
 * 'public' (veřejná /platformy) vede do registrace a aplikace.
 */
export function PlatformCatalog({ variant = 'app' }: { variant?: 'app' | 'public' }) {
  const headingLevel = variant === 'public' ? 'h2' : 'h3';
  const Heading = headingLevel;
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
          // pod myší řádek ztmavne (zvýraznění primitiva) a tichý text by na něm
          // neměl kontrast 4,5 : 1 — proto se s ním zesílí i slovo vpravo
          meta={
            <span className="type-footnote group-hover/disclosure:text-ink">
              {METHOD_WORD[platform.method]}
            </span>
          }
        >
          <div className="space-y-2">
            <p>{platform.guide}</p>
            <MethodNote platform={platform} variant={variant} />
          </div>
        </DisclosureRow>
      ),
    })),
  }));

  return (
    <div>
      <PlatformSearch groups={groups} headingLevel={headingLevel} />

      {/* kotva #sablona: odkazují na ni řádky platforem s vedeným importem */}
      <div id="sablona" className="mt-12 scroll-mt-24">
        <Heading className="type-title-3">{UNIVERSAL_INFO.name}</Heading>
        <p className="type-body measure mt-2 text-pretty text-ink-muted">
          {UNIVERSAL_INFO.guide}{' '}
          <a
            href="/api/sablona"
            className="font-medium text-accent-text underline underline-offset-2"
            download
          >
            Stáhnout šablonu
          </a>
          . Opakované nahrání nic nezdvojí.
        </p>
        {/* pravidla vyplnění: nadpisy jsou vidět jako rejstřík, znění po rozbalení */}
        <div role="list" className="mt-4 max-w-[42rem] divide-y divide-line/70 border-y border-line/70">
          {TEMPLATE_RULES.map((rule) => (
            <DisclosureRow key={rule.label} title={rule.label}>
              <p>{rule.text}</p>
            </DisclosureRow>
          ))}
        </div>
      </div>
    </div>
  );
}
