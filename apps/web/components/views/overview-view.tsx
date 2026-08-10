import Link from 'next/link';
import { LimitDrawdownChart } from '@/components/charts';
import { HorizonStrip } from '@/components/horizon-strip';
import { LimitGauge } from '@/components/limit-gauge';
import { PositionsTable } from '@/components/positions-table';
import { Card, CardTitle } from '@/components/ui/card';
import { ViewSwitch } from '@/components/view-switch';
import { groupByCode, WarningsList } from '@/components/warnings-list';
import { YearSwitcher } from '@/components/year-switcher';
import {
  exemptionOutlook,
  flatTax50kSeries,
  horizonDots,
  limit100kSeries,
} from '@/lib/charts-data';
import { czDate, czk, METHOD_LABEL, pct, plural } from '@/lib/format';
import { instrumentNames, type YearAnalysis } from '@/lib/portfolio';
import type { InstrumentPrice } from '@/lib/prices';
import type { Transaction } from '@danero/shared';
import { filingDeadlines } from '@danero/engine';
import { buttonVariants } from '@/components/ui/button';

/** Upozornění pro kartu „Poslední upozornění“ — DB řádek i demo kandidát. */
export interface PrehledNotification {
  dedupeKey: string;
  title: string;
  body: string;
  createdAt: Date;
}

/**
 * Sdílené tělo přehledu: reálná stránka mu předá data z DB, demo stránka
 * ukázkový dataset. Vše uvnitř jsou čisté výpočty nad hotovou analýzou —
 * žádné I/O. `basePath` směruje odkazy ('' pro aplikaci, '/demo' pro demo).
 */
