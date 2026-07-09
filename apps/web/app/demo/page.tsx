import Link from 'next/link';
import { analyzeTaxYear, positionsAt } from '@danero/engine';
import { parseTransactions, TaxpayerProfileSchema } from '@danero/shared';
import { LimitDrawdownChart } from '@/components/charts';
import { HorizonStrip } from '@/components/horizon-strip';
import { LimitGauge } from '@/components/limit-gauge';
import { Card, CardTitle } from '@/components/ui/card';
import { flatTax50kSeries, horizonDots, limit100kSeries } from '@/lib/charts-data';
import { czk } from '@/lib/format';
import { configForYear, UNIFIED_RATES } from '@/lib/tax-config';
import { instrumentLabels } from '@/lib/portfolio';

export const dynamic = 'force-dynamic';

/**
 * Demo režim (G9a): plnohodnotný přehled nad UKÁZKOVÝMI daty, bez registrace
 * a bez databáze — engine je čistá funkce, všechno se počítá při requestu.
 * Data jsou volená tak, aby ukázala hlídání limitů (50k prolomený, 100k
 * i krypto v pásmu varování), časové testy i tři druhy příjmů (CP, krypto, opce).
 */
/** Poslední rok, pro který máme kurzy — demo nesmí spadnout 1. ledna (kurz
 *  nového roku se doplňuje ručně dle runbooku, R-06a). */
const LAST_RATE_YEAR = Math.max(...Object.keys(UNIFIED_RATES).map(Number));

const buildDemoTxs = (Y: number) =>
  parseTransactions([
  // AAPL: nákup před >3 lety → prodej OSVOBOZENÝ časovým testem
  { type: 'BUY', id: 'd1', isin: 'US0378331005', ticker: 'AAPL', name: 'Apple', quantity: '40', pricePerShare: '150', currency: 'USD', tradeDate: `${Y - 4}-03-10`, settlementDate: `${Y - 4}-03-12` },
  { type: 'SELL', id: 'd2', isin: 'US0378331005', quantity: '10', pricePerShare: '210', currency: 'USD', tradeDate: `${Y}-02-12`, settlementDate: `${Y}-02-13` },
  // MSFT: mladá pozice → zdanitelný prodej (čerpá 100k i 50k)
  { type: 'BUY', id: 'd3', isin: 'US5949181045', ticker: 'MSFT', name: 'Microsoft', quantity: '10', pricePerShare: '380', currency: 'USD', tradeDate: `${Y - 1}-05-02`, settlementDate: `${Y - 1}-05-03` },
  { type: 'SELL', id: 'd4', isin: 'US5949181045', quantity: '3', pricePerShare: '460', currency: 'USD', tradeDate: `${Y}-04-20`, settlementDate: `${Y}-04-21` },
  // VWCE: drží se, osvobození na dohled (horizont)
  { type: 'BUY', id: 'd5', isin: 'IE00BK5BQT80', ticker: 'VWCE', name: 'Vanguard FTSE All-World', quantity: '50', pricePerShare: '110', currency: 'EUR', tradeDate: `${Y - 3}-09-15`, settlementDate: `${Y - 3}-09-17` },
  { type: 'BUY', id: 'd6', isin: 'IE00BK5BQT80', ticker: 'VWCE', quantity: '30', pricePerShare: '125', currency: 'EUR', tradeDate: `${Y - 1}-11-05`, settlementDate: `${Y - 1}-11-07` },
  // dividendy + úrok (limit 50k, zápočet)
  { type: 'DIVIDEND', id: 'd7', isin: 'US0378331005', gross: '120', withholdingTax: '18', currency: 'USD', sourceCountry: 'US', date: `${Y}-05-15` },
  { type: 'DIVIDEND', id: 'd8', isin: 'DE0007164600', gross: '90', withholdingTax: '23.72', currency: 'EUR', sourceCountry: 'DE', date: `${Y}-06-01` },
  { type: 'INTEREST', id: 'd9', amount: '35', currency: 'USD', sourceCountry: 'US', date: `${Y}-06-30` },
  // krypto: vlastní limit 100k (pod limitem — vše osvobozeno)
  { type: 'BUY', id: 'd10', isin: 'BTC', ticker: 'BTC', name: 'Bitcoin', assetClass: 'CRYPTO', quantity: '0.05', pricePerShare: '1600000', currency: 'CZK', tradeDate: `${Y - 1}-03-01` },
  { type: 'SELL', id: 'd11', isin: 'BTC', assetClass: 'CRYPTO', quantity: '0.03', pricePerShare: '2100000', currency: 'CZK', tradeDate: `${Y}-03-14` },
  // opce: deriváty bez osvobození (druh F)
  { type: 'BUY', id: 'd12', isin: 'OPT:AAPL-C220', name: 'AAPL call 220', assetClass: 'DERIVATIVE', quantity: '1', pricePerShare: '9000', currency: 'CZK', tradeDate: `${Y}-01-20` },
  { type: 'SELL', id: 'd13', isin: 'OPT:AAPL-C220', assetClass: 'DERIVATIVE', quantity: '1', pricePerShare: '46000', currency: 'CZK', tradeDate: `${Y}-05-06` },
  ]);

