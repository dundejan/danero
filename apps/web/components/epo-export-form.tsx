'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { describedByError, Field, FieldHint, Input, Select } from '@/components/ui/field';
import { TextLink } from '@/components/ui/link';
import { EPO_FORM_ID, epoFieldError, isSupplementaryFiling } from '@/lib/epo-form';

/** Pole osobních údajů — všechna volitelná, jen protečou do staženého souboru. */
const PERSONAL_FIELDS: Array<{
  name: string;
  label: string;
  placeholder?: string;
  autoComplete?: string;
  type?: 'email';
}> = [
  { name: 'jmeno', label: 'Jméno', autoComplete: 'given-name' },
  { name: 'prijmeni', label: 'Příjmení', autoComplete: 'family-name' },
  { name: 'rodneCislo', label: 'Rodné číslo', placeholder: 'bez lomítka' },
  { name: 'dic', label: 'DIČ', placeholder: 'jen číslo, bez „CZ“' },
  { name: 'obec', label: 'Obec', autoComplete: 'address-level2' },
  { name: 'ulice', label: 'Ulice' },
  { name: 'cisloPopisne', label: 'Číslo popisné' },
  { name: 'psc', label: 'PSČ', autoComplete: 'postal-code' },
  { name: 'ufoCil', label: 'Kód finančního úřadu', placeholder: 'např. 451 (Praha)' },
  // K3-10: `pracUfo` a `email` byly v typu, v XML i v /api/epo, ale formulář
  // pro ně neměl políčko — do souboru se tak nikdy nedostaly.
  { name: 'pracUfo', label: 'Kód územního pracoviště', placeholder: 'např. 2001 (pobočka úřadu)' },
  {
    name: 'email',
    label: 'E-mail',
    type: 'email',
    autoComplete: 'email',
    placeholder: 'kam se úřad ozve',
  },
];

/**
 * Formulář exportu XML pro mojedane.cz. Obyčejný formulář metodou POST na
 * `/api/epo` (stáhne soubor); tlačítko „Stáhnout XML“ v liště reportu ho
 * odesílá přes atribut `form`. Jména polí jsou rozhraní endpointu — neměnit.
 *
 * Klientská je kvůli dvěma věcem, které samotné HTML neumí (R4-03, R4-07):
 *
 * - **Neplatné pole ve sbalené sekci.** Volitelné údaje jsou za rozbalením.
 *   Prohlížeč neplatné pole ve sbaleném `<details>` neumí zaostřit, takže
 *   odeslání tiše zablokoval a nic neukázal. Tady se sekce rozbalí, pole
 *   dostane fokus a pod ním stojí česká hláška.
 * - **Dodatečné přiznání.** Den zjištění důvodů podatelna vyžaduje; sekce
 *   s ním se po volbě typu „Dodatečné“ otevře sama a pole je povinné — dřív
 *   odeslání skončilo na holé stránce se stavem 400.
 *
 * Bez JavaScriptu se formulář odešle jako dřív a chybu vrátí server.
 */
