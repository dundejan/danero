import { Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DisclosureRow } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { TextLink } from '@/components/ui/link';
import { Group, Row } from '@/components/ui/list';
import { OpenOnSignal } from '@/components/ui/open-on-signal';
import { Section } from '@/components/ui/section';
import { StatusLabel } from '@/components/ui/status';
import { typeset } from '@/components/typeset';
import { czDateTime, plural } from '@/lib/format';
import { PENDING_PROMISE_HOURS } from '@/lib/import-feedback';
import { cn } from '@/lib/utils';
import type { UnmappedSymbol } from '@/lib/import-service';
import { ALIAS_LIST_ANCHOR, filledSentence, type StoredFilled } from '@/lib/alias-feedback';
import {
  platformAnchor,
  UNKNOWN_FORMAT_BROKER,
  type ImportBatchRow,
  type PlatformGroup,
} from '@/lib/import-overview';
import type { BatchIssueView } from '@/lib/import-resolved';
import { undoImportAction } from './actions';
import { platformName } from '@/lib/brokers-catalog';

export type { ImportBatchRow };

/**
 * Nepřečtený výpis s otevřeným případem: čeká ve slíbené lhůtě, nebo už po ní
 * (pak by řádek „do 48 hodin“ protiřečil sekci výš, která zpoždění přiznává).
 */
export type UnreadState = 'pending' | 'overdue';

export interface BatchIssues {
  errors?: Array<{ line: number; message: string }>;
  warnings?: Array<{ line: number; message: string }>;
  unmapped?: UnmappedSymbol[];
  /** Shoda s transakcemi jiného brokera (B-3-3) — hlásíme, neslučujeme. */
  crossBroker?: string[];
  /** ISIN doplněné z vestavěného číselníku (lib/instrument-aliases `FilledInstrument`). */
  filled?: StoredFilled[];
}

/**
 * Kolik hlášek jedné dávky historie vypíše. Zbytek shrne řádek „a dalších N“
 * z úplných počtů ve sloupcích dávky — bez něj seznam deseti chyb vypadal
 * jako celý, i když jich soubor měl stovky (a uložených je nejvýš
 * `MAX_STORED_ISSUES`, viz lib/import-issues.ts).
 */
const SHOWN_ERRORS = 10;
const SHOWN_WARNINGS = 5;

/**
 * Výsledek importu jedním řádkem: kolik přibylo a kolik už jsme měli. Chyby,
 * varování a přeskočené řádky se píšou jen tehdy, když nějaké jsou — nula
 * chyb není zpráva.
 */
function BatchSummary({
  batch,
  view,
  unread,
}: {
  batch: ImportBatchRow;
  view: BatchIssueView;
  unread: UnreadState | undefined;
}) {
  // Nahrání, jehož výpis čeká mezi nepřečtenými, je TOTÉŽ nahrání — s
  // „neznámý formát · 0 nových · 1 chyba“ vypadalo jako druhý, rozbitý
  // soubor (uživatel 9. 11. 2026: „nahrál jsem jeden, vypadá to jako dva“).
  if (unread) {
    return (
      <span className="type-footnote mt-0.5 block font-normal text-ink-muted">
        {typeset(
          unread === 'overdue'
            ? 'Zpracování trvá déle, než jsme slíbili — podrobnosti výš'
            : `Zpracujeme ho do ${PENDING_PROMISE_HOURS} hodin — podrobnosti výš`,
        )}
      </span>
    );
  }
  // prázdný export (T212 vrací pro roky před založením účtu prázdný
  // soubor) není chyba uživatele — nezobrazovat červeně jako chyby.
  // POZOR: poznává se VÝHRADNĚ nulovými počty (parser od fixu vrací
  // pro prázdný soubor 0 chyb) — sniffování chybových hlášek by
  // maskovalo skutečné chyby formátu (0 přidaných + chyba parsování).
  const isEmptyPeriod =
    batch.added === 0 &&
    batch.duplicates === 0 &&
    batch.skippedCount === 0 &&
    batch.errorCount === 0 &&
    batch.warningCount === 0;
  return (
    <span className="type-footnote mt-0.5 block font-normal tabular-nums text-ink-muted">
      {platformName(batch.broker)} ·{' '}
      {isEmptyPeriod ? (
        'prázdné období'
      ) : (
        <>
          {batch.added} {plural(batch.added, 'nová', 'nové', 'nových')} · {batch.duplicates}{' '}
          {plural(batch.duplicates, 'duplicita', 'duplicity', 'duplicit')}
          {view.errorCount > 0 && (
            <>
              {' · '}
              <span className="text-danger">
                {view.errorCount} {plural(view.errorCount, 'chyba', 'chyby', 'chyb')}
              </span>
            </>
          )}
          {view.warningCount > 0 && (
            <>
              {' · '}
              <span className="text-caution-text">{view.warningCount} varování</span>
            </>
          )}
          {batch.skippedCount > 0 && ` · ${batch.skippedCount} přeskočeno`}
        </>
      )}
    </span>
  );
}

