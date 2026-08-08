import Link from 'next/link';
import type { Position } from '@danero/engine';
import { czDate, qty } from '@/lib/format';
import { Card, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PositionCard } from '@/components/position-card';
import { cn } from '@/lib/utils';

interface Row {
  isin: string;
  label: string;
  name?: string;
  total: number;
  exemptQty: number;
  nearestExemptFrom: string | null;
  daysToExempt: number | null;
}

/** Délka 3letého časového testu ve dnech — pro mini progress „Zbývá dní“. */
const TEST_DAYS = 3 * 365;

/** Zelený checkmark: časový test celé pozice splněn. */
function CheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="inline size-4 text-zelena"
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
      <span aria-hidden className="h-1 w-12 overflow-hidden rounded-full bg-linka/60">
        <span
          className="block h-full rounded-full bg-ruzova"
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
      const pending = position.lots.filter((lot) => !lot.isExempt);
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
      <div className="space-y-2 md:hidden">
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
              row.nearestExemptFrom
                ? `bez daně od ${czDate(row.nearestExemptFrom)}`
                : 'vše bez daně'
            }
            exemptDone={row.nearestExemptFrom === null}
          />
        ))}
      </div>

      <ScrollArea label="Pozice a jejich časové testy" className="hidden md:block">
        <table className="w-full text-sm">
          {/* caption = název tabulky pro čtečku (audit H2-12); vizuálně ho nese
              CardTitle nad ní, proto sr-only. `scope="col"` váže buňky
              na hlavičku i tam, kde si to prohlížeč sám neodvodí. */}
          <caption className="sr-only">Pozice a jejich časové testy</caption>
          <thead>
            <tr className="border-b border-linka text-left text-xs uppercase tracking-wide text-inkoust-tlumeny">
              <th scope="col" className="py-2 pr-4 font-medium">
                Instrument
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Kusů
              </th>
              {anyExempt && (
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  Z toho bez daně
                </th>
              )}
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Nejbližší osvobození
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Zbývá dní
              </th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((row) => (
              <tr key={row.isin} className="border-b border-linka/60">
                <td className="py-2 pr-4">
                  {/* klikací konzistentně s tabulkou na /portfolio */}
                  <Link
                    href={`${basePath}/portfolio/${row.isin}`}
                    className="font-sans font-medium text-inkoust hover:text-ruzova"
                  >
                    {row.label}
                  </Link>{' '}
                  <span className="text-xs text-inkoust-tlumeny">
                    {row.name ? `${row.name} · ` : ''}
                    {row.isin}
                  </span>
                </td>
                <td className="py-2 pr-4 text-right">{qty(row.total)}</td>
                {anyExempt && (
                  <td
                    className={cn(
                      'py-2 pr-4 text-right',
                      row.exemptQty > 0 ? 'font-semibold text-zelena-text' : 'text-inkoust-tlumeny',
                    )}
                  >
                    {qty(row.exemptQty)}
                  </td>
                )}
                <td className="py-2 pr-4 text-right">
                  {row.nearestExemptFrom ? (
                    czDate(row.nearestExemptFrom)
                  ) : (
                    <span className="font-sans font-semibold text-zelena-text">vše bez daně</span>
                  )}
                </td>
                <td className="py-2 text-right">
                  {row.daysToExempt === null ? (
                    <CheckIcon />
                  ) : (
                    <TestProgress daysToExempt={row.daysToExempt} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
