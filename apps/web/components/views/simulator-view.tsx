import Link from 'next/link';
import { positionsAt, simulateSale, analyzeTaxYear, type EngineInput } from '@danero/engine';
import type { DisposalReport } from '@danero/engine';
import { d, ZERO, type Money, type Transaction } from '@danero/shared';
import { LimitBar, zoneForRatio } from '@/components/limit-gauge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, keepCurrencyCase } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/field';
import { czk, METHOD_LABEL, qty } from '@/lib/format';
import {
  engineInputForUser,
  instrumentLabels,
  instrumentNames,
  type ProfileRow,
} from '@/lib/portfolio';
import type { InstrumentPrice } from '@/lib/prices';
import { simulatorVerdict, type SimulatorVerdict } from '@/lib/simulator-verdict';
import { cn, firstParam } from '@/lib/utils';

/** Opakovaný query parametr přijde jako pole — normalizuje se přes firstParam. */
export interface SimParams {
  isin?: string | string[];
  kusy?: string | string[];
  cena?: string | string[];
}

/** Číslo ve tvaru „123“ / „123.45“ (bez vědecké notace — regex ji odmítne). */
const NUM_RE = /^\d+(\.\d+)?$/;
/** Horní mez vstupů (cena i kusy) — brání „∞ Kč“ a absurdním procentům. */
const MAX_INPUT = d('1000000000');

/**
 * Sdílené tělo simulátoru prodeje: GET formulář + čistý výpočet dopadu
 * (simulateSale) nad transakcemi — reálná stránka je dodá z DB, demo
 * z ukázkového datasetu. `basePath` směruje odkazy.
 */
