'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { PositionCard } from '@/components/position-card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { TextLink } from '@/components/ui/link';
import { Group, Row } from '@/components/ui/list';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Table, Th } from '@/components/ui/table';
import { plural } from '@/lib/format';
import { useContainerWide } from '@/lib/use-container-wide';
import { cn } from '@/lib/utils';

/**
 * Pozice na /portfolio: hledání, filtr, řazení a detail vybraného řádku nad
 * řádky předpočítanými na serveru (žádné Decimal přes hranici — texty jsou
 * hotové, pro řazení slouží čistá čísla v `sort`).
 *
 * Tři podoby podle šířky OKNA S OBSAHEM (`@container`), ne prohlížeče:
 * - úzké (telefon): seznam řádků, klepnutí vede na detail pozice,
 * - střední: tabulka, název pozice je odkaz na detail,
 * - široké: tabulka a vedle ní inspektor vybraného řádku — stejné rozdělení
 *   jako seznam a inspektor v aplikacích Macu. Vybraný je vždy právě jeden
 *   řádek, přepnutí je okamžité, šipky nahoru/dolů přecházejí mezi řádky
 *   a dvojklik otevře detail.
 *
 * Rozvržení přepíná CSS; JavaScript se jen ptá, která podoba platí, aby
 * věděl, jestli název pozice vybírá řádek, nebo vede na detail. Bez
 * JavaScriptu je název vždy odkaz a inspektor ukazuje první řádek.
 */

/** Stav časového testu celé pozice. */
export type ExemptState = 'all' | 'part' | 'none' | 'never';

export interface ExplorerLot {
  id: string;
  dateText: string;
  qtyText: string;
  state: 'done' | 'pending' | 'never';
  /** „bez daně“ / „od 13. 2. 2029“ / „nevztahuje se“. */
  statusText: string;
}

export interface ExplorerRow {
  isin: string;
  label: string;
  /** Celý název, liší-li se od `label`. */
  name?: string;
  /** Počet kusů i s jednotkou („45,5 ks“). */
  qtyText: string;
  /** Cena za kus v měně instrumentu (undefined = broker cenu nedodal). */
  priceText?: string;
  /** Hodnota v Kč (undefined = bez ceny či kurzu). */
  valueText?: string;
  /** Podíl na oceněné hodnotě portfolia („6,4 %“). */
  shareText?: string;
  /** Nerealizovaný zisk/ztráta: částka v měně instrumentu a procento. */
  plText?: string;
  plPctText?: string;
  plPositive?: boolean;
  exemptState: ExemptState;
  /** Kusy po časovém testu („40,5 ks“); undefined = žádné. */
  exemptQtyText?: string;
  /** Den, kdy test doběhne dalším kusům; undefined = už není na co čekat. */
  nextExemptText?: string;
  /** Kolik kusů a za jak dlouho („5 ks · za 857 dní“). */
  nextExemptNote?: string;
  /** Prvních pár nákupů pro inspektor; `moreLots` = kolik jich je navíc. */
  lots: ExplorerLot[];
  moreLots: number;
  /** Čísla pro řazení; null = neznámé (řadí se vždy na konec). */
  sort: {
    label: string;
    qty: number | null;
    value: number | null;
    pl: number | null;
    exempt: number | null;
    next: number | null;
  };
}

type SortKey = 'label' | 'qty' | 'value' | 'pl' | 'exempt' | 'next';
type SortDir = 'asc' | 'desc';
type Scope = 'all' | 'exempt' | 'pending';

/** Kolik řádků je vidět, než si člověk řekne o všechny. */
const COLLAPSED_ROWS = 12;

/** Do tolika řádků se seznam obejde bez hledání, řazení výběrem a filtru. */
const FEW_ROWS = 6;

/** Od téhle šířky okna s obsahem stojí inspektor vedle tabulky. */
const WIDE_REM = 60;

/** Výchozí směr: abeceda a datum vzestupně, čísla od největšího. */
const defaultDir = (key: SortKey): SortDir => (key === 'label' || key === 'next' ? 'asc' : 'desc');

