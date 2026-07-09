import Link from 'next/link';
import { redirect } from 'next/navigation';
import { positionsAt, simulateSale, analyzeTaxYear } from '@danero/engine';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/field';
import { getDb } from '@/db';
import { czk, qty } from '@/lib/format';
import {
  dailyRatesForProfile,
  engineInputForUser,
  getProfile,
  instrumentLabels,
  loadTransactions,
} from '@/lib/portfolio';
import { activePortfolio } from '@/lib/portfolio-context';
import { requireUser } from '@/lib/session';
import { cn } from '@/lib/utils';

interface SimParams {
  isin?: string;
  kusy?: string;
  cena?: string;
}

export default async function SimulatorPage({
  searchParams,
}: {
  searchParams: Promise<SimParams>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const portfolio = await activePortfolio(db, user.id);
  const profile = await getProfile(db, user.id, portfolio.id);
  if (!profile) redirect('/nastaveni');

  const txs = await loadTransactions(db, user.id, portfolio.id);
  if (txs.length === 0) redirect('/prehled');

  const today = new Date().toISOString().slice(0, 10);
  const year = new Date().getFullYear();
  const dailyRates = await dailyRatesForProfile(db, txs, profile, year);
  const input = engineInputForUser(txs, profile, year, dailyRates);
  const baseline = analyzeTaxYear(input);
  const positions = positionsAt(baseline.ledger, today).filter((p) =>
    p.totalRemaining.gt(0),
  );
  const labels = instrumentLabels(txs);

  const params = await searchParams;
  const selected = positions.find((p) => p.isin === params.isin);
  const priceRaw = (params.cena ?? '').replace(',', '.').trim();
  const quantityRaw = (params.kusy ?? '').replace(',', '.').trim();

  let simulation: ReturnType<typeof simulateSale> | null = null;
  let formError: string | null = null;
  if (selected) {
    const quantity = quantityRaw === '' ? selected.totalRemaining.toString() : quantityRaw;
    if (!/^\d+(\.\d+)?$/.test(priceRaw) || Number(priceRaw) <= 0) {
      formError = 'Zadej cenu za kus (kladné číslo, v měně instrumentu).';
    } else if (!/^\d+(\.\d+)?$/.test(quantity) || Number(quantity) <= 0) {
      formError = 'Počet kusů musí být kladné číslo.';
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
            <Select id="isin" name="isin" defaultValue={params.isin ?? ''} required>
              <option value="" disabled>
                Vyber instrument…
              </option>
              {positions.map((position) => (
                <option key={position.isin} value={position.isin}>
                  {labels.get(position.isin) ?? position.isin} · {qty(position.totalRemaining)} ks
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="kusy">Kusů (prázdné = vše)</Label>
            <Input id="kusy" name="kusy" inputMode="decimal" defaultValue={params.kusy ?? ''} />
          </div>
          <div>
            <Label htmlFor="cena">Cena / kus</Label>
            <Input
              id="cena"
              name="cena"
              inputMode="decimal"
              required
              defaultValue={params.cena ?? ''}
              placeholder="v měně instrumentu"
            />
          </div>
          <Button type="submit">Spočítat dopad</Button>
        </form>
        {formError && <p className="mt-3 text-sm text-cervena">{formError}</p>}
      </Card>

      {simulation && selected && (
        <>
          <Card className="space-y-2">
            <CardTitle>Verdikt</CardTitle>
            {simulation.simulatedDisposal?.taxableProceedsCzk.lte(0) ? (
              <p className="text-lg font-semibold text-zelena">
                Prodej je celý osvobozený — limity ani daň nečerpá.
              </p>
            ) : simulation.simulated.flatTax50kExceeded && !simulation.baseline.flatTax50kExceeded ? (
              <p className="text-lg font-semibold text-cervena">
                Tento prodej prolomí limit 50 000 Kč pro paušální daň.
              </p>
            ) : (
              <p className="text-lg font-semibold">
                Prodej je zdanitelný — dopad níže.
              </p>
            )}
            <p className="text-sm text-inkoust-tlumeny">
              Z tržby {czk(simulation.simulatedDisposal?.grossProceedsCzk ?? 0)} je osvobozeno{' '}
              <span className="font-mono text-zelena">
                {czk(simulation.simulatedDisposal?.exemptProceedsCzk ?? 0)}
              </span>{' '}
              a zdanitelných{' '}
              <span className="font-mono text-cervena">
                {czk(simulation.simulatedDisposal?.taxableProceedsCzk ?? 0)}
              </span>
              . Párování metodou {baseline.options.matchingMethod}.
            </p>
          </Card>

          <section className="grid gap-4 sm:grid-cols-3">
            <DeltaCard
              label="Paušální daň (50k)"
              before={czk(simulation.baseline.flatTax50kUsedCzk)}
              after={czk(simulation.simulated.flatTax50kUsedCzk)}
              bad={simulation.simulated.flatTax50kExceeded}
            />
            {selected.assetClass === 'CRYPTO' ? (
              <DeltaCard
                label="Prodeje krypta (100k)"
                before={czk(simulation.baseline.cryptoLimit100kUsedCzk)}
                after={czk(simulation.simulated.cryptoLimit100kUsedCzk)}
                bad={
                  !simulation.simulated.cryptoExemptUnder100k &&
                  simulation.baseline.cryptoExemptUnder100k
                }
              />
            ) : (
              <DeltaCard
                label="Prodeje CP (100k)"
                before={czk(simulation.baseline.limit100kUsedCzk)}
                after={czk(simulation.simulated.limit100kUsedCzk)}
                bad={!simulation.simulated.exemptUnder100k && simulation.baseline.exemptUnder100k}
              />
            )}
            <DeltaCard
              label="Orientační daň"
              before={czk(simulation.baseline.taxCzk)}
              after={czk(simulation.simulated.taxCzk)}
              bad={simulation.deltas.taxCzk.gt(0)}
            />
          </section>

          <p className="text-xs text-inkoust-tlumeny">
            Simulace počítá s prodejem k dnešnímu dni za zadanou cenu.{' '}
            <Link href="/report" className="font-medium text-ruzova">
              Detailní rozpad najdeš v reportu
            </Link>
            .
          </p>
        </>
      )}
    </div>
  );
}

function DeltaCard({
  label,
  before,
  after,
  bad,
}: {
  label: string;
  before: string;
  after: string;
  bad: boolean;
}) {
  return (
    <Card className="space-y-1">
      <CardTitle>{label}</CardTitle>
      <p className="font-mono text-sm text-inkoust-tlumeny">{before}</p>
      <p className={cn('font-mono text-lg font-semibold', bad ? 'text-cervena' : 'text-zelena')}>
        → {after}
      </p>
    </Card>
  );
}