/** Název souboru. H-3-17: názvy z IBKR přetečou řádek od 30 znaků — smí se zlomit kdekoli. */
function Filename({ children }: { children: string }) {
  return <span className="break-all">{children}</span>;
}

/** Hláška k řádku souboru: barvu stavu nese jen označení řádku, text zůstává čitelný inkoustem. */
function IssueLine({
  line,
  tone,
  children,
}: {
  /** Číslo řádku v souboru; `null` = hláška se týká celého souboru. */
  line: number | null;
  tone: 'danger' | 'caution';
  children: React.ReactNode;
}) {
  return (
    <li className="text-pretty text-ink">
      {line !== null && (
        <span
          className={cn(
            'mr-1.5 font-medium tabular-nums',
            tone === 'danger' ? 'text-danger' : 'text-caution-text',
          )}
        >
          Řádek {line}:
        </span>
      )}
      {children}
    </li>
  );
}

function BatchDetails({ batch, view }: { batch: ImportBatchRow; view: BatchIssueView }) {
  const issues = batch.issues as BatchIssues;
  const moreErrors = view.errorCount - SHOWN_ERRORS;
  const moreWarnings = view.warningCount - SHOWN_WARNINGS;
  const errors = view.errors;
  const warnings = view.warnings;
  const crossBroker = issues.crossBroker ?? [];
  const filled = filledSentence(issues.filled ?? [], platformName);
  // nepoznaný soubor má jedinou hlášku, a ta se týká celého souboru, ne řádku
  const wholeFile = batch.broker === UNKNOWN_FORMAT_BROKER;
  return (
    <div className="type-footnote space-y-3">
      {errors.length > 0 && (
        <ul className="space-y-1.5">
          {errors.slice(0, SHOWN_ERRORS).map((issue, i) => (
            // index v klíči: na jednom řádku souboru může být víc chyb
            <IssueLine key={`e-${issue.line}-${i}`} line={wholeFile ? null : issue.line} tone="danger">
              {issue.message}
            </IssueLine>
          ))}
          {moreErrors > 0 && (
            <li className="text-danger">
              … a {plural(moreErrors, 'další', 'další', 'dalších')} {moreErrors}{' '}
              {plural(moreErrors, 'chyba', 'chyby', 'chyb')}. Bývají stejného druhu — oprav první
              a nahraj soubor znovu.
            </li>
          )}
        </ul>
      )}
      {/* Hlášky „doplň ISIN“, které uživatel mezitím vyřídil číselníkem — už
          ne jako chyba, ale co zbývá udělat (`lib/import-resolved.ts`). */}
      {(view.pendingTrades.length > 0 || view.pendingDividends.length > 0) && (
        <ul className="space-y-1.5">
          {view.pendingTrades.length > 0 && (
            <li className="text-pretty text-ink">
              <span className="mr-1.5 font-medium text-success-text">
                {view.pendingTrades.join(', ')}:
              </span>
              ISIN doplněn — nahraj výpis znovu a obchody se doimportují.
            </li>
          )}
          {view.pendingDividends.length > 0 && (
            <li className="text-pretty text-ink">
              <span className="mr-1.5 font-medium text-success-text">
                {view.pendingDividends.join(', ')}:
              </span>
              ISIN doplněn — nahraj výpis znovu a dividendy ho dostanou.
            </li>
          )}
        </ul>
      )}
      {filled && (
        <p className="text-pretty text-ink">
          {filled}{' '}
          <TextLink href={`#${ALIAS_LIST_ANCHOR}`}>Opravit jde v seznamu doplněných údajů</TextLink>
        </p>
      )}
      {(warnings.length > 0 || crossBroker.length > 0) && (
        <ul className="space-y-1.5">
          {warnings.slice(0, SHOWN_WARNINGS).map((issue, i) => (
            <IssueLine key={`w-${issue.line}-${i}`} line={issue.line} tone="caution">
              {issue.message}
            </IssueLine>
          ))}
          {moreWarnings > 0 && (
            <li className="text-caution-text">
              … a {plural(moreWarnings, 'další', 'další', 'dalších')} {moreWarnings} varování.
            </li>
          )}
          {/* nevztahuje se k řádku souboru, ale k celé dávce */}
          {crossBroker.map((message, i) => (
            <IssueLine key={`cb-${i}`} line={null} tone="caution">
              {message}
            </IssueLine>
          ))}
        </ul>
      )}
      {/* Vracet je co jen u dávky, která něco přidala. U nepřečteného výpisu by
          tlačítko navíc zahodilo případ, který čeká na rozbor. */}
      {batch.added > 0 && (
        <ConfirmDialog
          trigger={
            <Button variant="danger" size="sm">
              Vrátit import zpět
            </Button>
          }
          action={undoImportAction}
          fields={{ davka: batch.id }}
          pendingLabel="Vracím…"
          title="Vrátit import zpět?"
          // Poctivě: maže se podle toho, KTERÝ import obchod uložil jako první.
          // Když týž obchod obsahuje i pozdější výpis, zmizí i z něj (tam je
          // počítaný jako duplicita) — proto ta věta o novém nahrání.
          description={`Smažeme ${batch.added} ${plural(batch.added, 'transakci', 'transakce', 'transakcí')}, které přibyly tímhle importem, i záznam o něm. Pokud tytéž obchody obsahuje i jiný výpis, nahraj ho potom znovu — nic se nezdvojí.`}
          confirmLabel="Vrátit import zpět"
        />
      )}
    </div>
  );
}

