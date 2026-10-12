import { Card } from '@/components/ui/card';
import { Field, Select, Textarea } from '@/components/ui/field';
import { Group, GroupItem } from '@/components/ui/list';
import { Section } from '@/components/ui/section';
import { StatusLabel } from '@/components/ui/status';
import { SubmitButton } from '@/components/ui/submit-button';
import { typeset } from '@/components/typeset';
import { PLATFORMS } from '@/lib/brokers-catalog';
import { MAX_NOTE_CHARS, type FailedImportCase } from '@/lib/failed-imports';
import { czDateTime } from '@/lib/format';
import { reportFailedImportAction } from './actions';

/**
 * Co s nepřečteným výpisem děláme a co po uživateli chceme.
 *
 * Originál si necháváme (`lib/failed-imports.ts`), takže se tady neprosí
 * o zaslání souboru e-mailem — jediné, co ze souboru vyčíst neumíme, je,
 * odkud vlastně je. Případ proto vede na jednu otázku a jedno pole navíc.
 */
function CaseBody({ item }: { item: FailedImportCase }) {
  if (item.status === 'fixed') {
    return (
      <>
        <StatusLabel tone="success">Výpis jsme zpracovali a nahráli za tebe.</StatusLabel>
        {/* „Dělat nemusíš nic“ tu dřív stálo napevno — jenže výpis bez ISIN se
            načte jen zčásti a zbytek čeká na číselník. Co zbývá, ukáže živě
            formulář číselníku a chyby u novější dávky; tady neslibujeme. */}
        <p className="type-footnote mt-1 text-pretty text-ink-muted">
          Co se z něj načíst dalo, najdeš v historii jako novější import.
          {item.resolutionNote ? ` ${item.resolutionNote}` : ''}
        </p>
      </>
    );
  }
  if (item.status === 'rejected') {
    return (
      <>
        <StatusLabel tone="neutral">Tenhle výpis zpracovat neumíme.</StatusLabel>
        <p className="type-footnote mt-1 text-pretty text-ink-muted">
          {item.resolutionNote ??
            'Stáhni od své platformy jiný typ exportu — který chceme, najdeš níž v části „Kde výpis stáhnout“ — nebo data přepiš do univerzální šablony.'}
        </p>
      </>
    );
  }
  // Výpis stažený z napojeného účtu: platformu známe, ptát se nemáme nač —
  // a uživatel za to nemůže, žádný soubor nenahrával.
  const fromSync = item.source === 'sync';
  return (
    <>
      {/* Krátce schválně: uživateli stačí vědět, že se to řeší a že se ozveme.
          Že si soubor necháváme, říká /soukromi; jediné, co po něm chceme, je
          platforma — a ta se ptá hned pod tím. */}
      <StatusLabel tone="caution">Na zpracování tohohle výpisu pracujeme.</StatusLabel>
      {/* „jakmile ho zpracujeme“, ne „jakmile půjde nahrát“ — druhé zní, jako by
          měl uživatel po e-mailu ještě něco dělat. Nahrajeme ho za něj. */}
      <p className="type-footnote mt-1 text-pretty text-ink-muted">
        {typeset('Dáme ti e-mailem vědět, jakmile ho zpracujeme.')}
        {!fromSync &&
          item.reportedAt &&
          ` Díky, máme to${item.reportedPlatform ? ` — platforma: ${item.reportedPlatform}` : ''}.`}
      </p>
      {!fromSync && !item.reportedAt && (
        <Card className="mt-3">
          <form
            action={reportFailedImportAction}
            className="space-y-4"
          >
            <input type="hidden" name="pripad" value={item.id} />
            <Field label="Ze které platformy výpis je?" htmlFor={`platforma-${item.id}`}>
              {/* required: prázdné odeslání by formulář schovalo natrvalo
                  (`reportedAt`), a to je jediná cesta, jak nám platformu říct */}
              <Select
                id={`platforma-${item.id}`}
                name="platforma"
                defaultValue=""
                required
                className="max-w-xs"
              >
                <option value="">Vyber platformu…</option>
                {PLATFORMS.map((platform) => (
                  <option key={platform.id} value={platform.name}>
                    {platform.name}
                  </option>
                ))}
                <option value="jiná">Jiná / nevím</option>
              </Select>
            </Field>
            <Field label="Poznámka (nepovinné)" htmlFor={`poznamka-${item.id}`}>
              <Textarea
                id={`poznamka-${item.id}`}
                name="poznamka"
                rows={2}
                maxLength={MAX_NOTE_CHARS}
                placeholder="Např. jak se export v aplikaci jmenuje nebo co v něm je."
                className="min-h-16"
              />
            </Field>
            <SubmitButton variant="secondary" pendingLabel="Odesílám…">
              Odeslat
            </SubmitButton>
          </form>
        </Card>
      )}
    </>
  );
}

/**
 * Výpisy, které jsme nepřečetli: případ po případu, co s ním bude. Sekce stojí
 * hned nad historií (tam stránka po nahrání skočí), protože jako jediná po
 * uživateli něco chce — říct, odkud výpis je.
 */
export function UnreadStatements({ cases }: { cases: FailedImportCase[] }) {
  if (cases.length === 0) return null;
  return (
    <Section title="Výpisy, které jsme nepřečetli">
      <Group aria-label="Výpisy, které jsme nepřečetli">
        {cases.map((item) => (
          <GroupItem key={item.id}>
            <p className="type-callout flex items-baseline justify-between gap-3 font-medium">
              <span className="min-w-0 break-all">{item.filename}</span>
              <span className="type-caption shrink-0 font-normal tabular-nums text-ink-muted">
                {czDateTime(item.createdAt)}
              </span>
            </p>
            <div className="mt-1.5">
              <CaseBody item={item} />
            </div>
          </GroupItem>
        ))}
      </Group>
    </Section>
  );
}
