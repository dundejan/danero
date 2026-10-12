import Link from 'next/link';
import type { Position } from '@danero/engine';
import { czDate, plural, qty } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Card, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { PositionCard } from '@/components/position-card';
import { TextLink } from '@/components/ui/link';

interface Row {
  isin: string;
  label: string;
  name?: string;
  total: number;
  exemptQty: number;
  nearestExemptFrom: string | null;
  daysToExempt: number | null;
  /** Osvobození časovým testem u téhle pozice nikdy nepřijde (A2-3-04). */
  neverExempt: boolean;
}

/** Od kolika pozic výš tabulka ukazuje jen nejbližší čekající (a kolik jich). */
const MAX_ROWS = 10;

/** Zelený checkmark: časový test celé pozice splněn. */
function CheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="inline size-4 text-success"
      role="img"
      aria-label="časový test splněn"
    >
      <path
        d="M3 8.5 6.5 12 13 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PositionsTable({
  positions,
  labels,
  names,
  embedded = false,
  basePath = '',
}: {
  positions: Position[];
  labels: Map<string, string>;
  names: Map<string, string>;
  /** Bez vlastní karty a titulku — pro vložení do sekce s jednotným nadpisem. */
  embedded?: boolean;
  /** Prefix odkazů na detail pozice ('' pro aplikaci, '/demo' pro demo). */
  basePath?: string;
}) {
  const rows: Row[] = positions
    .map((position) => {
      // A2-3-04: pozice bez nároku na osvobození (obchodní majetek, stablecoiny,
      // deriváty, období bez krypto osvobození) nesmí ukazovat odpočet ani
      // „vše bez daně“ — čeká se u nich na něco, co nikdy nepřijde
      const label = labels.get(position.isin) ?? position.isin;
      const neverExempt = position.lots.every((lot) => !lot.exemptionPossible);
      const pending = position.lots.filter((lot) => lot.exemptionPossible && !lot.isExempt);
      const nearest = pending.length
        ? pending.reduce((a, b) => (a.exemptFrom < b.exemptFrom ? a : b))
        : null;
      return {
        isin: position.isin,
        label,
        // název shodný se zkratkou by se v řádku jen opakoval
        name: names.get(position.isin) === label ? undefined : names.get(position.isin),
        total: position.totalRemaining.toNumber(),
        exemptQty: position.lots
          .filter((lot) => lot.isExempt)
          .reduce((sum, lot) => sum + lot.remaining.toNumber(), 0),
        neverExempt,
        nearestExemptFrom: nearest?.exemptFrom ?? null,
        daysToExempt: nearest?.daysToExempt ?? null,
      };
    })
    .sort((a, b) => (a.nearestExemptFrom ?? '0').localeCompare(b.nearestExemptFrom ?? '0'));

  // Horizont se ptá „co se osvobodí nejdřív“ — u většího portfolia proto
  // tabulka ukáže jen nejbližší čekající pozice a zbytek shrne jednou větou
  // s odkazem na portfolio. Dřív vypsala všechno (demo: 52 řádků) a zbytek
  // přehledu odjel o dvě obrazovky níž, přitom úplný seznam s hledáním
  // a řazením už portfolio má (R1B-18). Malé portfolio se vypíše celé.
  const pendingRows = rows.filter((row) => row.nearestExemptFrom !== null);
  const condensed = rows.length > MAX_ROWS;
  const shown = condensed ? pendingRows.slice(0, MAX_ROWS) : rows;
  const morePending = condensed ? pendingRows.length - shown.length : 0;
  const allExempt = rows.filter((row) => !row.neverExempt && row.nearestExemptFrom === null);
  const never = rows.filter((row) => row.neverExempt);
  const rest = condensed
    ? [
        morePending > 0
          ? `${morePending} ${plural(morePending, 'další čeká', 'další čekají', 'dalších čeká')}`
          : null,
        allExempt.length > 0
          ? `${allExempt.length} ${plural(allExempt.length, 'pozice je už celá', 'pozice jsou už celé', 'pozic je už celých')} bez daně`
          : null,
        never.length > 0 ? `u ${never.length} se časový test nevztahuje` : null,
      ].filter((part): part is string => part !== null)
    : [];

  // E2: sloupec „Z toho bez daně“ jen když má co říct — samé nuly nese
  // už KPI „Bez daně už dnes“ (0 %)
  const anyExempt = shown.some((row) => row.exemptQty > 0);

  const content = (
    <>
      {/* mobil: karty místo tabulky (H4) */}
      <ul className={cn('divide-y divide-line/70 md:hidden', shown.length === 0 && 'hidden')}>
        {shown.map((row) => (
          <li key={row.isin}>
            <PositionCard
              isin={row.isin}
              basePath={basePath}
              label={row.label}
              name={row.name}
              primaryText={`${qty(row.total)} ks`}
              exemptText={
                row.neverExempt
                  ? 'časový test se nevztahuje'
                  : row.nearestExemptFrom === null
                    ? 'vše bez daně'
                    : row.exemptQty > 0
                      ? `${qty(row.exemptQty)} ks bez daně`
                      : `bez daně od ${czDate(row.nearestExemptFrom)}`
              }
              exemptDone={!row.neverExempt && (row.nearestExemptFrom === null || row.exemptQty > 0)}
            />
          </li>
        ))}
      </ul>

      <ScrollArea
        label="Pozice a jejich časové testy"
        className={shown.length === 0 ? 'hidden' : 'hidden md:block'}
      >
        <Table>
          {/* caption = název tabulky pro čtečku (audit H2-12); vizuálně ho nese
              nadpis sekce nad ní, proto sr-only. `scope="col"` (dává ho `Th`)
              váže buňky na hlavičku i tam, kde si to prohlížeč sám neodvodí. */}
          <caption className="sr-only">Pozice a jejich časové testy</caption>
          <thead>
            <tr>
              <Th>Instrument</Th>
              <Th align="right">Kusů</Th>
              {anyExempt && <Th align="right">Z toho bez daně</Th>}
              <Th align="right">Nejbližší osvobození</Th>
              <Th align="right">Zbývá dní</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <Tr key={row.isin}>
                <Td>
                  {/* klikací konzistentně s tabulkou na /portfolio */}
                  <Link
                    href={`${basePath}/portfolio/${row.isin}`}
                    className="font-medium text-ink hover:text-accent-text"
                  >
                    {row.label}
                  </Link>{' '}
                  <span className="type-caption text-ink-muted">
                    {row.name ? `${row.name} · ` : ''}
                    {row.isin}
                  </span>
                </Td>
                <Td align="right">{qty(row.total)}</Td>
                {anyExempt && (
                  <Td
                    align="right"
                    className={
                      row.exemptQty > 0 ? 'font-medium text-success-text' : 'text-ink-muted'
                    }
                  >
                    {qty(row.exemptQty)}
                  </Td>
                )}
                <Td align="right">
                  {row.neverExempt ? (
                    <span className="text-ink-muted">časový test se nevztahuje</span>
                  ) : row.nearestExemptFrom ? (
                    czDate(row.nearestExemptFrom)
                  ) : (
                    <span className="font-medium text-success-text">vše bez daně</span>
                  )}
                </Td>
                <Td align="right">
                  {row.neverExempt ? (
                    <span className="text-ink-muted">—</span>
                  ) : row.daysToExempt === null ? (
                    <CheckIcon />
                  ) : (
                    row.daysToExempt.toLocaleString('cs-CZ')
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </ScrollArea>
      {condensed && (
        <div className="type-footnote flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-ink-muted">
          {/* věta začíná velkým písmenem, ať je první kterákoli část */}
          <p>{rest.length > 0 && `${rest.join(' · ').replace(/^./, (c) => c.toUpperCase())}.`}</p>
          <TextLink href={`${basePath}/portfolio`} chevron>
            Všechny pozice v portfoliu
          </TextLink>
        </div>
      )}
    </>
  );

  if (embedded) return <div className="space-y-3">{content}</div>;

  return (
    <Card className="space-y-3">
      <CardTitle>Pozice ({rows.length})</CardTitle>
      {content}
    </Card>
  );
}