/** Hlášky dávky tak, jak se uložily — pro dávku, ke které stránka pohled nespočítala. */
function rawIssueView(batch: ImportBatchRow): BatchIssueView {
  const issues = batch.issues as BatchIssues;
  return {
    errors: issues.errors ?? [],
    warnings: issues.warnings ?? [],
    errorCount: batch.errorCount,
    warningCount: batch.warningCount,
    pendingTrades: [],
    pendingDividends: [],
  };
}

/**
 * Řádek dávky: název souboru, výsledek (počty) a datum. Rozbalení ukáže hlášky
 * k souboru a vrácení importu — to je vzácná a nevratná akce, proto je o úroveň
 * hlouběji a za potvrzením.
 */
function BatchRow({
  batch,
  view,
  highlighted,
  unread,
}: {
  batch: ImportBatchRow;
  view: BatchIssueView;
  /** Dávka je právě nahraná: má-li hlášky, otevře se sama. */
  highlighted: boolean;
  unread: UnreadState | undefined;
}) {
  const issues = batch.issues as BatchIssues;
  const hasIssues =
    view.errors.length > 0 ||
    view.warnings.length > 0 ||
    view.pendingTrades.length > 0 ||
    view.pendingDividends.length > 0 ||
    (issues.crossBroker?.length ?? 0) > 0 ||
    (issues.filled?.length ?? 0) > 0;
  const date = czDateTime(batch.createdAt);
  const title = (
    <>
      <Filename>{batch.filename}</Filename>
      <BatchSummary batch={batch} view={view} unread={unread} />
      {/* na telefonu by datum vedle souhrnu lámalo řádek na tři — jde pod něj */}
      <span className="type-caption mt-0.5 block font-normal tabular-nums text-ink-muted sm:hidden">
        {date}
      </span>
    </>
  );
  const wideDate = <span className="hidden sm:inline">{date}</span>;
  // Nepřečtený výpis se nerozbaluje: technická hláška o hlavičce („formát
  // nepoznáváme…“) byla červená chyba vedle slibu, že ho zpracujeme za
  // uživatele — a ten na ní nemá co opravit. Vše potřebné říká sekce výš.
  if (unread || (!hasIssues && batch.added === 0)) {
    // není co rozbalit: jen duplicity, prázdné období nebo nepřečtený výpis
    return (
      <Row label={<span className="type-callout font-medium">{title}</span>}>
        {/* odsazení zprava drží datum ve sloupci s rozbalovacími řádky (šipka + mezera) */}
        <span className="type-caption pr-5 text-ink-muted">{wideDate}</span>
      </Row>
    );
  }
  return (
    <DisclosureRow
      // kotva pro odkaz z hlášky číselníku („nejdřív vrať zpět import …“);
      // `OpenOnHash` otevře i zavřenou skupinu platformy nad ním
      id={`import-${batch.id}`}
      title={title}
      meta={wideDate}
      defaultOpen={hasIssues && highlighted}
    >
      <BatchDetails batch={batch} view={view} />
    </DisclosureRow>
  );
}

