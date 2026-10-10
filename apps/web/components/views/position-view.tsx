import Link from 'next/link';
import { AppToolbar } from '@/components/app-toolbar';
import { buttonVariants } from '@/components/ui/button';
import { InfoPopover } from '@/components/ui/info-popover';
import { Group, Row } from '@/components/ui/list';
import { Section } from '@/components/ui/section';
import { Stat } from '@/components/ui/stat';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { czk, czDate, money, plural, qty, signedPct } from '@/lib/format';
import { instrumentNames, type YearAnalysis } from '@/lib/portfolio';
import { valuePositions } from '@/lib/portfolio-value';
import type { InstrumentPrice } from '@/lib/prices';
import { tidy } from '@/lib/typography';
import { cn } from '@/lib/utils';
import { ZERO, type Transaction } from '@danero/shared';
import type { PositionLot } from '@danero/engine';

/** Popis transakce pro historii pozice (jen typy, které se ISIN týkají). */
function describeTx(tx: {
  type: string;
  [key: string]: unknown;
}): { date: string; text: string } | null {
  switch (tx.type) {
    case 'BUY':
      return {
        date: String(tx.tradeDate),
        text: `Nákup ${qty(tx.quantity as never)} ks po ${money(tx.pricePerShare as never, String(tx.currency))}`,
      };
    case 'SELL':
      return {
        date: String(tx.tradeDate),
        text: `Prodej ${qty(tx.quantity as never)} ks po ${money(tx.pricePerShare as never, String(tx.currency))}`,
      };
    case 'DIVIDEND':
      return {
        date: String(tx.date),
        text: `Dividenda ${money(tx.gross as never, String(tx.currency))} (srážka ${money(tx.withholdingTax as never, String(tx.currency))})`,
      };
    case 'CORPORATE_ACTION':
      // H-3-14: sousední větve téhož `switch` jsou česky, tahle tiskla surový
      // enum („Korporátní akce (SPINOFF)"). Neznámý druh radši opíšeme, než
      // abychom ho zamlčeli — ale česky pojmenované musí být to, co umíme.
      return {
        date: String(tx.date),
        text: `Korporátní akce: ${KORPORATNI_AKCE[String(tx.subtype)] ?? String(tx.subtype)}`,
      };
    case 'TRANSFER_IN':
      return { date: String(tx.date), text: `Převod na účet: ${qty(tx.quantity as never)} ks` };
    case 'TRANSFER_OUT':
      return { date: String(tx.date), text: `Převod z účtu: ${qty(tx.quantity as never)} ks` };
    default:
      return null;
  }
}

/** Druhy korporátních akcí česky — klíče jsou hodnoty `subtype` z modelu. */
const KORPORATNI_AKCE: Record<string, string> = {
  SPLIT: 'štěpení akcií',
  REVERSE_SPLIT: 'zpětné štěpení akcií',
  SPINOFF: 'oddělení části firmy (spin-off)',
  MERGER: 'fúze',
  ISIN_CHANGE: 'změna identifikátoru cenného papíru',
  DELISTING: 'stažení z burzy',
};

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

const daysText = (days: number): string => `za ${days} ${plural(days, 'den', 'dny', 'dní')}`;

/**
 * Stav časového testu jednoho nákupu. U pozice bez nároku (obchodní majetek,
 * stablecoin, derivát) by datum i odpočet slibovaly osvobození, které nikdy
 * nepřijde (A2-3-04) — proto „nevztahuje se“.
 */
function LotStatus({ lot, stacked = false }: { lot: PositionLot; stacked?: boolean }) {
  if (!lot.exemptionPossible) return <span className="text-ink-muted">nevztahuje se</span>;
  if (lot.isExempt) return <span className="font-medium text-success-text">už bez daně</span>;
  return (
    // v tabulce stojí odpočet před datem, aby data lícovala na pravý okraj
    <span className={stacked ? 'flex flex-col-reverse' : undefined}>
      <span className={cn('type-footnote text-ink-muted', !stacked && 'mr-2')}>
        {daysText(lot.daysToExempt)}
      </span>
      <span>{czDate(lot.exemptFrom)}</span>
    </span>
  );
}

