import Link from 'next/link';
import { Card, CardTitle } from '@/components/ui/card';
import { czk, czDate, money, qty, signedPct } from '@/lib/format';
import { instrumentNames, type YearAnalysis } from '@/lib/portfolio';
import { valuePositions } from '@/lib/portfolio-value';
import type { InstrumentPrice } from '@/lib/prices';
import type { Transaction } from '@danero/shared';
import { buttonVariants } from '@/components/ui/button';

/** Popis transakce pro historii pozice (jen typy, které se ISIN týkají). */
function describeTx(tx: {
  type: string;
  [key: string]: unknown;
}): { date: string; text: string } | null {
  switch (tx.type) {
    case 'BUY':
      return {
        date: String(tx.tradeDate),
        text: `Nákup ${qty(tx.quantity as never)} ks @ ${money(tx.pricePerShare as never, String(tx.currency))}`,
      };
    case 'SELL':
      return {
        date: String(tx.tradeDate),
        text: `Prodej ${qty(tx.quantity as never)} ks @ ${money(tx.pricePerShare as never, String(tx.currency))}`,
      };
    case 'DIVIDEND':
      return {
        date: String(tx.date),
        text: `Dividenda ${money(tx.gross as never, String(tx.currency))} (srážka ${money(tx.withholdingTax as never, String(tx.currency))})`,
      };
    case 'CORPORATE_ACTION':
      return { date: String(tx.date), text: `Korporátní akce (${String(tx.subtype)})` };
    case 'TRANSFER_IN':
      return { date: String(tx.date), text: `Převod na účet: ${qty(tx.quantity as never)} ks` };
    case 'TRANSFER_OUT':
      return { date: String(tx.date), text: `Převod z účtu: ${qty(tx.quantity as never)} ks` };
    default:
      return null;
  }
}