export function EpoExportForm({
  year,
  dividendChoice,
  dividendInfo,
  contentInfo,
}: {
  year: number;
  /**
   * Volba zdanění zahraničních dividend a úroků — jen v roce, kdy nějaké jsou.
   * E-27: variantu nevybíráme za uživatele; popisky nesou obě částky daně.
   */
  dividendChoice: { defaultValue: string; general: string; separate: string } | null;
  /** `InfoPopover` k volbě zdanění dividend. */
  dividendInfo: React.ReactNode;
  /** `InfoPopover` „Co XML obsahuje“. */
  contentInfo: React.ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const supplementaryRef = useRef<HTMLDetailsElement>(null);
  const [filingType, setFilingType] = useState('B');
  const [invalid, setInvalid] = useState<{ name: string; message: string } | null>(null);
  const supplementary = isSupplementaryFiling(filingType);

  // Prohlížeč po návratu na stránku obnoví hodnotu výběru bez události změny.
  useEffect(() => {
    const select = formRef.current?.elements.namedItem('typ-priznani');
    if (select instanceof HTMLSelectElement) setFilingType(select.value);
  }, []);

  // Povinná pole dodatečného přiznání se ukážou, jakmile ten typ zvolíš.
  useEffect(() => {
    if (supplementary && supplementaryRef.current) supplementaryRef.current.open = true;
  }, [supplementary]);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    // jedno odeslání ohlásí všechna neplatná pole naráz — řeší se první
    let handled = false;
    const onInvalid = (event: Event) => {
      const field = event.target;
      if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLSelectElement)) return;
      // vlastní hláška pod polem místo bubliny prohlížeče
      event.preventDefault();
      if (handled) return;
      handled = true;
      queueMicrotask(() => {
        handled = false;
      });
      const section = field.closest('details');
      if (section) section.open = true;
      setInvalid({
        name: field.name,
        message: epoFieldError(field.name, field.validity, field.validationMessage),
      });
      field.focus();
    };
    // `invalid` nebublá — zachytit ho jde jen v zachytávací fázi
    form.addEventListener('invalid', onInvalid, true);
    return () => form.removeEventListener('invalid', onInvalid, true);
  }, []);

  const errorId = (name: string): string => `epo-${name}-error`;
  const errorOf = (name: string): string | undefined =>
    invalid?.name === name ? invalid.message : undefined;

  return (
    <Card className="print:hidden">
      <form
        ref={formRef}
        id={EPO_FORM_ID}
        method="post"
        action="/api/epo"
        className="space-y-5"
        onInput={(event) => {
          // oprava pole hlášku hned schová
          const target = event.target;
          if (target instanceof HTMLInputElement && target.name === invalid?.name) setInvalid(null);
        }}
      >
        <input type="hidden" name="rok" value={year} />
        <div className="grid gap-4 sm:grid-cols-2">
          {dividendChoice && (
            <Field
              label="Zdanění zahraničních dividend a úroků"
              htmlFor="epo-varianta"
              info={dividendInfo}
            >
              <Select
                id="epo-varianta"
                name="varianta"
                defaultValue={dividendChoice.defaultValue}
              >
                <option value="GENERAL">{dividendChoice.general}</option>
                <option value="SEPARATE_16A">{dividendChoice.separate}</option>
              </Select>
            </Field>
          )}
          {/* K3-07: typ přiznání chodil natvrdo jako „řádné“, ačkoli aplikace
              jinde navádí i na dodatečné — kdo to po načtení v EPO nepřepnul,
              podal řádné přiznání za období, které už přiznal. */}
          <Field label="Typ přiznání" htmlFor="epo-typ">
            <Select
              id="epo-typ"
              name="typ-priznani"
              value={filingType}
              onChange={(event) => setFilingType(event.target.value)}
            >
              <option value="B">Řádné — podávám ho za tenhle rok poprvé</option>
              <option value="O">Opravné — opravuji přiznání, lhůta ještě neuplynula</option>
              <option value="D">Dodatečné — opravuji přiznání po uplynutí lhůty</option>
              <option value="E">Opravné dodatečné — opravuji dodatečné přiznání</option>
            </Select>
          </Field>
        </div>

        <div>
          <Disclosure summary="Předvyplnit osobní údaje" className="[&>div]:pt-3 [&>div]:text-ink">
            <p className="type-footnote text-ink-muted">
              Všechna pole jsou volitelná — co nevyplníš, doplníš po načtení v EPO. Nic z nich
              neukládáme, jen protečou do staženého souboru.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PERSONAL_FIELDS.map((field) => (
                <Field
                  key={field.name}
                  label={field.label}
                  htmlFor={`epo-${field.name}`}
                  error={errorOf(field.name)}
                  errorId={errorId(field.name)}
                >
                  <Input
                    id={`epo-${field.name}`}
                    name={field.name}
                    type={field.type}
                    autoComplete={field.autoComplete}
                    placeholder={field.placeholder}
                    {...describedByError(invalid?.name === field.name, errorId(field.name))}
                  />
                  {field.name === 'ufoCil' && (
                    <FieldHint>
                      Najdeš ho v{' '}
                      <TextLink
                        href="https://mojedane.gov.cz/pmd/dokumentace/ciselniky/ukazka/ufo"
                        external
                      >
                        číselníku územních finančních orgánů
                      </TextLink>
                      .
                    </FieldHint>
                  )}
                </Field>
              ))}
            </div>
          </Disclosure>
          <Disclosure
            ref={supplementaryRef}
            summary="Údaje pro dodatečné přiznání"
            className="[&>div]:pt-3 [&>div]:text-ink"
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Den zjištění důvodů"
                htmlFor="epo-zjisteni"
                hint={supplementary ? 'Povinné u dodatečného přiznání.' : undefined}
                error={errorOf('datum-zjisteni')}
                errorId={errorId('datum-zjisteni')}
              >
                <Input
                  id="epo-zjisteni"
                  name="datum-zjisteni"
                  type="date"
                  required={supplementary}
                  {...describedByError(
                    invalid?.name === 'datum-zjisteni',
                    errorId('datum-zjisteni'),
                  )}
                />
              </Field>
              <Field label="Poslední známá daň" htmlFor="epo-posledni-dan">
                <Input
                  id="epo-posledni-dan"
                  name="posledni-dan"
                  inputMode="numeric"
                  placeholder="v Kč, z dřív podaného přiznání"
                />
              </Field>
              <Field label="Poslední známá daňová ztráta" htmlFor="epo-posledni-ztrata">
                <Input
                  id="epo-posledni-ztrata"
                  name="posledni-ztrata"
                  inputMode="numeric"
                  placeholder="v Kč, obvykle 0"
                />
              </Field>
            </div>
            <p className="type-footnote mt-3 text-pretty text-ink-muted">
              Dodatečné přiznání se podává do konce měsíce následujícího po měsíci, ve kterém jsi
              důvody zjistil (§ 141 odst. 1 daňového řádu) — proto ten den podatelna vyžaduje.
              Poslední známou daň a ztrátu opiš z přiznání, které jsi za tenhle rok podal naposledy:
              podatelna z nich počítá rozdíl a bez nich dodatečné přiznání odmítne. Danero je
              z transakcí zjistit nedokáže — dřívější přiznání mohlo obsahovat i příjmy ze
              zaměstnání nebo podnikání.
            </p>
          </Disclosure>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="submit" variant="secondary">
            Stáhnout XML pro EPO
          </Button>
          <div className="type-footnote flex items-center gap-1 text-ink-muted">
            Podklad, ne hotové přiznání — jen investiční příjmy.
            {contentInfo}
          </div>
        </div>
      </form>
    </Card>
  );
}