/** Bez diakritiky a velikosti písmen — „vaclav“ najde „Václav“. */
const normalize = (value: string): string =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function compareRows(a: ExplorerRow, b: ExplorerRow, key: SortKey, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1;
  if (key === 'label') return sign * a.sort.label.localeCompare(b.sort.label, 'cs');
  const av = a.sort[key];
  const bv = b.sort[key];
  // neznámé hodnoty (bez ceny, bez čekajících kusů) patří na konec bez ohledu na směr
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return sign * (av - bv);
}

const EXEMPT_TEXT: Record<ExemptState, string> = {
  all: 'text-success-text',
  part: 'text-success-text',
  none: 'text-ink-muted',
  never: 'text-ink-muted',
};

/** Stav časového testu jedním krátkým textem — řádek seznamu na telefonu. */
function exemptSummary(row: ExplorerRow): string {
  switch (row.exemptState) {
    case 'all':
      return 'vše bez daně';
    case 'part':
      return `${row.exemptQtyText} bez daně`;
    case 'none':
      return `bez daně od ${row.nextExemptText}`;
    case 'never':
      return 'časový test se nevztahuje';
  }
}

/** Šipka směru řazení — kreslená, ne znak písma. */
function SortGlyph({ dir }: { dir: SortDir }) {
  return (
    <svg viewBox="0 0 8 8" aria-hidden className={cn('size-2', dir === 'asc' && 'rotate-180')}>
      <path
        d="M1 2.5 4 5.5 7 2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SortableTh({
  label,
  sortKey,
  active,
  dir,
  onSort,
  align = 'left',
  className,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <Th
      align={align}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('pr-0 pl-6 first:pl-3 last:pr-3', className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          // šipka stojí na vnější straně popisku, aby popisek lícoval se sloupcem
          'inline-flex min-h-6 items-center gap-1 font-medium hover:text-ink',
          align === 'right' && 'flex-row-reverse',
          active && 'text-ink',
        )}
      >
        {label}
        {active && <SortGlyph dir={dir} />}
      </button>
    </Th>
  );
}

/** Vlásová linka nad buňkou; u krajních buněk končí na hraně textu, ne výběru. */
const CELL =
  'relative py-2.5 pl-6 align-baseline first:pl-3 last:pr-3 before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-line/70 first:before:left-3 last:before:right-3';

/** Sloupec zisku ustupuje, kde by tabulce vedle inspektoru nezbylo místo. */
const PL_COLUMN = 'hidden @min-[44rem]:table-cell @min-[60rem]:hidden @min-[68rem]:table-cell';

/**
 * Inspektor vybrané pozice: hodnota, výsledek, stav časového testu a první
 * nákupy. Dál vede detail pozice a simulátor prodeje.
 */
