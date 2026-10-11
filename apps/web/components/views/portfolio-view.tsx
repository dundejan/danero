import Link from 'next/link';
import { AppToolbar } from '@/components/app-toolbar';
import {
  DividendsByMonthChart,
  ExemptionOutlookChart,
  FeesByYearChart,
  RealizedByYearChart,
} from '@/components/charts';
import {
  PositionsExplorer,
  type ExemptState,
  type ExplorerRow,
} from '@/components/positions-explorer';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { InfoPopover } from '@/components/ui/info-popover';
import { TextLink } from '@/components/ui/link';
import { Notice } from '@/components/ui/notice';
import { Section } from '@/components/ui/section';
import { Group, Row } from '@/components/ui/list';
import { Stat } from '@/components/ui/stat';
import { YearSwitcher } from '@/components/year-switcher';
import {
  dividendsByMonth,
  exemptionOutlook,
  feesByYear,
  OUTLOOK_BASIS_LABEL,
  outlookBasisNote,
  portfolioAllocation,
  realizedGainsByYear,
} from '@/lib/charts-data';
import { exemptToday as exemptTodayOf } from '@/lib/exempt-today';
import { czDate, czk, money, pct, plural, profitLoss, qty, signedPct } from '@/lib/format';
import {
  engineInputForUser,
  instrumentNames,
  type ProfileRow,
  type YearAnalysis,
} from '@/lib/portfolio';
import { valuePositions } from '@/lib/portfolio-value';
import type { InstrumentPrice } from '@/lib/prices';
import { tidy } from '@/lib/typography';
import { ZERO, type Transaction } from '@danero/shared';
import { analyzeTaxYear, EngineError, type EngineInput, type TaxYearResult } from '@danero/engine';

/** Kolik nákupů ukáže inspektor; zbytek je na detailu pozice. */
const INSPECTOR_LOTS = 4;

const daysText = (days: number): string => `za ${days} ${plural(days, 'den', 'dny', 'dní')}`;

/**
 * Sdílené tělo portfolia: čisté výpočty (ocenění, grafy, řádky tabulky) nad
 * hotovou analýzou — data dodá reálná stránka z DB, demo z ukázkového datasetu.
 * `basePath` směruje odkazy ('' pro aplikaci, '/demo' pro demo).
 *
 * Skladba shora dolů (docs/07, vzor „stránka aplikace“):
 * 1. odpověď — kolik portfolio stojí, kolik z něj jde dnes prodat bez daně
 *    a kdy se osvobodí další kusy,
 * 2. pozice — tabulka s hledáním, řazením a inspektorem vybraného řádku
 *    (na telefonu seznam; detail je o úroveň hlouběji),
 * 3. otevřené deriváty (jen když nějaké jsou),
 * 4. výhled osvobození a historie: dividendy, realizovaný výsledek, poplatky.
 *
 * Rok se přepíná jen u dividend — pozice, hodnota i časové testy jsou vždy
 * k dnešku, takže přepínač v liště by sliboval pohled, který neexistuje.
 */