/**
 * Sdílené tělo detailu pozice: čisté výpočty nad hotovou analýzou.
 * `basePath` směruje odkazy ('' pro aplikaci, '/demo' pro demo).
 *
 * Skladba shora dolů:
 * 1. cesta zpět na portfolio,
 * 2. odpověď — kolik kusů jde dnes prodat bez daně (jedna věta) a vedle ní
 *    hodnota, výsledek prodeje dnes a den, kdy se osvobodí další kusy,
 * 3. vedle sebe: nákupy s jejich časovými testy | historie transakcí.
 * Hlavní akce stránky je simulace prodeje — ta spočítá i dopad na limity.
 */
export function PositionView({
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

  const lots = position
    ? [...position.lots].sort((a, b) => a.acquisitionDate.localeCompare(b.acquisitionDate))
    : [];
  const pending = lots.filter((lot) => lot.exemptionPossible && !lot.isExempt);
  const nearest = pending.length
    ? pending.reduce((a, b) => (a.exemptFrom < b.exemptFrom ? a : b))
    : null;
  const nearestQuantity = nearest
    ? pending
        .filter((lot) => lot.exemptFrom === nearest.exemptFrom)
        .reduce((sum, lot) => sum.plus(lot.remaining), ZERO)
    : ZERO;
  const exemptQuantity = valuation?.exemptQuantity ?? ZERO;

  // Odpověď jednou větou: stav časového testu celé pozice.
  let verdict: string;
  let verdictPositive = false;
  if (!position) {
    verdict = 'Pozice je uzavřená';
  } else if (lots.every((lot) => !lot.exemptionPossible)) {
    verdict = 'Časový test se na tuhle pozici nevztahuje';
  } else if (exemptQuantity.gte(position.totalRemaining)) {
    verdict = 'Celá pozice je bez daně';
    verdictPositive = true;
  } else if (exemptQuantity.gt(0)) {
    verdict = `${qty(exemptQuantity)} z ${qty(position.totalRemaining)} ks je bez daně`;
    verdictPositive = true;
  } else if (nearest) {
    // jediný termín pro všechny kusy, nebo jen první z několika
    const single = pending.every((lot) => lot.exemptFrom === nearest.exemptFrom);
    verdict = `${single ? 'Bez daně' : 'První kusy bez daně'} od ${czDate(nearest.exemptFrom)}`;
  } else {
    verdict = 'Zatím nic bez daně';
  }

  const subtitle = [fullName && fullName !== label ? fullName : null, isin !== label ? isin : null]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return (
    <>
      <AppToolbar
        title={label}
        actions={
          position && (
            <Link
              href={`${basePath}/simulator?isin=${encodeURIComponent(isin)}`}
              className={buttonVariants({ variant: 'primary', size: 'sm' })}
            >
              Simulovat prodej
            </Link>
          )
        }
      />
      <div className="@container max-w-[72rem] pt-0 md:pt-1">
        {/* cesta zpět patří do <nav> se seznamem — jako odstavec ji čtečka
            přečte jako běžný text a nenabídne ji mezi navigacemi */}
        <nav aria-label="Drobečková navigace" className="-mt-2">
          <ol>
            <li>
              <Link
                href={`${basePath}/portfolio`}
                className="type-callout inline-flex min-h-11 items-center gap-1 font-medium text-accent-text hover:underline active:opacity-60"
              >
                <span aria-hidden>‹</span>
                Portfolio
              </Link>
            </li>
            <li aria-current="page" className="sr-only">
              {label}
            </li>
          </ol>
        </nav>

        <div className="mt-3 flex flex-wrap items-end gap-x-16 gap-y-7">
          <div className="min-w-0">
            {subtitle && (
              <p className="type-callout break-words tabular-nums text-ink-muted">{subtitle}</p>
            )}
            <h2
              className={cn(
                'type-title-1 mt-2 max-w-[22ch] text-balance',
                verdictPositive && 'text-success-text',
              )}
            >
              {tidy(verdict)}
            </h2>
          </div>

          {position && valuation && (
            <dl className="flex flex-wrap gap-x-12 gap-y-6">
              {valuation.valueCzk ? (
                <Stat
                  label="Hodnota"
                  value={czk(valuation.valueCzk)}
                  note={`${qty(position.totalRemaining)} ks · ${money(valuation.price!, valuation.currency!)} za kus`}
                  info={
                    <InfoPopover label="Hodnota" title="Z čeho hodnota vychází">
                      <p>
                        {tidy(
                          `Poslední cena od brokera${valuation.priceAsOf ? ` k ${czDate(valuation.priceAsOf)}` : ''}, orientačně přepočtená jednotným kurzem roku ${currentYear}.`,
                        )}
                      </p>
                    </InfoPopover>
                  }
                />
              ) : (
                <Stat label="Držíš" value={`${qty(position.totalRemaining)} ks`} />
              )}
              {valuation.unrealized && (
                <Stat
                  label="Zisk/ztráta"
                  tone={valuation.unrealized.gte(0) ? 'success' : 'danger'}
                  value={money(valuation.unrealized, valuation.currency!, true)}
                  note={
                    valuation.unrealizedPct !== undefined
                      ? `${signedPct(valuation.unrealizedPct, 1)} · před zdaněním`
                      : 'před zdaněním'
                  }
                  info={
                    <InfoPopover label="Zisk/ztráta">
                      <p>
                        {tidy(
                          'Rozdíl dnešní hodnoty a nabývací ceny — kolik bys vydělal nebo prodělal prodejem teď, před zdaněním.',
                        )}
                      </p>
                    </InfoPopover>
                  }
                />
              )}
              {nearest &&
                (exemptQuantity.gt(0) ? (
                  <Stat
                    label="Další osvobození"
                    value={czDate(nearest.exemptFrom)}
                    note={`${qty(nearestQuantity)} ks · ${daysText(nearest.daysToExempt)}`}
                  />
                ) : (
                  // datum už nese věta nahoře — vedle ní stačí, kolik zbývá
                  <Stat
                    label="Do osvobození"
                    value={`${nearest.daysToExempt} ${plural(nearest.daysToExempt, 'den', 'dny', 'dní')}`}
                    note={
                      nearestQuantity.lt(position.totalRemaining)
                        ? `${qty(nearestQuantity)} z ${qty(position.totalRemaining)} ks`
                        : undefined
                    }
                  />
                ))}
            </dl>
          )}
        </div>

        <div className="mt-14 grid gap-x-(--column-gap) gap-y-14 @5xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {position && (
            <Section
              title="Nákupy"
              count={lots.length}
              info={
                <InfoPopover label="Nákupy" title="Nákupy a časový test" align="start">
                  <p>
                    {tidy(
                      'Každý nákup má vlastní tříletý časový test. Jakmile doběhne, je prodej těch kusů osvobozený od daně bez ohledu na limity.',
                    )}
                  </p>
                  <p>
                    {tidy(
                      'Které kusy se prodají dřív a co prodej udělá s letošními limity, spočítá simulátor.',
                    )}
                  </p>
                </InfoPopover>
              }
            >
              {/* telefon: seznam — čtyři sloupce by se na 360 px nevešly */}
              <Group className="@2xl:hidden" aria-label="Nákupy a jejich časové testy">
                {lots.map((lot) => (
                  <Row
                    key={lot.lotId}
                    label={
                      <span className="tabular-nums">
                        {czDate(lot.acquisitionDate)}
                        {lot.interpretive && ' *'}
                      </span>
                    }
                    hint={
                      <span className="tabular-nums">
                        {qty(lot.remaining)} ks · {money(lot.costPerShare, position.currency)} za
                        kus
                      </span>
                    }
                    value={<LotStatus lot={lot} stacked />}
                  />
                ))}
              </Group>

              <div className="hidden @2xl:block">
                <Table aria-label="Nákupy a jejich časové testy">
                  <thead>
                    <tr>
                      <Th>Nabytí</Th>
                      <Th align="right">Kusů</Th>
                      <Th align="right">Cena za kus</Th>
                      <Th align="right">Bez daně od</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {lots.map((lot) => (
                      <Tr key={lot.lotId}>
                        <Td>
                          {czDate(lot.acquisitionDate)}
                          {lot.interpretive && ' *'}
                        </Td>
                        <Td align="right">{qty(lot.remaining)}</Td>
                        <Td align="right" className="whitespace-nowrap">
                          {money(lot.costPerShare, position.currency)}
                        </Td>
                        <Td align="right" className="whitespace-nowrap">
                          <LotStatus lot={lot} />
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>

              {lots.some((lot) => lot.interpretive) && (
                <p className="type-caption pt-2 text-ink-muted">
                  * Datum nabytí vychází z výkladu korporátní akce — podrobnosti jsou v reportu.
                </p>
              )}
            </Section>
          )}

          <Section title="Historie" count={history.length}>
            <Group aria-label="Historie transakcí">
              {history.map((item, index) => (
                <Row
                  key={`${item.date}-${index}`}
                  label={item.text}
                  value={<span className="type-footnote text-ink-muted">{czDate(item.date)}</span>}
                />
              ))}
            </Group>
          </Section>
        </div>
      </div>
    </>
  );
}
