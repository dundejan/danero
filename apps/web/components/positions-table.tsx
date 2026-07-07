import type { Position } from '@danero/engine';
import { czDate, qty } from '@/lib/format';
import { Card, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface Row {
  isin: string;
  label: string;
  total: number;
  exemptQty: number;
  nearestExemptFrom: string | null;
  daysToExempt: number | null;
}

export function PositionsTable({
  positions,
  labels,
}: {
  positions: Position[];
  labels: Map<string, string>;
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
        total: position.totalRemaining.toNumber(),
        exemptQty: position.lots
          .filter((lot) => lot.isExempt)
          .reduce((sum, lot) => sum + lot.remaining.toNumber(), 0),
        nearestExemptFrom: nearest?.exemptFrom ?? null,
        daysToExempt: nearest?.daysToExempt ?? null,
      };
    })
    .sort((a, b) => (a.nearestExemptFrom ?? '0') < (b.nearestExemptFrom ?? '0') ? -1 : 1);

  return (
    <Card className="space-y-3">
      <CardTitle>Pozice ({rows.length})</CardTitle>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-linka text-left text-xs uppercase tracking-wide text-inkoust-tlumeny">
              <th className="py-2 pr-4 font-medium">Instrument</th>
              <th className="py-2 pr-4 text-right font-medium">Kusů</th>
              <th className="py-2 pr-4 text-right font-medium">Z toho bez daně</th>
              <th className="py-2 pr-4 text-right font-medium">Nejbližší osvobození</th>
              <th className="py-2 text-right font-medium">Zbývá dní</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((row) => (
              <tr key={row.isin} className="border-b border-linka/60">
                <td className="py-2 pr-4">
                  <span className="font-sans font-medium">{row.label}</span>{' '}
                  <span className="text-xs text-inkoust-tlumeny">{row.isin}</span>
                </td>
                <td className="py-2 pr-4 text-right">{qty(row.total)}</td>
                <td
                  className={cn(
                    'py-2 pr-4 text-right',
                    row.exemptQty > 0 ? 'font-semibold text-zelena' : 'text-inkoust-tlumeny',
                  )}
                >
                  {qty(row.exemptQty)}
                </td>
                <td className="py-2 pr-4 text-right">
                  {row.nearestExemptFrom ? (
                    czDate(row.nearestExemptFrom)
                  ) : (
                    <span className="font-sans font-semibold text-zelena">vše osvobozeno</span>
                  )}
                </td>
                <td className="py-2 text-right">{row.daysToExempt ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