function PositionInspector({ row, basePath }: { row: ExplorerRow; basePath: string }) {
  const exemptToday =
    row.exemptState === 'all'
      ? `vše · ${row.qtyText}`
      : row.exemptState === 'part'
        ? `${row.exemptQtyText} z ${row.qtyText}`
        : row.exemptState === 'none'
          ? 'zatím nic'
          : 'nevztahuje se';
  return (
    <div>
      <h3 className="type-title-3 break-words">{row.label}</h3>
      <p className="type-footnote break-words text-ink-muted">
        {row.name}
        {row.name && row.isin !== row.label && ' · '}
        {row.isin !== row.label && <span className="tabular-nums">{row.isin}</span>}
      </p>

      <p className="type-figure mt-4 break-words">{row.valueText ?? row.qtyText}</p>
      {(row.valueText || row.priceText) && (
        <p className="type-footnote tabular-nums text-ink-muted">
          {row.valueText && row.qtyText}
          {row.valueText && row.priceText && ' · '}
          {row.priceText && `${row.priceText} za kus`}
          {row.shareText && ` · ${row.shareText} portfolia`}
        </p>
      )}

      <Group className="mt-3" aria-label={`${row.label}: stav pozice`}>
        {row.plText && (
          <Row
            label="Zisk/ztráta"
            value={
              <span className={row.plPositive ? 'text-success-text' : 'text-danger'}>
                {row.plText}
                {row.plPctText && ` (${row.plPctText})`}
              </span>
            }
          />
        )}
        <Row
          label="Bez daně dnes"
          value={<span className={EXEMPT_TEXT[row.exemptState]}>{exemptToday}</span>}
        />
        {row.nextExemptText && (
          <Row label="Další osvobození" hint={row.nextExemptNote} value={row.nextExemptText} />
        )}
      </Group>

      {row.lots.length > 1 && (
        <Group
          className="mt-4"
          title="Nákupy"
          footer={
            row.moreLots > 0
              ? `a ${row.moreLots} ${plural(row.moreLots, 'další', 'další', 'dalších')} na detailu`
              : undefined
          }
          aria-label={`${row.label}: nákupy`}
        >
          {row.lots.map((lot) => (
            <Row
              key={lot.id}
              label={<span className="tabular-nums">{lot.dateText}</span>}
              hint={lot.qtyText}
              value={
                <span className={lot.state === 'done' ? 'text-success-text' : 'text-ink-muted'}>
                  {lot.statusText}
                </span>
              }
            />
          ))}
        </Group>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
        <Link
          href={`${basePath}/simulator?isin=${encodeURIComponent(row.isin)}`}
          className={buttonVariants({ variant: 'primary', size: 'sm' })}
        >
          Simulovat prodej
        </Link>
        <TextLink href={`${basePath}/portfolio/${row.isin}`} chevron className="type-footnote">
          Detail pozice
        </TextLink>
      </div>
    </div>
  );
}

export function PositionsExplorer({
  rows,
  showValue,
  basePath = '',
}: {
  rows: ExplorerRow[];
  /** Známe aspoň nějaké ceny — jinak místo hodnoty stojí počet kusů. */
  showValue: boolean;
  /** Prefix odkazů na detail pozice ('' pro aplikaci, '/demo' pro demo). */
  basePath?: string;
}) {
  const router = useRouter();
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const controls = useRef(new Map<string, HTMLElement>());
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  // bez cen není podle čeho řadit hodnotu — nejdřív to, co se osvobodí nejdřív
  const [sortKey, setSortKey] = useState<SortKey>(showValue ? 'value' : 'next');
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir(showValue ? 'value' : 'next'));
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  // server neví, jak je okno široké: do připojení je název pozice odkaz
  const wide = useContainerWide(rootRef, WIDE_REM, false);

  const sortBy = (key: SortKey, dir?: SortDir) => {
    setSortDir(dir ?? (key === sortKey ? (sortDir === 'asc' ? 'desc' : 'asc') : defaultDir(key)));
    setSortKey(key);
  };

  const exemptCount = rows.filter((row) => row.exemptQtyText).length;
  const pendingCount = rows.filter((row) => row.nextExemptText).length;
  // filtr má smysl, jen když obě skupiny něco obsahují a neshodují se s celkem
  // pár řádků se přehlédne okem — hledání, řazení a filtr by jen překážely
  const showControls = rows.length > FEW_ROWS;
  const showScope =
    showControls &&
    exemptCount > 0 &&
    pendingCount > 0 &&
    (exemptCount < rows.length || pendingCount < rows.length);

  const needle = normalize(query.trim());
  const filtered = rows.filter((row) => {
    if (scope === 'exempt' && !row.exemptQtyText) return false;
    if (scope === 'pending' && !row.nextExemptText) return false;
    return (
      needle === '' || normalize(`${row.label} ${row.name ?? ''} ${row.isin}`).includes(needle)
    );
  });
  const sorted = [...filtered].sort((a, b) => compareRows(a, b, sortKey, sortDir));
  const visible = expanded ? sorted : sorted.slice(0, COLLAPSED_ROWS);
  const current = visible.find((row) => row.isin === selected) ?? visible[0];
  const regionId = `${baseId}-detail`;

  const move = (index: number, step: number) => {
    const next = visible[index + step];
    if (!next) return;
    setSelected(next.isin);
    controls.current.get(next.isin)?.focus();
  };

  const sortHeader = (key: SortKey, label: string, align: 'left' | 'right', className?: string) => (
    <SortableTh
      label={label}
      sortKey={key}
      active={sortKey === key}
      dir={sortDir}
      onSort={sortBy}
      align={align}
      className={className}
    />
  );

  return (
    <div ref={rootRef} className="@container">
      <div className={cn('flex flex-wrap items-center gap-3', !showControls && 'hidden')}>
        <div className="flex w-full items-center gap-3 @2xl:w-auto">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Hledat pozici…"
            aria-label="Hledat pozici (název, ticker nebo ISIN)"
            className="min-w-0 flex-1 @2xl:w-64 @2xl:flex-none"
          />
          {/* telefon: řazení výběrem — záhlaví tabulky tam není */}
          <Select
            aria-label="Řazení pozic"
            value={sortKey}
            onChange={(event) => {
              const key = event.target.value as SortKey;
              sortBy(key, defaultDir(key));
            }}
            className="w-auto shrink-0 @2xl:hidden"
          >
            {showValue && <option value="value">Hodnota</option>}
            <option value="label">Název</option>
            {showValue && <option value="pl">Zisk</option>}
            {!showValue && <option value="qty">Kusy</option>}
            <option value="exempt">Bez daně</option>
            <option value="next">Osvobození</option>
          </Select>
        </div>
        {showScope && (
          <SegmentedControl
            ariaLabel="Které pozice ukázat"
            value={scope}
            onChange={(key) => setScope(key as Scope)}
            segments={[
              { key: 'all', label: 'Vše' },
              { key: 'exempt', label: 'Bez daně' },
              { key: 'pending', label: 'Čekající' },
            ]}
          />
        )}
      </div>

      {/* filtrování mění obsah tabulky bez přenačtení stránky — bez živé oblasti
          se čtečka o výsledku hledání nedozví (a při nule nepozná ani prázdno);
          oblast je v DOM pořád, jinak by se změna neohlásila */}
      <p aria-live="polite" className="sr-only">
        {needle === '' && scope === 'all'
          ? `${rows.length} ${plural(rows.length, 'pozice', 'pozice', 'pozic')} celkem`
          : `Zobrazeno ${sorted.length} z ${rows.length} ${plural(rows.length, 'pozice', 'pozic', 'pozic')}`}
      </p>

      {sorted.length === 0 ? (
        <p className="type-callout mt-6 text-ink-muted">
          {needle ? `Nic nenalezeno pro „${query.trim()}“.` : 'Tomuhle filtru nic neodpovídá.'}
        </p>
      ) : (
        <div
          className={cn(
            'items-start gap-x-(--column-gap) @min-[60rem]:grid @min-[60rem]:grid-cols-[minmax(0,1fr)_minmax(0,var(--inspector-width))]',
            showControls && 'mt-4',
          )}
        >
          <div className="min-w-0">
            {/* telefon: seznam místo tabulky — táž data, stejné pořadí */}
            <ul className="divide-y divide-line/70 @2xl:hidden">
              {visible.map((row) => (
                <li key={row.isin}>
                  <PositionCard
                    isin={row.isin}
                    basePath={basePath}
                    label={row.label}
                    name={row.name}
                    primaryText={row.valueText ?? row.qtyText}
                    exemptText={exemptSummary(row)}
                    exemptDone={row.exemptState === 'all' || row.exemptState === 'part'}
                  />
                </li>
              ))}
            </ul>

            <div className="-mx-3 hidden @2xl:block">
              <Table>
                {/* název tabulky pro čtečku (audit H2-12) — vizuálně ho nese
                    nadpis sekce nad ní, proto sr-only */}
                <caption className="sr-only">Tabulka pozic</caption>
                <thead>
                  <tr>
                    {sortHeader('label', 'Pozice', 'left')}
                    {showValue
                      ? sortHeader('value', 'Hodnota', 'right')
                      : sortHeader('qty', 'Kusů', 'right')}
                    {showValue && sortHeader('pl', 'Zisk/ztráta', 'right', PL_COLUMN)}
                    {sortHeader('exempt', 'Bez daně dnes', 'right')}
                    {sortHeader('next', 'Další osvobození', 'right')}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row, index) => {
                    const isCurrent = row.isin === current?.isin;
                    // u vybraného řádku a pod ním linka mizí — výběr je zaoblená
                    // plocha a čára by ji protínala
                    const afterCurrent = index > 0 && visible[index - 1]?.isin === current?.isin;
                    const cell = cn(
                      CELL,
                      index === 0 && 'before:hidden',
                      isCurrent
                        ? '@min-[60rem]:bg-canvas @min-[60rem]:before:hidden'
                        : '@min-[60rem]:group-hover/row:bg-canvas/60',
                      afterCurrent && '@min-[60rem]:before:hidden',
                    );
                    const href = `${basePath}/portfolio/${row.isin}`;
                    const name = (
                      <>
                        <span className="block truncate font-medium text-ink group-hover/name:text-accent-text">
                          {row.label}
                        </span>
                        {row.name && (
                          <span className="type-footnote block truncate font-normal text-ink-muted">
                            {row.name}
                          </span>
                        )}
                      </>
                    );
                    return (
                      <tr
                        key={row.isin}
                        onClick={wide ? () => setSelected(row.isin) : undefined}
                        onDoubleClick={wide ? () => router.push(href) : undefined}
                        className="group/row"
                      >
                        <td className={cn(cell, 'w-full max-w-0 rounded-l-lg text-left')}>
                          {wide ? (
                            <button
                              ref={(node) => {
                                if (node) controls.current.set(row.isin, node);
                                else controls.current.delete(row.isin);
                              }}
                              type="button"
                              aria-expanded={isCurrent}
                              aria-controls={regionId}
                              onClick={() => setSelected(row.isin)}
                              onKeyDown={(event) => {
                                if (event.key === 'ArrowDown') {
                                  event.preventDefault();
                                  move(index, 1);
                                } else if (event.key === 'ArrowUp') {
                                  event.preventDefault();
                                  move(index, -1);
                                }
                              }}
                              className="block w-full min-w-0 text-left"
                            >
                              {name}
                            </button>
                          ) : (
                            <Link href={href} className="group/name block min-w-0">
                              {name}
                            </Link>
                          )}
                        </td>
                        <td className={cn(cell, 'whitespace-nowrap text-right')}>
                          {showValue ? (
                            <>
                              <span className="block">{row.valueText ?? '—'}</span>
                              <span className="type-footnote block text-ink-muted">
                                {row.qtyText}
                                {row.shareText && ` · ${row.shareText}`}
                              </span>
                            </>
                          ) : (
                            row.qtyText.replace(/\sks$/, '')
                          )}
                        </td>
                        {showValue && (
                          <td
                            className={cn(
                              cell,
                              PL_COLUMN,
                              'whitespace-nowrap text-right',
                              row.plPositive !== undefined &&
                                (row.plPositive ? 'text-success-text' : 'text-danger'),
                            )}
                          >
                            {row.plPctText ?? row.plText ?? '—'}
                          </td>
                        )}
                        <td
                          className={cn(
                            cell,
                            'whitespace-nowrap text-right',
                            EXEMPT_TEXT[row.exemptState],
                          )}
                        >
                          {row.exemptState === 'all' ? 'vše' : (row.exemptQtyText ?? '—')}
                        </td>
                        <td
                          className={cn(
                            cell,
                            'whitespace-nowrap rounded-r-lg text-right',
                            !row.nextExemptText && 'text-ink-muted',
                          )}
                        >
                          {row.nextExemptText ??
                            (row.exemptState === 'never' ? 'nevztahuje se' : '—')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>

            {sorted.length > COLLAPSED_ROWS && (
              <div className="mt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={expanded}
                  onClick={() => setExpanded(!expanded)}
                  className="-ml-3"
                >
                  {expanded ? 'Zobrazit méně' : `Zobrazit všech ${sorted.length}`}
                </Button>
              </div>
            )}
          </div>

          {/* inspektor: jen v širokém okně; tichá plocha ho spojuje s vybraným řádkem */}
          <div
            id={regionId}
            role="region"
            aria-label={current ? `Vybraná pozice: ${current.label}` : undefined}
            className="sticky top-[calc(var(--toolbar-height)+1rem)] hidden rounded-2xl bg-canvas p-5 @min-[60rem]:block"
          >
            {current && <PositionInspector row={current} basePath={basePath} />}
          </div>
        </div>
      )}
    </div>
  );
}