export default function DemoPage() {
  const demoYear = Math.min(new Date().getFullYear(), LAST_RATE_YEAR);
  const today = `${demoYear}-${new Date().toISOString().slice(5, 10)}`;
  const demoTxs = buildDemoTxs(demoYear);
  const result = analyzeTaxYear({
    transactions: demoTxs,
    profile: TaxpayerProfileSchema.parse({ regime: 'PAUSAL' }),
    config: configForYear(demoYear),
  });
  const labels = instrumentLabels(demoTxs);
  const positions = positionsAt(result.ledger, today);
  const limit100kChart = limit100kSeries(result);
  const flatTax50kChart = flatTax50kSeries(result);
  const dots = horizonDots(positions, labels, new Map(), demoYear);
  const tax =
    result.tax.recommended === 'GENERAL' ? result.tax.general.taxCzk : result.tax.separate16a.taxCzk;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ruzova/40 bg-ruzova/5 px-4 py-3">
        <p className="text-sm">
          <span className="font-semibold text-ruzova">Demo režim</span> — ukázková data
          fiktivního investora (paušální OSVČ, akcie + krypto + opce). Nic se neukládá.
        </p>
        <Link
          href="/registrace"
          className="rounded-md bg-ruzova px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Chci to pro svoje portfolio
        </Link>
      </div>

      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">Přehled {demoYear}</h1>
        <p className="font-mono text-xs text-inkoust-tlumeny">
          {demoTxs.length} transakcí · FIFO · jednotný kurz
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <LimitGauge
          label="Limit paušální daně — 50 000 Kč"
          hint="Úhrn zdanitelných příjmů mimo živnost. Při překročení podáváš přiznání a přehledy — v paušálním režimu ale zůstáváš."
          status={result.limits.flatTax50k.status}
        />
        <LimitGauge
          label="Osvobození prodejů CP — 100 000 Kč"
          hint="Jsou-li tržby z prodeje cenných papírů za rok do 100 000 Kč, jsou všechny osvobozené."
          status={result.limits.limit100k}
        />
        <LimitGauge
          label="Osvobození krypta — 100 000 Kč"
          hint="Samostatný limit pro kryptoaktiva, nezávislý na limitu pro cenné papíry."
          status={result.limits.cryptoLimit100k}
        />
        <Card className="space-y-1">
          <CardTitle>Orientační daň z investic</CardTitle>
          <p className="font-mono text-lg font-medium">{czk(tax)}</p>
          <p className="text-xs text-inkoust-tlumeny">
            Základ § 10:{' '}
            {czk(
              result.securities.base10Czk
                .plus(result.crypto.base10Czk)
                .plus(result.derivatives.base10Czk),
            )}{' '}
            · § 8: {czk(result.dividends.base8Czk)} — CP, krypto i deriváty zvlášť, druhy se
            nekompenzují.
          </p>
        </Card>
        <Card className="space-y-1 md:col-span-2 xl:col-span-2">
          <CardTitle>Co Danero hlídá za tebe</CardTitle>
          <p className="text-sm text-inkoust-tlumeny">
            Tříleté časové testy každé pozice, limity osvobození, paušální daň, podklady
            k přiznání včetně XML pro mojedane.cz — a před každým prodejem ti simulátor
            řekne, co udělá s daněmi.
          </p>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {limit100kChart.points.length > 1 && (
          <Card>
            <CardTitle>Čerpání limitu 100k v průběhu roku</CardTitle>
            <p className="mb-2 mt-1 text-xs text-inkoust-tlumeny">
              Kumulativní tržby z prodejů CP; přerušované čáry = pásma 60/85/100 %.
            </p>
            <LimitDrawdownChart series={limit100kChart} name="Tržby z prodejů" />
          </Card>
        )}
        {flatTax50kChart && flatTax50kChart.points.length > 1 && (
          <Card>
            <CardTitle>Čerpání limitu 50k v průběhu roku</CardTitle>
            <p className="mb-2 mt-1 text-xs text-inkoust-tlumeny">
              Zdanitelné příjmy mimo živnost (neosvobozené prodeje, dividendy, úroky, deriváty).
            </p>
            <LimitDrawdownChart series={flatTax50kChart} name="Zdanitelné příjmy" />
          </Card>
        )}
      </section>

      <Card>
        <CardTitle>Horizont osvobození</CardTitle>
        <p className="mb-2 mt-1 text-xs text-inkoust-tlumeny">
          Kdy které pozici doběhne tříletý časový test — od té chvíle je prodej bez daně.
        </p>
        <HorizonStrip dots={dots} today={today} />
      </Card>

      <div className="flex flex-wrap items-center justify-center gap-4 rounded-lg border border-linka bg-plocha px-4 py-6">
        <p className="text-sm text-inkoust-tlumeny">
          Tohle všechno nad tvými skutečnými daty — import z Trading212, IBKR, XTB, Degiro,
          Fio nebo CSV šablony.
        </p>
        <Link
          href="/registrace"
          className="rounded-md bg-ruzova px-5 py-2.5 font-semibold text-white hover:opacity-90"
        >
          Vyzkoušet zdarma
        </Link>
      </div>
    </div>
  );
}
