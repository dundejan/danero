import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DisclosureRow } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { TextLink } from '@/components/ui/link';
import { Group, Row } from '@/components/ui/list';
import { Section } from '@/components/ui/section';
import type { importBatches } from '@/db/schema';
import { czDateTime, plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { UnmappedSymbol } from '@/lib/import-service';
import { ALIAS_LIST_ANCHOR, filledSentence, type StoredFilled } from '@/lib/alias-feedback';
import type { BatchIssueView } from '@/lib/import-resolved';
import { undoImportAction } from './actions';
import { platformName } from '@/lib/brokers-catalog';

export type ImportBatchRow = typeof importBatches.$inferSelect;

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
function BatchSummary({ batch, view }: { batch: ImportBatchRow; view: BatchIssueView }) {
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

/**
 * Kód, kterým `lib/import-service.ts` označí dávku ze souboru, jehož formát
 * nepoznal. Jeho jediná hláška se týká celého souboru, ne řádku.
 */
const UNKNOWN_FORMAT = 'neznámý formát';

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
  const wholeFile = batch.broker === UNKNOWN_FORMAT;
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
 * Historie importů: co se kdy nahrálo a co z toho přibylo. Řádek říká výsledek
 * (počty), rozbalení ukáže hlášky k souboru a vrácení importu — to je vzácná
 * a nevratná akce, proto je o úroveň hlouběji a za potvrzením.
 *
 * `highlightedBatchIds` jsou dávky, které uživatel právě nahrál: každá, která
 * má chyby nebo varování, se otevře sama, aby se o nich dozvěděl bez hledání
 * (při nahrání víc souborů naráz ne jen ta poslední — R5-05).
 *
 * `olderHref` vede na delší seznam. Bez něj starší import nešel vrátit zpět
 * vůbec — tlačítko je jen v jeho řádku (R2-05).
 */
export function ImportHistory({
  batches,
  issueViews,
  olderHref,
  highlightedBatchIds,
}: {
  batches: ImportBatchRow[];
  /** Hlášky dávek bez těch, které uživatel vyřídil číselníkem (`lib/import-resolved.ts`). */
  issueViews: ReadonlyMap<string, BatchIssueView>;
  /** Odkaz „Zobrazit starší“; chybí, když už starší importy nejsou. */
  olderHref?: string;
  highlightedBatchIds: ReadonlySet<string>;
}) {
  if (batches.length === 0) {
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
      <Group aria-label="Historie importů">
        {batches.map((batch) => {
          const issues = batch.issues as BatchIssues;
          const view = issueViews.get(batch.id) ?? rawIssueView(batch);
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
              <BatchSummary batch={batch} view={view} />
              {/* na telefonu by datum vedle souhrnu lámalo řádek na tři — jde pod něj */}
              <span className="type-caption mt-0.5 block font-normal tabular-nums text-ink-muted sm:hidden">
                {date}
              </span>
            </>
          );
          const wideDate = <span className="hidden sm:inline">{date}</span>;
          if (!hasIssues && batch.added === 0) {
            // není co rozbalit: jen duplicity, nebo prázdné období
            return (
              <Row key={batch.id} label={<span className="type-callout font-medium">{title}</span>}>
                {/* odsazení zprava drží datum ve sloupci s rozbalovacími řádky (šipka + mezera) */}
                <span className="type-caption pr-5 text-ink-muted">{wideDate}</span>
              </Row>
            );
          }
          return (
            <DisclosureRow
              key={batch.id}
              // kotva pro odkaz z hlášky číselníku („nejdřív vrať zpět import …“)
              id={`import-${batch.id}`}
              title={title}
              meta={wideDate}
              defaultOpen={hasIssues && highlightedBatchIds.has(batch.id)}
            >
              <BatchDetails batch={batch} view={view} />
            </DisclosureRow>
          );
        })}
      </Group>
      {olderHref && (
        <TextLink href={olderHref} chevron className="type-footnote mt-2">
          Zobrazit starší
        </TextLink>
      )}
    </Section>
  );
}