export function OverviewView({
  txs,
  analysis,
  prices,
  years,
  year,
  today,
  notifications,
  basePath = '',
}: {
  txs: Transaction[];
  analysis: YearAnalysis;
  prices: Map<string, InstrumentPrice>;
  years: number[];
  year: number;
  today: string;
  notifications: PrehledNotification[];
  basePath?: string;
}) {
  const { result, positions, labels } = analysis;
  const currentYear = Number(today.slice(0, 4));
  const limit100kChart = limit100kSeries(result);
  const flatTax50kChart = flatTax50kSeries(result);

  const importantWarnings = result.warnings.filter((w) => w.level !== 'INFO');
  const hasCrypto =
    result.crypto.disposals.length > 0 ||
    positions.some((p) => p.assetClass === 'CRYPTO' && p.totalRemaining.gt(0));
  const forfeitedWithholdingCzk = result.dividends.foreignWithholdingCzk.sub(
    result.dividends.creditableWithholdingCzk,
  );

  // Verdikt: limit, jehož prolomení znamená povinnost podat přiznání — dle
  // režimu (PAUSAL → 50k § 7a, ZAMESTNANEC → 20k, JINE → obecných 50k);
  // OSVČ mimo paušál podává přiznání tak jako tak, verdikt-box tam nedává smysl.
  const filingLimit = result.limits.flatTax50k.applicable
    ? { status: result.limits.flatTax50k.status, label: 'limit 50 000 Kč pro paušální daň' }
    : result.limits.employee20k.applicable
      ? { status: result.limits.employee20k.status, label: 'limit 20 000 Kč vedlejších příjmů' }
      : result.limits.generalFiling50k.applicable
        ? { status: result.limits.generalFiling50k.status, label: 'limit 50 000 Kč pro podání přiznání' }
        : null;
  const deadlines = filingDeadlines(year);
  /**
   * Limit 50k pro paušální daň je aplikovatelný právě u režimu PAUSAL
   * (`limits.ts`), takže tenhle příznak = „uživatel je OSVČ“. OSVČ má od
   * 1. 1. 2023 datovou schránku zřízenou ze zákona a § 72 odst. 6 daňového řádu
   * jí ukládá podat přiznání jen elektronicky; písemné podání je vada podání
   * (§ 74 DŘ) s pokutou dle § 247a odst. 2 DŘ. Nabízet jí papírový termín tedy
   * znamená poslat ji do pokuty a zbytečně jí zkrátit lhůtu o měsíc (E-23).
   * OSVČ mimo paušál se sem nedostane — verdikt-box se jí nevykresluje vůbec.
   */
  const filesElectronicallyOnly = result.limits.flatTax50k.applicable;
  // „nejblíž prolomení“ = nejvyšší čerpání ze sledovaných limitů
  const watchedLimits = [
    ...(filingLimit ? [filingLimit] : []),
    { status: result.limits.limit100k, label: 'limit 100 000 Kč pro osvobození prodejů CP' },
  ];
  const nearestLimit = watchedLimits.reduce((a, b) => (b.status.ratio > a.status.ratio ? b : a));
  const estimatedTaxCzk =
    result.tax.recommended === 'GENERAL' ? result.tax.general.taxCzk : result.tax.separate16a.taxCzk;
  // R-08f: vyčíslení dopadu prolomení limitu 50k (jen paušál a jen při prolomení)
  const breachImpact = result.limits.flatTax50k.breachImpact;

  // Rozpad základu § 10 po druzích — souhrnné „(prodeje)“ mátlo: daň může být
  // jen z derivátů (bez osvobození, R-12c), zatímco prodeje CP/krypto jsou pod limity
  const base10Total = result.securities.base10Czk
    .plus(result.crypto.base10Czk)
    .plus(result.derivatives.base10Czk);
  const base10Parts = [
    { label: 'prodeje CP', value: result.securities.base10Czk },
    { label: 'krypto', value: result.crypto.base10Czk },
    { label: 'deriváty', value: result.derivatives.base10Czk },
  ].filter((part) => part.value.gt(0));
  // prodeje proběhly, ale jsou celé osvobozené → řekni to, jinak čtenář hledá
  // chybu; rozhoduje taxableIncome (base10 = 0 může vzniknout i kompenzací
  // zisků a ztrát — to NENÍ osvobození)
  const exemptNotes = [
    result.securities.taxableIncomeCzk.lte(0) && result.limits.limit100k.usedCzk.gt(0)
      ? 'prodeje CP letos plně osvobozeny'
      : null,
    result.crypto.taxableIncomeCzk.lte(0) && result.limits.cryptoLimit100k.usedCzk.gt(0)
      ? 'krypto plně osvobozeno'
      : null,
  ].filter((note): note is string => note !== null);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">Přehled {year}</h1>
        <div className="flex flex-wrap items-baseline gap-4">
          <YearSwitcher years={years} active={year} hrefBase={`${basePath}/prehled`} />
          <p className="font-mono text-xs text-inkoust-tlumeny">
            {txs.length} {plural(txs.length, 'transakce', 'transakce', 'transakcí')} v historii ·{' '}
            {METHOD_LABEL[result.options.matchingMethod] ?? result.options.matchingMethod} ·{' '}
            {result.options.fxMethod === 'UNIFIED' ? 'jednotný kurz' : 'denní kurzy ČNB'}
          </p>
        </div>
      </header>

      {filingLimit && (
        <Card className="border-l-4 border-l-ruzova">
          {filingLimit.status.exceeded ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-display text-xl font-bold">
                    Za rok {year} podáš daňové přiznání
                  </p>
                  <p className="text-sm text-inkoust-tlumeny">
                    Orientační daň z investic:{' '}
                    <span className="font-mono text-inkoust">{czk(estimatedTaxCzk)}</span> ·{' '}
                    {filesElectronicallyOnly ? (
                      <>
                        termín podání {czDate(deadlines.electronic)} — jako OSVČ máš datovou
                        schránku zřízenou ze zákona, takže se přiznání podává jen elektronicky
                        (§ 72 odst. 6 daňového řádu) a platí pro tebe čtyřměsíční lhůta
                      </>
                    ) : (
                      <>
                        písemně do {czDate(deadlines.paper)}, elektronicky do{' '}
                        {czDate(deadlines.electronic)}
                      </>
                    )}
                  </p>
                </div>
                <Link
                  href={`${basePath}/report`}
                  className={buttonVariants({ variant: 'primary' })}
                >
                  Připravit podklady
                </Link>
              </div>
              {/* R-08f: „kolik mě to bude stát“ je hlavní otázka za prolomením
                  limitu 50k — engine ji vyčíslí, tohle je její místo v UI */}
              {breachImpact && (
                <div className="space-y-2 border-t border-linka pt-3">
                  <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-xs text-inkoust-tlumeny">Daň z investic (§ 8 + § 10)</dt>
                      <dd className="font-mono font-medium">{czk(breachImpact.taxCzk)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-inkoust-tlumeny">
                        − zaplacené zálohy na daň
                        {breachImpact.monthlyAdvanceCzk &&
                          ` (z paušální zálohy ${czk(breachImpact.monthlyAdvanceCzk)}/měs.)`}
                      </dt>
                      <dd className="font-mono font-medium">
                        {czk(breachImpact.advancesCreditCzk)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-inkoust-tlumeny">= doplatek daně</dt>
                      <dd className="font-mono text-lg font-semibold">
                        {czk(breachImpact.additionalTaxCzk)}
                      </dd>
                    </div>
                  </dl>
                  <p className="text-xs text-inkoust-tlumeny">
                    Orientačně a jen z investic — daň z podnikání (§ 7) Danero nevidí. K tomu
                    přibude přehled ČSSZ a zdravotní pojišťovně a doplatek pojistného ze
                    skutečných příjmů; ten spočítat neumíme, protože neznáme tvůj základ z § 7.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <p className="font-display text-xl font-bold">
                Zatím ti povinnost podat přiznání nevzniká
              </p>
              <p className="text-sm text-inkoust-tlumeny">
                Limity hlídáme denně. Nejblíž je {nearestLimit.label} — čerpáno{' '}
                {pct(nearestLimit.status.ratio * 100)}.
              </p>
            </div>
          )}
        </Card>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {result.limits.flatTax50k.applicable && (
          <LimitGauge
            label="Limit paušální daně — 50 000 Kč"
            hint="Platí jen pro paušální daň (§ 7a): úhrn ZDANITELNÝCH příjmů mimo samostatnou činnost (podnikání) — neosvobozené tržby z prodejů CP i kryptoaktiv, plnění z derivátů, zahraniční dividendy (brutto), úroky, nájem. Osvobozené prodeje se nepočítají. Při překročení podáváš přiznání a přehledy — v paušálním režimu ale zůstáváš."
            status={result.limits.flatTax50k.status}
          />
        )}
        {result.limits.employee20k.applicable && (
          <LimitGauge
            label="Vedlejší příjmy — 20 000 Kč"
            hint="Zdanitelné příjmy vedle zaměstnání — investice, nájmy i vlastní výdělek ze samostatné činnosti (§ 7 až 10). Odměrka ukazuje jen to, co Danero vidí z výpisů a z tvého nastavení; příjmy z podnikání do limitu patří taky, ale my o nich nevíme. Při překročení podáváš přiznání."
            status={result.limits.employee20k.status}
          />
        )}
        {/* režim „jiné“: obecný limit § 38g — verdikt s ním počítá, odměrka
            mu do teď chyběla (parita s paušálem/zaměstnancem) */}
        {result.limits.generalFiling50k.applicable && (
          <LimitGauge
            label="Podání přiznání — 50 000 Kč"
            hint="Obecný limit (§ 38g): zdanitelné příjmy do 50 000 Kč za rok bez povinnosti podat přiznání. Při překročení přiznání podáváš."
            status={result.limits.generalFiling50k.status}
          />
        )}
        {result.limits.limit100k.applicable ? (
          <LimitGauge
            label="Osvobození prodejů cenných papírů — 100 000 Kč"
            hint="Do 100 000 Kč tržeb z prodeje cenných papírů za rok (§ 4 odst. 1 písm. t) jsou VŠECHNY osvobozené, i bez 3 let držení. Nad limit se daní prodeje bez splněného časového testu. Neplatí pro cenné papíry zahrnuté v obchodním majetku."
            status={result.limits.limit100k}
          />
        ) : (
          /* R-02f: s cennými papíry v obchodním majetku osvobození neexistuje —
             pool je nulový, takže měřák hlásil „0 / 100 000, v pořádku“ přesně
             tam, kde se daní každý prodej (nález A1-3-04) */
          <Card className="space-y-1.5">
            <CardTitle>Obchodní majetek: osvobození neexistuje</CardTitle>
            <p className="font-mono text-lg font-medium">
              {czk(result.securities.totalGrossProceedsCzk)}
              <span className="text-sm text-inkoust-tlumeny"> zdanitelných tržeb</span>
            </p>
            <p className="text-sm font-semibold text-cervena">daní se každý prodej</p>
            <p className="pt-1 text-xs text-inkoust-tlumeny">
              Máš v nastavení uvedeno, že cenné papíry patří do tvého obchodního majetku.
              Roční limit 100 000 Kč ani tříletý časový test se na ně nevztahují (§ 4 odst.
              1 písm. t a u) — a neplatí ani tři roky po ukončení činnosti.
            </p>
          </Card>
        )}
        {hasCrypto &&
          (result.limits.cryptoLimit100k.applicable ? (
            <LimitGauge
              label="Osvobození krypta — 100 000 Kč"
              hint="Samostatný limit pro kryptoaktiva (§ 4 odst. 1 písm. zj zákona o daních z příjmů), nezávislý na limitu pro cenné papíry: jsou-li tržby z prodejů a směn krypta za rok do 100 000 Kč, jsou osvobozené. Neplatí pro stablecoiny (elektronické peněžní tokeny) a pro příjmy před 15. 2. 2025."
              status={result.limits.cryptoLimit100k}
            />
          ) : (
            /* R-10b: do roku 2024 krypto žádné osvobození nemá — měřák
               „0 / 100 000, v pořádku“ by tvrdil pravý opak toho, co platí */
            <Card className="space-y-1.5">
              <CardTitle>Krypto {year}: osvobození neexistuje</CardTitle>
              <p className="font-mono text-lg font-medium">
                {czk(result.crypto.totalGrossProceedsCzk)}
                <span className="text-sm text-inkoust-tlumeny"> zdanitelných tržeb</span>
              </p>
              <p className="text-sm font-semibold text-cervena">daní se každý prodej</p>
              <p className="pt-1 text-xs text-inkoust-tlumeny">
                Roční limit 100 000 Kč ani tříletý časový test pro kryptoaktiva za rok {year}{' '}
                neplatí — zavedl je až zákon č. 32/2025 Sb. s účinností od 15. 2. 2025.
                Zdanitelný je proto každý prodej i směna, bez ohledu na výši tržeb a dobu držení.
              </p>
            </Card>
          ))}
        {/* horizontální pás přes celý řádek — karta nesmí sedět osaměle v 1/3 gridu */}
        <Card className="md:col-span-2 xl:col-span-3">
          <div className="grid gap-4 md:grid-cols-[minmax(10rem,1fr)_2fr] md:items-center">
            <div className="space-y-1">
              <CardTitle>Orientační daň z investic</CardTitle>
              <p className="font-mono text-xl font-semibold sm:text-2xl">
                {czk(
                  result.tax.recommended === 'GENERAL'
                    ? result.tax.general.taxCzk
                    : result.tax.separate16a.taxCzk,
                )}
              </p>
            </div>
            <div className="grid gap-x-6 gap-y-2 text-xs text-inkoust-tlumeny sm:grid-cols-2">
              <p>
                Základ § 10: {czk(base10Total)}
                {base10Parts.length > 0 && (
                  <> ({base10Parts.map((p) => `${p.label} ${czk(p.value)}`).join(' · ')})</>
                )}
                {exemptNotes.length > 0 && <> — {exemptNotes.join(', ')}</>}
                {' '}· § 8 (dividendy a úroky): {czk(result.dividends.base8Czk)}
                {/* E-27: nedoporučujeme variantu zdanění § 8 — ukážeme obě čísla
                    a volbu necháme na uživateli (docs/13 V-4) */}
                {result.dividends.base8Czk.gt(0) &&
                  ` · daň v obecném základu ${czk(result.tax.general.taxCzk)}, v samostatném základu § 16a ${czk(result.tax.separate16a.taxCzk)} (před slevami — variantu volíš v přiznání)`}
              </p>
              <p>{result.tax.note}</p>
            </div>
          </div>
        </Card>
      </section>

      {(limit100kChart.points.length > 1 || (flatTax50kChart?.points.length ?? 0) > 1) && (
        <section className="grid gap-4 lg:grid-cols-2">
          {limit100kChart.points.length > 1 && (
            <Card>
              <CardTitle>Čerpání limitu 100 000 Kč v průběhu roku</CardTitle>
              <p className="mb-2 mt-1 text-xs text-inkoust-tlumeny">
                Kumulativní tržby z prodejů CP; přerušované čáry = pásma 60/85/100 %.
              </p>
              <LimitDrawdownChart series={limit100kChart} name="Tržby z prodejů" />
            </Card>
          )}
          {flatTax50kChart && flatTax50kChart.points.length > 1 && (
            <Card>
              <CardTitle>Čerpání limitu 50 000 Kč v průběhu roku</CardTitle>
              <p className="mb-2 mt-1 text-xs text-inkoust-tlumeny">
                Zdanitelné příjmy mimo samostatnou činnost (podnikání) — neosvobozené prodeje,
                zahraniční dividendy, úroky.
              </p>
              <LimitDrawdownChart series={flatTax50kChart} name="Zdanitelné příjmy" />
            </Card>
          )}
        </section>
      )}

      {result.options.limit100kIncludesTimeTestExempt &&
        !result.securities.exemptUnder100k &&
        result.securities.totalGrossProceedsCzk
          .sub(result.securities.timeTestExemptProceedsCzk)
          .lte(result.limits.limit100k.limitCzk) && (
          <Card className="space-y-1">
            <CardTitle>Mohlo by tě zajímat</CardTitle>
            <p className="text-sm">
              Počítáme bezpečným výkladem: do limitu 100k vstupují i prodeje osvobozené časovým
              testem. Podle mírnějšího (sporného) výkladu by tvůj úhrn byl jen{' '}
              <span className="font-mono">
                {czk(
                  result.securities.totalGrossProceedsCzk.sub(
                    result.securities.timeTestExemptProceedsCzk,
                  ),
                )}
              </span>{' '}
              a všechny letošní prodeje by byly osvobozené. Výklad si můžeš přepnout v Nastavení —
              rozhodnutí (a riziko) je na tobě.
            </p>
          </Card>
        )}

      {/* H4: graf a tabulka jsou dvě zobrazení téže informace — jednotný nadpis,
          přepínač pohledu; default graf (bez JS se vykreslí ten). Bez otevřených
          pozic by přepínač stál nad prázdnem — místo něj poctivý prázdný stav. */}
      <Card>
        {positions.length > 0 ? (
          <ViewSwitch
            title="Horizont osvobození"
            ariaLabel="Zobrazení horizontu osvobození"
            defaultKey="graf"
            views={[
              {
                key: 'graf',
                label: 'Graf',
                content: (
                  <HorizonStrip
                    dots={horizonDots(positions, labels, prices, currentYear)}
                    today={today}
                    outlook={exemptionOutlook(positions, prices, today, currentYear)}
                    embedded
                  />
                ),
              },
              {
                key: 'tabulka',
                label: 'Tabulka',
                content: (
                  <PositionsTable
                    positions={positions}
                    labels={labels}
                    names={instrumentNames(txs)}
                    embedded
                    basePath={basePath}
                  />
                ),
              },
            ]}
          />
        ) : (
          <>
            <CardTitle>Horizont osvobození</CardTitle>
            <p className="mt-2 text-sm text-inkoust-tlumeny">
              Žádné otevřené pozice — jakmile nějakou koupíš, uvidíš tady, kdy se
              osvobodí od daně (3letý časový test).
            </p>
          </>
        )}
      </Card>

      {importantWarnings.length > 0 && (
        <Card className="space-y-2">
          {/* počet = zobrazené skupiny, ne surová varování — „(10)“ nad třemi
              bloky mátlo; násobnost nese detail skupiny („8×“) */}
          <CardTitle>Kontroly výpočtu ({groupByCode(importantWarnings).length})</CardTitle>
          <WarningsList
            warnings={importantWarnings}
            labels={labels}
            forfeitedWithholdingCzk={forfeitedWithholdingCzk}
          />
        </Card>
      )}

      {notifications.length > 0 && (
        <Card className="space-y-2">
          <CardTitle>Poslední upozornění</CardTitle>
          {notifications.map((notification) => (
            <div key={notification.dedupeKey} className="text-sm">
              <span className="font-medium">{notification.title}</span>{' '}
              <span className="text-xs text-inkoust-tlumeny">
                · {czDate(notification.createdAt)}
              </span>
              <p className="text-inkoust-tlumeny">{notification.body}</p>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