export function PortfolioView({
  txs,
  profile,
  analysis,
  prices,
  years,
  year,
  today,
  dailyRates,
  basePath = '',
}: {
  txs: Transaction[];
  profile: ProfileRow;
  analysis: YearAnalysis;
  prices: Map<string, InstrumentPrice>;
  years: number[];
  year: number;
  today: string;
  dailyRates?: EngineInput['dailyRates'];
  basePath?: string;
}) {
  const { result, positions, labels } = analysis;
  const currentYear = Number(today.slice(0, 4));
  const names = instrumentNames(txs);
  const valuation = valuePositions(positions, labels, names, prices, currentYear);

  // realizované P/L: engine per rok (čistá funkce nad týmiž transakcemi);
  // chybějící kurz v NEvybraném roce nesmí shodit stránku mimo page-guard —
  // rok se z grafu vynechá (vybraný rok hlídá guard stránky)
  const resultsByYear = new Map<number, TaxYearResult>();
  for (const y of years) {
    if (y === year) {
      resultsByYear.set(y, result);
      continue;
    }
    try {
      resultsByYear.set(y, analyzeTaxYear(engineInputForUser(txs, profile, y, dailyRates)));
    } catch (error) {
      if (!(error instanceof EngineError)) throw error;
    }
  }
  const realized = realizedGainsByYear(resultsByYear);
  const dividends = dividendsByMonth(result);
  const fees = feesByYear(txs);
  const outlook = exemptionOutlook(positions, prices, today, currentYear);
  const allocation = portfolioAllocation(valuation);
  const shareByIsin = new Map(allocation?.slices.map((slice) => [slice.isin, slice.share]));
  const hasPrices = valuation.pricedCount > 0;

  // Otevřené deriváty počítá engine ke konci analyzovaného roku. Stránka je
  // ukazuje jako dnešní stav, takže je bere z běžného roku — ne z roku, který
  // si člověk přepnul u dividend.
  const openDerivatives = (resultsByYear.get(currentYear) ?? result).derivatives.openPositions;

  /* ── řádky tabulky ──────────────────────────────────────────────────────
     Server předpočítá texty i čísla pro řazení; přes hranici klienta nejde
     žádný Decimal. */

  const byIsin = new Map(positions.map((position) => [position.isin, position]));
  // nejbližší konec časového testu napříč portfoliem — číslo nahoře na stránce
  let nextExemption: { isin: string; exemptFrom: string; days: number } | null = null;

  const explorerRows: ExplorerRow[] = valuation.rows.map((row) => {
    const lots = byIsin.get(row.isin)?.lots ?? [];
    // A2-3-04: lot bez nároku na osvobození (obchodní majetek, stablecoin,
    // derivát) nesmí vyrobit „nejbližší osvobození“, které nikdy nenastane
    const pending = lots.filter((lot) => lot.exemptionPossible && !lot.isExempt);
    const nearest = pending.length
      ? pending.reduce((a, b) => (a.exemptFrom < b.exemptFrom ? a : b))
      : null;
    if (nearest && (!nextExemption || nearest.exemptFrom < nextExemption.exemptFrom)) {
      nextExemption = {
        isin: row.isin,
        exemptFrom: nearest.exemptFrom,
        days: nearest.daysToExempt,
      };
    }
    const nearestQuantity = nearest
      ? pending
          .filter((lot) => lot.exemptFrom === nearest.exemptFrom)
          .reduce((sum, lot) => sum.plus(lot.remaining), ZERO)
      : null;

    const exemptState: ExemptState = lots.every((lot) => !lot.exemptionPossible)
      ? 'never'
      : row.exemptQuantity.gte(row.quantity)
        ? 'all'
        : row.exemptQuantity.gt(0)
          ? 'part'
          : 'none';
    const rowExemptCzk =
      row.valueCzk && row.quantity.gt(0)
        ? row.valueCzk.mul(row.exemptQuantity).div(row.quantity)
        : null;

    const share = shareByIsin.get(row.isin);
    const sortedLots = [...lots].sort((a, b) => a.acquisitionDate.localeCompare(b.acquisitionDate));

    return {
      isin: row.isin,
      label: row.label,
      name: row.name && row.name !== row.label ? row.name : undefined,
      qtyText: `${qty(row.quantity)} ks`,
      priceText: row.price ? money(row.price, row.currency!) : undefined,
      valueText: row.valueCzk ? czk(row.valueCzk) : undefined,
      // podíl jen z úplně oceněného portfolia — jinak by byl podílem z části
      shareText: share !== undefined && valuation.unpricedCount === 0 ? pct(share, 1) : undefined,
      plText: row.unrealized ? profitLoss(row.unrealized, row.currency!) : undefined,
      plPctText: row.unrealizedPct !== undefined ? signedPct(row.unrealizedPct, 1) : undefined,
      plPositive: row.unrealized ? row.unrealized.gte(0) : undefined,
      exemptState,
      exemptQtyText: row.exemptQuantity.gt(0) ? `${qty(row.exemptQuantity)} ks` : undefined,
      nextExemptText: nearest ? czDate(nearest.exemptFrom) : undefined,
      nextExemptNote:
        nearest && nearestQuantity
          ? `${qty(nearestQuantity)} ks · ${daysText(nearest.daysToExempt)}`
          : undefined,
      lots: sortedLots.slice(0, INSPECTOR_LOTS).map((lot) => ({
        id: lot.lotId,
        dateText: czDate(lot.acquisitionDate),
        qtyText: `${qty(lot.remaining)} ks`,
        state: !lot.exemptionPossible ? 'never' : lot.isExempt ? 'done' : 'pending',
        statusText: !lot.exemptionPossible
          ? 'nevztahuje se'
          : lot.isExempt
            ? 'bez daně'
            : `od ${czDate(lot.exemptFrom)}`,
      })),
      moreLots: Math.max(0, sortedLots.length - INSPECTOR_LOTS),
      sort: {
        label: row.label,
        qty: row.quantity.toNumber(),
        value: row.valueCzk ? row.valueCzk.toNumber() : null,
        pl: row.unrealizedPct ?? null,
        // srovnatelná je hodnota v Kč; bez cen aspoň počet kusů
        exempt: row.exemptQuantity.gt(0) ? (rowExemptCzk ?? row.exemptQuantity).toNumber() : null,
        next: nearest ? Date.parse(nearest.exemptFrom) : null,
      },
    };
  });

  // TypeScript přiřazení uvnitř `map` nesleduje — po cyklu si typ vrátíme
  const next = nextExemption as { isin: string; exemptFrom: string; days: number } | null;

  // „Bez daně už dnes“: částka z oceněných pozic, a kde by byla nulou jen
  // proto, že chybí ceny, počet pozic — pravidla jsou v `lib/exempt-today.ts`.
  const exemptToday = exemptTodayOf(valuation.rows);
  // nákup v datech vůbec není (jen dividendy), nebo je všechno prodané? (R2-19)
  const everHeld = txs.some((tx) => tx.type === 'BUY' || tx.type === 'TRANSFER_IN');

  /* ── odpověď ────────────────────────────────────────────────────────── */

  const answer = (
    // Popisky tří čísel stojí na jedné lince, i když třetí číslo je menší
    // a jen některý popisek má vysvětlivku (R1B-26).
    <dl className="flex flex-wrap items-start gap-x-12 gap-y-7 md:gap-x-16 [&_dt]:min-h-6">
      {hasPrices && (
        <Stat
          size="lg"
          label="Hodnota portfolia"
          value={czk(valuation.totalCzk)}
          note={
            valuation.unpricedCount > 0
              ? `orientačně · ${valuation.unpricedCount} ${plural(valuation.unpricedCount, 'pozice', 'pozice', 'pozic')} bez ceny`
              : valuation.oldestPriceAt
                ? `orientačně, ceny k ${czDate(valuation.oldestPriceAt)}`
                : 'orientačně'
          }
          info={
            <InfoPopover label="Hodnota portfolia" title="Z čeho hodnota vychází">
              <p>
                {tidy(
                  `Poslední ceny od připojeného brokera, přepočtené jednotným kurzem roku ${valuation.fxYear}. Ceny se obnovují při synchronizaci.`,
                )}
              </p>
              {valuation.unpricedCount > 0 && (
                <p>
                  {tidy(
                    `U ${valuation.unpricedCount} ${plural(valuation.unpricedCount, 'pozice', 'pozic', 'pozic')} chybí cena od brokera nebo kurz měny — v součtu nejsou.`,
                  )}
                </p>
              )}
              <p>
                Hodnota je orientační a neslouží jako podklad pro obchodní rozhodnutí. Daňové
                výpočty najdeš v <TextLink href={`${basePath}/report`}>reportu</TextLink>.
              </p>
            </InfoPopover>
          }
        />
      )}
      {exemptToday && (
        <Stat
          size="lg"
          label="Bez daně už dnes"
          // zelená jen pro skutečně pozitivní stav — nula není úspěch
          tone={exemptToday.positive ? 'success' : undefined}
          value={exemptToday.value}
          note={exemptToday.note}
          info={
            <InfoPopover label="Bez daně už dnes" title="Co jde prodat bez daně">
              <p>
                {tidy(
                  'Kusy, které držíš déle než tři roky, mají splněný časový test — jejich prodej je osvobozený od daně bez ohledu na limity.',
                )}
              </p>
              {!hasPrices ? (
                <p>{tidy('Částku umíme jen u pozic s cenou od brokera — bez cen zbývá počet.')}</p>
              ) : (
                exemptToday.missing > 0 && (
                  <p>
                    {tidy(
                      `Částku umíme jen u pozic s cenou od brokera — ${exemptToday.missing} ${plural(exemptToday.missing, 'pozice, která kusy bez daně má', 'pozice, které kusy bez daně mají', 'pozic, které kusy bez daně mají')}, v ní chybí.`,
                    )}
                  </p>
                )
              )}
              <p>
                {tidy('Jak by konkrétní prodej dopadl včetně letošních limitů, spočítá simulátor.')}{' '}
                <TextLink href={`${basePath}/simulator`}>Simulátor</TextLink>
              </p>
            </InfoPopover>
          }
        />
      )}
      {next && (
        <Stat
          label="Nejbližší osvobození"
          value={czDate(next.exemptFrom)}
          // u pozice bez tickeru je popiskem celý název fondu — poznámka pod
          // číslem ho smí zalomit na dva řádky, ne roztáhnout řadu čísel
          note={
            <span className="line-clamp-2 max-w-[18rem] [overflow-wrap:anywhere]">
              {labels.get(next.isin) ?? next.isin} · {daysText(next.days)}
            </span>
          }
        />
      )}
    </dl>
  );

  /* ── výhled a historie ──────────────────────────────────────────────── */

  // křivka má co říct až od dvou budoucích termínů; jediný skok je jen datum,
  // a to už nese číslo „Nejbližší osvobození“ i tabulka
  const showOutlook = outlook !== null && outlook.points.length > 2;
  const outlookNote = outlook ? outlookBasisNote(outlook) : null;
  const showDividends = dividends.totalCzk > 0 || years.length > 1;
  const showRealized = realized.some((bar) => bar.valueCzk !== 0);
  const showFees = fees.bars.length > 0;

  return (
    <>
      <AppToolbar title="Portfolio" />
      <div className="max-w-[72rem] space-y-14 pt-2 md:pt-4">
        {positions.length > 0 && answer}

        {positions.length > 0 && !hasPrices && (
          <Notice
            title="Hodnotu zatím neznáme"
            action={
              // v demu /import nevede nikam — pozvat k registraci
              <TextLink href={basePath ? '/registrace' : '/import'} chevron>
                Připojit brokera
              </TextLink>
            }
          >
            Ceny bereme jen od připojeného brokera, z výpisů je nepoznáme.
          </Notice>
        )}

        <Section
          title="Pozice"
          count={positions.length > 0 ? positions.length : undefined}
          info={
            positions.length > 0 ? (
              <InfoPopover label="Pozice" title="Co sloupce znamenají" align="start">
                <ul>
                  <li>
                    {tidy(
                      'Bez daně dnes — kusy, kterým už doběhl tříletý časový test. Jejich prodej je osvobozený.',
                    )}
                  </li>
                  <li>Další osvobození — den, kdy test doběhne dalším kusům.</li>
                  {hasPrices && (
                    <li>
                      {tidy(
                        'Zisk/ztráta — o kolik je dnešní cena nad nebo pod nabývací, v měně titulu (pohyb kurzu koruny v něm není). Před zdaněním.',
                      )}
                    </li>
                  )}
                </ul>
              </InfoPopover>
            ) : undefined
          }
        >
          {explorerRows.length > 0 ? (
            <PositionsExplorer rows={explorerRows} showValue={hasPrices} basePath={basePath} />
          ) : (
            <EmptyState
              compact
              title="Žádné otevřené pozice"
              action={
                // v demu /import nevede nikam
                !everHeld && !basePath ? (
                  <TextLink href="/import" chevron>
                    Nahrát výpisy
                  </TextLink>
                ) : undefined
              }
            >
              {everHeld
                ? `Všechny pozice jsou prodané.${showDividends || showRealized || showFees ? ' Historie zůstává níž.' : ''}`
                : 'Ve výpisech zatím není žádný nákup — nahraj výpis obchodů.'}
            </EmptyState>
          )}
        </Section>

        {openDerivatives.length > 0 && (
          <Section
            title="Otevřené deriváty"
            info={
              <InfoPopover label="Otevřené deriváty" align="start">
                <p>
                  {tidy(
                    'Opce, futures a CFD jsou samostatný druh příjmu bez osvobození: daní se vždy, bez ohledu na dobu držení i výši tržeb.',
                  )}
                </p>
                <p>Vypsaná znamená prodanou (short) pozici.</p>
              </InfoPopover>
            }
          >
            {/* Pár řádků na šířku tabulky pozic nad nimi (v širokém okně tedy
                bez sloupce inspektoru) — s vlastní šířkou visel počet kontraktů
                uprostřed a s tabulkou nelícoval (R1B-26). Výhrada v patičce
                nesmí zmizet — u derivátů žádné osvobození nečekej. */}
            <div className="@container">
              <div className="gap-x-(--column-gap) @min-[60rem]:grid @min-[60rem]:grid-cols-[minmax(0,1fr)_minmax(0,var(--inspector-width))]">
                <Group
                  footer="Deriváty se daní vždy — časový test ani limity pro ně neplatí."
                  aria-label="Otevřené derivátové pozice"
                >
                  {openDerivatives.map((position) => {
                    const contracts = position.quantity.abs();
                    return (
                      <Row
                        key={position.isin}
                        label={labels.get(position.isin) ?? position.isin}
                        hint={`${position.quantity.lt(0) ? 'vypsaná · ' : ''}otevřeno ${czDate(position.openedAt)}`}
                        value={`${qty(contracts)} ${plural(contracts.toNumber(), 'kontrakt', 'kontrakty', 'kontraktů')}`}
                      />
                    );
                  })}
                </Group>
              </div>
            </div>
          </Section>
        )}

        {(showOutlook || showDividends || showRealized || showFees) && (
          <div className="@container">
            <div className="grid gap-x-(--column-gap) gap-y-14 @3xl:grid-cols-2">
              {showOutlook && (
                // Táž křivka jako pod horizontem na přehledu — proto stejné
                // jméno i barva (R1B-11); tečky po dnech má jen přehled.
                <Section
                  title="Horizont osvobození"
                  info={
                    <InfoPopover label="Horizont osvobození" align="start">
                      <p>
                        {tidy(
                          // u nabývací ceny říká měřítko i důvod hned další věta
                          `Jaký podíl portfolia${outlook.basis === 'cost' ? '' : ` (podle ${OUTLOOK_BASIS_LABEL[outlook.basis]})`} půjde prodat bez daně, když nic nepřikoupíš ani neprodáš.`,
                        )}
                      </p>
                      {outlookNote && <p>{tidy(outlookNote)}</p>}
                      <p>
                        Po dnech a pozicích ho ukazuje{' '}
                        <TextLink href={`${basePath}/prehled`}>přehled</TextLink>.
                      </p>
                    </InfoPopover>
                  }
                >
                  <ExemptionOutlookChart outlook={outlook} />
                </Section>
              )}

              {showDividends && (
                <Section
                  title={years.length > 1 ? 'Dividendy' : `Dividendy ${year}`}
                  count={
                    dividends.totalCzk <= 0
                      ? undefined
                      : // haléřová dividenda se zaokrouhlila na „0 Kč brutto“ (R2-28)
                        dividends.totalCzk < 1
                        ? 'méně než 1 Kč brutto'
                        : `${czk(dividends.totalCzk)} brutto`
                  }
                  info={
                    <InfoPopover label="Dividendy" align="start">
                      <p>
                        {tidy(
                          'Částky jsou brutto, před srážkovou daní, přepočtené kurzem pro přiznání. Barva sloupce je stát, kde byla dividenda zdaněna u zdroje.',
                        )}
                      </p>
                    </InfoPopover>
                  }
                  actions={
                    <YearSwitcher years={years} active={year} hrefBase={`${basePath}/portfolio`} />
                  }
                >
                  {dividends.totalCzk > 0 ? (
                    <DividendsByMonthChart data={dividends} />
                  ) : (
                    <EmptyState compact title={`V roce ${year} žádné dividendy`} headingAs="p" />
                  )}
                </Section>
              )}

              {showRealized && (
                <Section
                  title="Realizovaný zisk a ztráta"
                  info={
                    <InfoPopover label="Realizovaný zisk a ztráta" align="start">
                      <p>
                        {tidy(
                          'Skutečný výsledek prodejů po letech: tržby minus náklady včetně poplatků. Bez ohledu na to, jestli byly prodeje osvobozené od daně.',
                        )}
                      </p>
                    </InfoPopover>
                  }
                >
                  <RealizedByYearChart bars={realized} />
                </Section>
              )}

              {showFees && (
                <Section
                  title="Poplatky"
                  info={
                    <InfoPopover label="Poplatky" align="start">
                      <p>
                        {tidy(
                          'Obchodní i účetní poplatky brokerům po letech, orientačně přepočtené jednotnými kurzy.',
                        )}
                      </p>
                      {fees.skippedCurrencies.length > 0 && (
                        <p>Bez kurzu, a proto nezapočteno: {fees.skippedCurrencies.join(', ')}.</p>
                      )}
                    </InfoPopover>
                  }
                >
                  <FeesByYearChart bars={fees.bars} />
                </Section>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** Prázdné portfolio nového účtu: pozvánka k importu, ne omluva. */
export function PortfolioEmpty() {
  return (
    <>
      <AppToolbar title="Portfolio" />
      <EmptyState
        title="Portfolio je zatím prázdné"
        action={
          <Link href="/import" className={buttonVariants()}>
            Nahrát výpisy
          </Link>
        }
      >
        Nahraj výpisy od brokera a uvidíš, co držíš, kolik to stojí a co už můžeš prodat bez daně.
      </EmptyState>
    </>
  );
}
