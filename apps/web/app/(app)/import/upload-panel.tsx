import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { FileField } from '@/components/ui/file-field';
import { InfoPopover } from '@/components/ui/info-popover';
import { Section } from '@/components/ui/section';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  PLATFORM_COUNTS,
  PLATFORM_GROUPS,
  PLATFORMS,
  TEMPLATE_RULES,
  UNIVERSAL_INFO,
} from '@/lib/brokers-catalog';
import { OPERATOR } from '@/lib/contact';
import { tidy } from '@/lib/typography';
import { uploadImportAction } from './actions';
import { PlatformGuide, type GuideGroup } from './platform-guide';

/** Kotva pravidel univerzální šablony (odkazuje na ni návod platforem bez vlastní čtečky). */
const TEMPLATE_ANCHOR = 'sablona';

const GUIDE_GROUPS: GuideGroup[] = PLATFORM_GROUPS.map((group) => ({
  label: group.label,
  platforms: PLATFORMS.filter((platform) => platform.group === group.key).map(
    ({ id, name, method, guide, connectAnchor }) => ({
      id,
      name,
      method,
      guide,
      connectAnchor: connectAnchor as `#${string}` | undefined,
    }),
  ),
}));

/**
 * Nahrání výpisů — cesta, která funguje pro každou platformu, proto nese
 * jediné hlavní tlačítko stránky. Na obrazovce je jen výběr souborů, tlačítko
 * a jedna věta o tom, co nahrát; zbytek (jak poznáváme formát, proč se nic
 * nezdvojí, co s velkým souborem) je ve vysvětlivce.
 *
 * Zpětnou vazbu dává tlačítko hned při stisku („Nahrávám a počítám…“), po
 * dokončení plovoucí hláška a nový řádek v historii.
 *
 * Pod formulářem je nápověda na požádání: kde výpis u které platformy
 * stáhnout (výběr platformy) a jak vyplnit univerzální šablonu.
 */
export function UploadPanel() {
  return (
    <Section
      title="Nahrát výpis"
      info={
        <InfoPopover label="Nahrání výpisu" title="Co se s výpisem stane" align="start">
          <p>
            Formát poznáme sami u {PLATFORM_COUNTS.file + PLATFORM_COUNTS.api} platforem;
            z ostatních přepíšeš data do univerzální šablony.
          </p>
          <p>
            Opakované nahrání nic nezdvojí — co už v Daneru je, poznáme i napříč soubory. Klidně
            proto nahraj výpisy, které se překrývají.
          </p>
          <p>
            Jeden soubor smí mít nejvýš 4 MB. Větší export stáhni po kratších obdobích (třeba po
            roce) a nahraj je postupně.
          </p>
        </InfoPopover>
      }
    >
      <Card>
        <form
          action={uploadImportAction}
          className="flex flex-col gap-4 sm:flex-row sm:items-center"
        >
          <FileField
            name="soubory"
            ariaLabel="Soubory s výpisy (CSV, XML, XLSX nebo HTML)"
            accept=".csv,text/csv,.xml,text/xml,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.htm,.html,text/html"
            multiple
            required
          />
          <SubmitButton pendingLabel="Nahrávám a počítám…">Nahrát výpisy</SubmitButton>
        </form>
      </Card>
      <p className="type-footnote mt-2 text-pretty text-ink-muted">
        Nahraj celou historii od prvního nákupu — CSV, XML, XLSX nebo HTML.
      </p>

      <div className="mt-5">
        <PlatformGuide
          groups={GUIDE_GROUPS}
          otherGuide={UNIVERSAL_INFO.guide}
          templateAnchor={TEMPLATE_ANCHOR}
          contactEmail={OPERATOR.email}
        />
        <Disclosure
          id={TEMPLATE_ANCHOR}
          summary="Jak vyplnit univerzální šablonu"
          className="scroll-mt-20"
        >
          <div className="space-y-2">
            <p>
              {tidy(UNIVERSAL_INFO.guide)}{' '}
              <a
                href="/api/sablona"
                download
                className="font-medium text-accent-text underline underline-offset-2"
              >
                Stáhnout šablonu
              </a>
            </p>
            <p>Při vyplňování se drž těchhle pravidel:</p>
            <ul className="list-disc space-y-1.5 pl-4">
              {TEMPLATE_RULES.map((rule) => (
                <li key={rule.label}>
                  <strong className="font-medium text-ink">{rule.label}:</strong> {rule.text}
                </li>
              ))}
            </ul>
          </div>
        </Disclosure>
      </div>
    </Section>
  );
}