/** Historie transakcí ISIN (nejnovější první) — pro view i kontrolu existence. */
export function positionHistory(
  txs: Transaction[],
  isin: string,
): Array<{ date: string; text: string }> {
  return txs
    .filter((tx) => 'isin' in tx && tx.isin === isin)
    .map((tx) => describeTx(tx as never))
    .filter((item): item is { date: string; text: string } => item !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Sdílené tělo detailu pozice: loty s časovými testy, ocenění a historie —
 * čisté výpočty nad hotovou analýzou. `basePath` směruje odkazy
 * ('' pro aplikaci, '/demo' pro demo).
 */
export function PoziceView({
  isin,
  txs,
  analysis,
  prices,
  today,
  basePath = '',
}: {
  isin: string;
  txs: Transaction[];
  analysis: YearAnalysis;
  prices: Map<string, InstrumentPrice>;
  today: string;
  basePath?: string;
}) {
  const { positions, labels } = analysis;
  const currentYear = Number(today.slice(0, 4));
  const position = positions.find((p) => p.isin === isin);

  const valuation = position
    ? valuePositions([position], labels, instrumentNames(txs), prices, currentYear).rows[0]!
    : null;

  const history = positionHistory(txs, isin);
  const label = labels.get(isin) ?? isin;
  const fullName = instrumentNames(txs).get(isin);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-inkoust-tlumeny">
            <Link href={`${basePath}/portfolio`} className="hover:text-ruzova">
              Portfolio
            </Link>{' '}
            / {label}
          </p>
          <h1 className="font-display text-3xl font-bold">
            {label}
            {fullName && fullName !== label && (
              <span className="ml-3 text-lg font-normal text-inkoust-tlumeny">{fullName}</span>
            )}
          </h1>
          <p className="mt-1 font-mono text-xs text-inkoust-tlumeny">{isin}</p>
        </div>
        {position && (
          <Link
            href={`${basePath}/simulator?isin=${encodeURIComponent(isin)}`}
            className={buttonVariants({ variant: 'primary' })}
          >
            Simulovat prodej
          </Link>
        )}
      </header>

      {position ? (
        <section className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardTitle>Držíš</CardTitle>
            <p className="mt-2 font-display text-2xl font-bold">{qty(position.totalRemaining)} ks</p>
            {valuation?.valueCzk && (
              <p className="mt-1 text-xs text-inkoust-tlumeny">
                ≈ {czk(valuation.valueCzk)} (orientačně, cena{' '}
                {money(valuation.price!, valuation.currency!)}
                {valuation.priceAsOf && ` k ${valuation.priceAsOf.toLocaleDateString('cs-CZ')}`})
              </p>
            )}
          </Card>
          <Card>
            <CardTitle>Bez daně už dnes</CardTitle>
            <p className="mt-2 font-display text-2xl font-bold text-zelena">
              {qty(valuation?.exemptQuantity ?? position.totalRemaining.mul(0))} ks
            </p>
            <p className="mt-1 text-xs text-inkoust-tlumeny">
              Kusy po 3letém časovém testu — prodej je osvobozený bez ohledu na limity.
            </p>
          </Card>
          <Card>
            <CardTitle>Nerealizovaný zisk/ztráta</CardTitle>
            <p
              className={`mt-2 font-display text-2xl font-bold ${
                valuation?.unrealized
                  ? valuation.unrealized.gte(0)
                    ? 'text-zelena'
                    : 'text-cervena'
                  : ''
              }`}
            >
              {valuation?.unrealized ? money(valuation.unrealized, valuation.currency!, true) : '—'}
            </p>
            <p className="mt-1 text-xs text-inkoust-tlumeny">
              {valuation?.unrealizedPct !== undefined
                ? `${signedPct(valuation.unrealizedPct, 1)} proti nabývací ceně — `
                : ''}
              kolik bys vydělal/prodělal prodejem teď, před zdaněním.
            </p>
          </Card>
        </section>
      ) : (
        <Card>
          <p className="text-sm text-inkoust-tlumeny">
            Pozice je uzavřená — níž zůstává kompletní historie.
          </p>
        </Card>
      )}

      {position && (
        <Card className="space-y-2">
          <CardTitle>Nákupy (loty) a časové testy</CardTitle>
          <div className="scroll-stiny overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-inkoust-tlumeny">
                  <th className="py-2 pr-4">Nabytí</th>
                  <th className="py-2 pr-4 text-right">Kusů</th>
                  <th className="py-2 pr-4 text-right">Cena/ks</th>
                  <th className="py-2 pr-4">Bez daně od</th>
                  <th className="py-2 text-right">Zbývá dní</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {position.lots.map((lot) => (
                  <tr key={lot.lotId} className="border-t border-linka">
                    <td className="py-2 pr-4">{czDate(lot.acquisitionDate)}</td>
                    <td className="py-2 pr-4 text-right">{qty(lot.remaining)}</td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right">
                      {money(lot.costPerShare, position.currency)}
                    </td>
                    <td className="py-2 pr-4">
                      {lot.isExempt ? (
                        <span className="font-medium text-zelena-text">už bez daně</span>
                      ) : (
                        czDate(lot.exemptFrom)
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {lot.isExempt ? '—' : lot.daysToExempt}
                      {lot.interpretive && (
                        <span title="Datum nabytí vychází z výkladu (fúze/spin-off)"> *</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {position.lots.some((lot) => lot.interpretive) && (
            <p className="text-xs text-inkoust-tlumeny">
              * datum nabytí vychází z výkladu korporátní akce (detail v reportu).
            </p>
          )}
        </Card>
      )}

      <Card className="space-y-2">
        <CardTitle>Historie ({history.length})</CardTitle>
        <ul className="space-y-1">
          {history.map((item, index) => (
            <li
              key={`${item.date}-${index}`}
              className="flex flex-wrap items-baseline gap-3 border-t border-linka py-2 text-sm first:border-t-0"
            >
              <span className="font-mono text-xs text-inkoust-tlumeny">{czDate(item.date)}</span>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