/**
 * Záhlaví platformy: jméno, stav s datem poslední dávky nebo synchronizace
 * a jeden řádek s obdobím a počtem transakcí. Nic víc — podrobnosti jsou
 * v dávkách a na kartě připojeného účtu.
 */
function PlatformTitle({ group }: { group: PlatformGroup }) {
  return (
    <>
      {group.name}
      {group.status && (
        <span className="mt-0.5 block">
          <StatusLabel tone={group.status.tone}>
            {group.status.text}
            {group.status.when && (
              <span className="font-normal text-ink-muted"> · {group.status.when}</span>
            )}
          </StatusLabel>
        </span>
      )}
      <span className="type-footnote mt-0.5 block font-normal tabular-nums text-ink-muted">
        {group.summary}
      </span>
    </>
  );
}

/**
 * Historie importů po platformách: řádek na platformu (odkud data chodí, jak
 * jsou čerstvá, jaké období pokrývají), po rozbalení její dávky od nejnovější.
 * Napojený Trading 212 zapisuje dávku každý den — v plochém seznamu pod nimi
 * ruční výpisy jiných platforem zapadaly. Seskupení a stav počítá
 * `lib/import-overview.ts`.
 *
 * `highlightedBatchIds` jsou dávky, které uživatel právě nahrál: jejich
 * skupina se otevře a v ní každá dávka, která má chyby nebo varování, aby se
 * o nich dozvěděl bez hledání (při nahrání víc souborů naráz ne jen ta
 * poslední — R5-05).
 *
 * Každá skupina má vlastní „Zobrazit starší“. Bez něj starší import nešel
 * vrátit zpět vůbec — tlačítko je jen v jeho řádku (R2-05).
 */
export function ImportHistory({
  groups,
  issueViews,
  highlightedBatchIds,
  unreadBatches = new Map(),
}: {
  groups: readonly PlatformGroup[];
  /** Hlášky dávek bez těch, které uživatel vyřídil číselníkem (`lib/import-resolved.ts`). */
  issueViews: ReadonlyMap<string, BatchIssueView>;
  highlightedBatchIds: ReadonlySet<string>;
  /** Dávky, jejichž výpis čeká v sekci nepřečtených jako otevřený případ, a zda už po lhůtě. */
  unreadBatches?: ReadonlyMap<string, UnreadState>;
}) {
  if (groups.length === 0) {
    return (
      <Section title="Historie importů">
        <EmptyState compact title="Zatím žádný import" headingAs="p">
          Po nahrání výpisu nebo synchronizaci tady uvidíš, kolik transakcí přibylo.
        </EmptyState>
      </Section>
    );
  }
  return (
    <Section title="Historie importů">
      <Group aria-label="Historie importů podle platforem">
        {groups.map((group) => {
          const title = <PlatformTitle group={group} />;
          if (group.batches.length === 0) {
            // napojený účet, který ještě nic nestáhl — není co rozbalit
            return (
              <Row key={group.key} label={<span className="type-callout font-medium">{title}</span>} />
            );
          }
          const anchor = platformAnchor(group.key);
          return (
            <Fragment key={group.key}>
              <DisclosureRow id={anchor} title={title} defaultOpen={group.open}>
                {/* obsah rozbalení je tlumený; dávky jsou řádky jako všude jinde */}
                <Group aria-label={`Importy: ${group.name}`} className="text-ink sm:pl-3">
                  {group.batches.map((batch) => (
                    <BatchRow
                      key={batch.id}
                      batch={batch}
                      view={issueViews.get(batch.id) ?? rawIssueView(batch)}
                      highlighted={highlightedBatchIds.has(batch.id)}
                      unread={unreadBatches.get(batch.id)}
                    />
                  ))}
                </Group>
                {group.olderHref && (
                  <TextLink href={group.olderHref} chevron className="type-footnote mt-2 sm:ml-3">
                    Zobrazit starší
                  </TextLink>
                )}
              </DisclosureRow>
              <OpenOnSignal targetId={anchor} signal={group.openSignal} />
            </Fragment>
          );
        })}
      </Group>
    </Section>
  );
}