export function SimulatorView({
  txs,
  profile,
  today,
  params,
  dailyRates,
  prices,
  basePath = '',
}: {
  txs: Transaction[];
  profile: ProfileRow;
  today: string;
  params: SimParams;
  dailyRates?: EngineInput['dailyRates'];
  /** Poslední známé ceny od brokera — předvyplnění pole „Cena/ks“. */
  prices?: Map<string, InstrumentPrice>;
  basePath?: string;
}) {
  const year = Number(today.slice(0, 4)); // rok z téhož okamžiku (UTC) jako today
  const input = engineInputForUser(txs, profile, year, dailyRates);
  const baseline = analyzeTaxYear(input);
  // deriváty simulátor neumí (viz hláška níže) — do výběru pozic nepatří
  const positions = positionsAt(baseline.ledger, today).filter(
    (p) => p.totalRemaining.gt(0) && p.assetClass !== 'DERIVATIVE',
  );
  const labels = instrumentLabels(txs);
  const names = instrumentNames(txs);
  // options řadíme podle tickeru/labelu (ISIN uživateli nic neříká)
  const options = [...positions].sort((a, b) =>
    (labels.get(a.isin) ?? a.isin).localeCompare(labels.get(b.isin) ?? b.isin, 'cs'),
  );

  const isinParam = firstParam(params.isin);
  const selected = positions.find((p) => p.isin === isinParam);
  const priceRaw = (firstParam(params.cena) ?? '').replace(',', '.').trim();
  const quantityRaw = (firstParam(params.kusy) ?? '').replace(',', '.').trim();

  // druh je vlastnost instrumentu — derivát poznáme z transakcí i bez pozice
  const isDerivativeIsin =
    isinParam !== undefined &&
    txs.some(
      (tx) =>
        'isin' in tx && tx.isin === isinParam && 'assetClass' in tx && tx.assetClass === 'DERIVATIVE',
    );

  // předvyplnění poslední známou cenou od brokera (jen shodná měna — jiná by
  // uživatele zmátla); simulace se s ní nespouští, jen šetří psaní
  const lastKnown = selected ? prices?.get(selected.isin) : undefined;
  const prefillPrice =
    selected && priceRaw === '' && lastKnown && lastKnown.currency === selected.currency
      ? lastKnown.price
      : undefined;

  let simulation: ReturnType<typeof simulateSale> | null = null;
  let formError: string | null = null;
  if (isDerivativeIsin) {
    // R-12: deriváty nemají osvobození ani limity — simulace by lhala
    formError = 'Deriváty simulátor zatím neumí — daní se vždy, bez osvobození i limitů (§ 10, druh F).';
  } else if (selected && (priceRaw !== '' || !prefillPrice)) {
    const quantity = quantityRaw === '' ? selected.totalRemaining.toString() : quantityRaw;
    // validace výhradně Decimalem — Number by u velkých vstupů přetekl do Infinity
    if (!NUM_RE.test(priceRaw) || !d(priceRaw).gt(0)) {
      formError = 'Zadej cenu za kus (kladné číslo, v měně instrumentu).';
    } else if (d(priceRaw).gt(MAX_INPUT)) {
      formError = 'To není reálná cena — zadej cenu do 1 000 000 000.';
    } else if (!NUM_RE.test(quantity) || !d(quantity).gt(0)) {
      formError = 'Počet kusů musí být kladné číslo.';
    } else if (d(quantity).gt(MAX_INPUT)) {
      formError = 'Zadej počet kusů do 1 000 000 000.';
    } else if (selected.totalRemaining.lt(quantity)) {
      formError = `Držíš jen ${qty(selected.totalRemaining)} ks — tolik prodat nejde.`;
    } else {
      simulation = simulateSale(input, {
        isin: selected.isin,
        quantity,
        pricePerShare: priceRaw,
        currency: selected.currency,
        date: today,
        assetClass: selected.assetClass,
      });
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold">Simulátor prodeje</h1>
        <p className="mt-1 text-sm text-inkoust-tlumeny">
          Co udělá zamýšlený prodej s tvými limity a daní — ještě před obchodem, rok {year}.
        </p>
      </header>

      <Card>
        <form method="get" className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
          <div>
            <Label htmlFor="isin">Pozice</Label>
            <Select id="isin" name="isin" defaultValue={selected?.isin ?? ''} required>
              <option value="" disabled>
                Vyber instrument…
              </option>
              {options.map((position) => (
                <option key={position.isin} value={position.isin}>
                  {labels.get(position.isin) ?? position.isin}
                  {names.get(position.isin) ? ` — ${names.get(position.isin)}` : ''} ·{' '}
                  {qty(position.totalRemaining)} ks · {position.currency}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="kusy">Kusů (prázdné = vše)</Label>
            <Input
              id="kusy"
              name="kusy"
              inputMode="decimal"
              defaultValue={firstParam(params.kusy) ?? ''}
            />
          </div>
          <div>
            <Label htmlFor="cena">Cena/ks</Label>
            <div className="flex items-center gap-2">
              <Input
                id="cena"
                name="cena"
                inputMode="decimal"
                required
                defaultValue={firstParam(params.cena) ?? prefillPrice?.toString() ?? ''}
                placeholder="cena za kus"
                title="Cena za kus v měně instrumentu"
              />
              {/* měnu instrumentu známe z pozice — uživatel nemusí hádat */}
              {selected && (
                <span className="shrink-0 font-mono text-sm text-inkoust-tlumeny">
                  {selected.currency}
                </span>
              )}
            </div>
          </div>
          <Button type="submit">Spočítat dopad</Button>
        </form>
        {prefillPrice && (
          <p className="mt-3 text-xs text-inkoust-tlumeny">
            Předvyplnili jsme poslední známou cenu — uprav podle trhu a spočítej dopad.
          </p>
        )}
        {formError && <p className="mt-3 text-sm text-cervena">{formError}</p>}
      </Card>

      {/* H4: před prvním výpočtem místo prázdné plochy ukázka výsledku */}
      {!simulation && (
        <Card className="space-y-3">
          <CardTitle>Co dostaneš</CardTitle>
          <p className="text-sm text-inkoust-tlumeny">
            Vyber pozici a zadej cenu — Danero ještě před obchodem spočítá verdikt, rozpad tržby a
            dopad na limity i orientační daň. Třeba takhle:
          </p>
          <div aria-hidden className="select-none space-y-4 pt-1">
            <p className="text-lg font-semibold text-inkoust-tlumeny/60">
              „Prodej je celý osvobozený — limity ani daň nečerpá.“
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              {['Paušální daň (50 000 Kč)', 'Prodeje CP (100 000 Kč)', 'Orientační daň'].map(
                (label) => (
                  <div key={label} className="rounded-lg border border-dashed border-linka p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-inkoust-tlumeny/70">
                      {keepCurrencyCase(label)}
                    </p>
                    <div className="mt-3 h-5 w-24 rounded bg-linka/60" />
                    <div className="mt-2 h-3 w-16 rounded bg-linka/40" />
                    <div className="mt-3 h-1.5 w-full rounded-full bg-linka/40" />
                  </div>
                ),
              )}
            </div>
          </div>
        </Card>
      )}

      {simulation && selected && (
        <>
          <Card className="space-y-2">
            <CardTitle>Verdikt</CardTitle>
            <VerdictLine verdict={simulatorVerdict(simulation)} />
            <p className="text-sm text-inkoust-tlumeny">
              Z tržby {czk(simulation.simulatedDisposal?.grossProceedsCzk ?? 0)} je osvobozeno{' '}
              <span className="font-mono text-zelena">
                {czk(simulation.simulatedDisposal?.exemptProceedsCzk ?? 0)}
              </span>{' '}
              a zdanitelných{' '}
              <span className="font-mono text-cervena">
                {czk(simulation.simulatedDisposal?.taxableProceedsCzk ?? 0)}
              </span>
              . Párování metodou{' '}
              {METHOD_LABEL[baseline.options.matchingMethod] ?? baseline.options.matchingMethod}.
            </p>
          </Card>

          {simulation.simulatedDisposal && (
            <Card className="space-y-3">
              <CardTitle>Rozpad prodeje</CardTitle>
              <SaleWaterfall
                disposal={simulation.simulatedDisposal}
                taxDeltaCzk={simulation.deltas.taxCzk}
              />
            </Card>
          )}

          <section className="grid gap-4 sm:grid-cols-3">
            <DeltaCard
              label="Paušální daň (50 000 Kč)"
              beforeCzk={simulation.baseline.flatTax50kUsedCzk}
              afterCzk={simulation.simulated.flatTax50kUsedCzk}
              exceeded={simulation.simulated.flatTax50kExceeded}
              limitCzk={baseline.limits.flatTax50k.status.limitCzk}
            />
            {/* exceeded = STAV po prodeji přes limit — konzistentně s kartou 50k */}
            {selected.assetClass === 'CRYPTO' ? (
              <DeltaCard
                label="Prodeje krypta (100 000 Kč)"
                beforeCzk={simulation.baseline.cryptoLimit100kUsedCzk}
                afterCzk={simulation.simulated.cryptoLimit100kUsedCzk}
                exceeded={!simulation.simulated.cryptoExemptUnder100k}
                limitCzk={baseline.limits.cryptoLimit100k.limitCzk}
              />
            ) : (
              <DeltaCard
                label="Prodeje CP (100 000 Kč)"
                beforeCzk={simulation.baseline.limit100kUsedCzk}
                afterCzk={simulation.simulated.limit100kUsedCzk}
                exceeded={!simulation.simulated.exemptUnder100k}
                limitCzk={baseline.limits.limit100k.limitCzk}
              />
            )}
            <DeltaCard
              label="Orientační daň"
              beforeCzk={simulation.baseline.taxCzk}
              afterCzk={simulation.simulated.taxCzk}
            />
          </section>

          <p className="text-xs text-inkoust-tlumeny">
            Simulace počítá s prodejem k dnešnímu dni za zadanou cenu.{' '}
            <Link href={`${basePath}/report`} className="font-medium text-ruzova">
              Detailní rozpad najdeš v reportu
            </Link>
            .
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Věta verdiktu podle čisté funkce simulatorVerdict — poctivá i u knock-on
 * efektu (osvobozený prodej, který prolomí úhrn 100k a zpětně zdaní dřívější
 * letošní prodeje). Barva: zelená jen pro čistě osvobozený stav.
 */
function VerdictLine({ verdict }: { verdict: SimulatorVerdict }) {
  switch (verdict.kind) {
    case 'EXEMPT_CLEAN':
      return (
        <p className="text-lg font-semibold text-zelena">
          Prodej je celý osvobozený — limity ani daň nečerpá.
        </p>
      );
    case 'EXEMPT_BREAKS_100K':
      return (
        <p className="text-lg font-semibold text-cervena">
          Prodej je osvobozený časovým testem, ale prolomí úhrn 100 000 Kč
          {verdict.crypto ? ' pro kryptoaktiva' : ''} — zpětně zdaní dřívější letošní prodeje
          {verdict.taxDeltaCzk.gt(0) ? ` (daň +${czk(verdict.taxDeltaCzk)})` : ''}.
        </p>
      );
    case 'EXEMPT_DRAWS_LIMIT':
      return (
        <p className="text-lg font-semibold text-jantar">
          {verdict.taxDeltaCzk.gt(0)
            ? `Prodej je osvobozený, ale celková daň se zvýší o ${czk(verdict.taxDeltaCzk)} — dopad níže.`
            : `Prodej je osvobozený a daň nezvýší, ale čerpá roční limit 100 000 Kč${verdict.crypto ? ' pro kryptoaktiva' : ''} — hlídej zbývající prostor níže.`}
        </p>
      );
    case 'BREAKS_50K':
      return (
        <p className="text-lg font-semibold text-cervena">
          Tento prodej prolomí limit 50 000 Kč pro paušální daň.
        </p>
      );
    case 'TAXABLE':
      return <p className="text-lg font-semibold">Prodej je zdanitelný — dopad níže.</p>;
  }
}

/**
 * Delta karta (H4): po-hodnota + badge se semaforem podle SMĚRU změny
 * (zhoršení červeně, zlepšení zeleně, beze změny neutrálně) vždy POD číslem —
 * tři karty mají stejný layout. Červené číslo jen u prolomeného limitu;
 * částka daně zůstává neutrálním inkoustem. Před/po progress bary limitu
 * doplňuje textové čerpání „X % → Y %“ (při přetečení obou se bary neliší).
 */
function DeltaCard({
  label,
  beforeCzk,
  afterCzk,
  exceeded = false,
  limitCzk,
}: {
  label: string;
  beforeCzk: Money;
  afterCzk: Money;
  /** Prolomený limit — jediný stav, který barví částku červeně. */
  exceeded?: boolean;
  /** Je-li zadán limit, vykreslí se před/po progress bary čerpání. */
  limitCzk?: Money;
}) {
  const delta = afterCzk.minus(beforeCzk);
  const badge = delta.gt(0)
    ? { text: `↑ +${czk(delta)}`, tone: 'bg-cervena/10 text-cervena' }
    : delta.lt(0)
      ? { text: `↓ ${czk(delta)}`, tone: 'bg-zelena/10 text-zelena' }
      : { text: '→ beze změny', tone: 'bg-linka/50 text-inkoust-tlumeny' };
  const bars =
    limitCzk?.gt(0) &&
    ([
      ['před', beforeCzk.div(limitCzk).toNumber()],
      ['po', afterCzk.div(limitCzk).toNumber()],
    ] as const);
  const pct = (ratio: number): string => `${Math.round(ratio * 100)} %`;

  return (
    <Card className="space-y-2">
      <CardTitle>{label}</CardTitle>
      <div>
        <p className={cn('font-mono text-lg font-semibold', exceeded && 'text-cervena')}>
          {czk(afterCzk)}
        </p>
        <span
          className={cn(
            'mt-1 inline-block rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold',
            badge.tone,
          )}
        >
          {badge.text}
        </span>
      </div>
      <p className="text-xs text-inkoust-tlumeny">
        před prodejem: <span className="font-mono">{czk(beforeCzk)}</span>
      </p>
      {bars && (
        <div className="space-y-1.5 pt-1">
          {bars.map(([name, ratio]) => (
            <div key={name} className="flex items-center gap-2">
              <span className="w-8 shrink-0 font-mono text-[10px] text-inkoust-tlumeny">
                {name}
              </span>
              <LimitBar
                ratio={ratio}
                zone={zoneForRatio(ratio)}
                animate={false}
                className="h-1.5"
              />
            </div>
          ))}
          <p className="font-mono text-[10px] text-inkoust-tlumeny">
            čerpání {pct(bars[0][1])} → {pct(bars[1][1])}
          </p>
        </div>
      )}
    </Card>
  );
}

/**
 * Vodorovný waterfall rozpadu prodeje (H4): Tržba → (osvobozeno) → Výdaj →
 * Základ → Daň. Čisté divy nad společnou škálou 0–tržba; výdaj „visí“
 * mezi základem a zdanitelnou částí, jak se odečítá.
 */
function SaleWaterfall({
  disposal,
  taxDeltaCzk,
}: {
  disposal: DisposalReport;
  taxDeltaCzk: Money;
}) {
  const gross = disposal.grossProceedsCzk.toNumber();
  if (gross <= 0) return null;
  const exempt = disposal.exemptProceedsCzk.toNumber();
  const taxable = disposal.taxableProceedsCzk.toNumber();
  const expense = disposal.allocations
    .reduce((sum, allocation) => sum.plus(allocation.expenseCzk), ZERO)
    .toNumber();
  const base = Math.max(0, taxable - expense);
  const tax = Math.max(0, taxDeltaCzk.toNumber());
  const isLoss = taxable - expense < 0;

  const rows: Array<{ label: string; from: number; to: number; color: string; value: number }> = [
    { label: 'Tržba', from: 0, to: gross, color: 'var(--graf-1)', value: gross },
    ...(exempt > 0
      ? [
          {
            label: 'Osvobozeno',
            from: gross - exempt,
            to: gross,
            color: 'var(--zelena)',
            value: exempt,
          },
        ]
      : []),
    {
      label: 'Výdaj',
      from: base,
      to: Math.min(base + expense, Math.max(taxable, base)),
      color: 'var(--inkoust-tlumeny)',
      value: expense,
    },
    { label: 'Základ', from: 0, to: base, color: 'var(--graf-2)', value: base },
    // strop na tržbu: delta daně zahrnuje celoroční dopad (může ovlivnit
    // i zdanění ostatních letošních prodejů) a mohla by přetéct škálu —
    // bar se zastaví na 100 %, přesnou hodnotu nese číslo vpravo
    { label: 'Daň', from: 0, to: Math.min(tax, gross), color: 'var(--cervena)', value: tax },
  ];

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-x-3 sm:grid-cols-[5.5rem_1fr_8rem]"
        >
          <span className="text-xs text-inkoust-tlumeny">{row.label}</span>
          <div className="relative h-4 overflow-hidden rounded bg-linka/30">
            {row.value > 0 && (
              <div
                className="absolute inset-y-0 rounded-sm"
                style={{
                  left: `${(row.from / gross) * 100}%`,
                  width: `${Math.max(((row.to - row.from) / gross) * 100, 0.8)}%`,
                  background: row.color,
                }}
              />
            )}
          </div>
          <span className="text-right font-mono text-xs text-inkoust">{czk(row.value)}</span>
        </div>
      ))}
      <p className="pt-1 text-xs text-inkoust-tlumeny">
        Výdaj = nabývací cena zdanitelné části (kurzem roku nákupu). Daň = změna orientační daně
        proti stavu bez prodeje — zahrnuje celoroční dopad, může tedy převýšit i tržbu tohoto
        prodeje (třeba když prolomí limit a zdaní ostatní letošní prodeje).
        {isLoss && ' Prodej je ve ztrátě — základ z něj je nulový.'}
      </p>
    </div>
  );
}
