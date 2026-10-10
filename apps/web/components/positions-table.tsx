import Link from 'next/link';
import type { Position } from '@danero/engine';
import { czDate, qty } from '@/lib/format';
import { Card, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { PositionCard } from '@/components/position-card';

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

/** Délka 3letého časového testu ve dnech — pro mini progress „Zbývá dní“. */
const TEST_DAYS = 3 * 365;

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

/** Mini progress uplynulé části časového testu (uplynulo / 1095 dní). */
function TestProgress({ daysToExempt }: { daysToExempt: number }) {
  const elapsed = Math.min(1, Math.max(0, (TEST_DAYS - daysToExempt) / TEST_DAYS));
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="h-1 w-12 overflow-hidden rounded-full bg-line/60">
        <span
          className="block h-full rounded-full bg-accent"
          style={{ width: `${elapsed * 100}%` }}
        />
      </span>
      {daysToExempt.toLocaleString('cs-CZ')}
    </span>
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
      const neverExempt = position.lots.every((lot) => !lot.exemptionPossible);
      const pending = position.lots.filter((lot) => lot.exemptionPossible && !lot.isExempt);
      const nearest = pending.length
        ? pending.reduce((a, b) => (a.exemptFrom < b.exemptFrom ? a : b))
        : null;
      return {
        isin: position.isin,
        label: labels.get(position.isin) ?? position.isin,
        name: names.get(position.isin),
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

  // E2: sloupec „Z toho bez daně“ jen když má co říct — samé nuly nese
  // už KPI „Bez daně už dnes“ (0 %)
  const anyExempt = rows.some((row) => row.exemptQty > 0);

  const content = (
    <>
      {/* mobil: karty místo tabulky (H4) */}
      <div className="divide-y divide-line/70 md:hidden">
        {rows.map((row) => (
          <PositionCard
            key={row.isin}
            isin={row.isin}
            basePath={basePath}
            label={row.label}
            name={row.name}
            primaryText={`${qty(row.total)} ks`}
            secondaryText={row.exemptQty > 0 ? `${qty(row.exemptQty)} ks bez daně` : undefined}
            exemptText={
              row.neverExempt
                ? 'časový test se nevztahuje'
                : row.nearestExemptFrom
                  ? `bez daně od ${czDate(row.nearestExemptFrom)}`
                  : 'vše bez daně'
            }
            exemptDone={!row.neverExempt && row.nearestExemptFrom === null}
          />
        ))}
      </div>

      <ScrollArea label="Pozice a jejich časové testy" className="hidden md:block">
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
            {rows.map((row) => (
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
                    className={row.exemptQty > 0 ? 'font-medium text-success-text' : 'text-ink-muted'}
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
                    <TestProgress daysToExempt={row.daysToExempt} />
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </ScrollArea>
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
