import { positionsAt, simulateSale, analyzeTaxYear, type EngineInput } from '@danero/engine';
import type { DisposalReport, LimitStatus } from '@danero/engine';
import { d, ZERO, type Money, type Transaction } from '@danero/shared';
import { AppToolbar } from '@/components/app-toolbar';
import { LimitBar, ZONE_LABEL, ZONE_TEXT, zoneForRatio } from '@/components/limit-gauge';
import {
  SimulatorWorkbench,
  type SimulatorField,
  type SimulatorOption,
} from '@/components/simulator-form';
import { TAX_NAME } from '@/components/tax-figure';
import { Disclosure } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { InfoPopover } from '@/components/ui/info-popover';
import { TextLink } from '@/components/ui/link';
import { Group, GroupItem, Row } from '@/components/ui/list';
import { Notice } from '@/components/ui/notice';
import { Section } from '@/components/ui/section';
import { Stat } from '@/components/ui/stat';
import { StatusLabel, type Tone } from '@/components/ui/status';
import { czk, METHOD_LABEL, pct, qty } from '@/lib/format';
import { LIMIT_NAME, limitWithAmount } from '@/lib/limit-names';
import { taxSummary } from '@/lib/payable-tax';
import {
  engineInputForUser,
  instrumentLabels,
  instrumentNames,
  type ProfileRow,
} from '@/lib/portfolio';
import type { InstrumentPrice } from '@/lib/prices';
import { normalizeNumberInput, simulationKey } from '@/lib/simulator-input';
import {
  regimeLimitFor,
  simulatorVerdict,
  type RegimeLimit,
  type SimulatorVerdict,
} from '@/lib/simulator-verdict';
import { tidy } from '@/lib/typography';
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
 * Řádek výběru pozice: ticker a název. Pozice bez tickeru má popiskem název —
 * ten se pak nepřipojuje podruhé („ČEZ — ČEZ“, „AMD — AMD“; R2-06, R1B-30).
 * Export kvůli unit testům.
 */
export const optionLabel = (label: string, name: string | undefined): string =>
  name && name !== label ? `${label} — ${name}` : label;

/**
 * Sdílené tělo simulátoru prodeje: zadání vlevo, odpověď vpravo. Výpočet dopadu
 * (`simulateSale`) je čistá funkce nad transakcemi — reálná stránka je dodá
 * z DB, demo z ukázkového datasetu. `basePath` směruje odkazy.
 *
 * Otázka stránky je „co se stane s daní a limity, když tohle prodám“, takže
 * odpověď má tři vrstvy: verdikt jednou větou, daň před a po, limity před a po.
 * Rozpad tržby je až pod nimi; metodika ve vysvětlivkách.
 */
export function SimulatorView({
  txs,
  profile,
  today,
  params,
  dailyRates,
  prices,
  basePath = '',
  precomputedBaseline,
}: {
  txs: Transaction[];
  profile: ProfileRow;
  today: string;
  params: SimParams;
  dailyRates?: EngineInput['dailyRates'];
  /** Poslední známé ceny od brokera — předvyplnění pole „Cena za kus“. */
  prices?: Map<string, InstrumentPrice>;
  basePath?: string;
  /** Baseline z page-guardu (EngineError) — bez něj by se engine počítal 2×. */
  precomputedBaseline?: ReturnType<typeof analyzeTaxYear>;
}) {
  const year = Number(today.slice(0, 4)); // rok z téhož okamžiku (UTC) jako today
  const input = engineInputForUser(txs, profile, year, dailyRates);
  const baseline = precomputedBaseline ?? analyzeTaxYear(input);
  // deriváty simulátor neumí (viz hláška níže) — do výběru pozic nepatří
  const positions = positionsAt(baseline.ledger, today).filter(
    (p) => p.totalRemaining.gt(0) && p.assetClass !== 'DERIVATIVE',
  );
  const labels = instrumentLabels(txs);
  const names = instrumentNames(txs);

  // Poslední známá cena od brokera se nabízí jen ve shodné měně — jiná by
  // uživatele zmátla.
  const lastPriceOf = (isin: string, currency: string): string | undefined => {
    const known = prices?.get(isin);
    return known && known.currency === currency ? known.price.toString() : undefined;
  };

  // řadíme podle tickeru/labelu (ISIN uživateli nic neříká)
  const options: SimulatorOption[] = [...positions]
    .sort((a, b) =>
      (labels.get(a.isin) ?? a.isin).localeCompare(labels.get(b.isin) ?? b.isin, 'cs'),
    )
    .map((position) => ({
      isin: position.isin,
      label: optionLabel(labels.get(position.isin) ?? position.isin, names.get(position.isin)),
      held: `${qty(position.totalRemaining)} ks`,
      currency: position.currency,
      lastPrice: lastPriceOf(position.isin, position.currency),
    }));

  const isinParam = firstParam(params.isin);
  const selected = positions.find((p) => p.isin === isinParam);
  const quantityParam = (firstParam(params.kusy) ?? '').trim();
  // Chybějící parametr ceny (odkaz z detailu pozice) se doplní poslední známou
  // cenou a simulace běží rovnou — odpověď má přijít bez dalšího kroku. Prázdný
  // parametr je něco jiného: pole uživatel vymazal a teprve píše.
  const priceParam = (
    firstParam(params.cena) ??
    (selected ? lastPriceOf(selected.isin, selected.currency) : undefined) ??
    ''
  ).trim();
  // číslo tak, jak ho píše aplikace („1 234,56“ s pevnou mezerou), se musí dát
  // do pole vložit — pole i klíč výsledku si přitom drží, co uživatel napsal
  const priceRaw = normalizeNumberInput(priceParam);
  const quantityRaw = normalizeNumberInput(quantityParam);

  // druh je vlastnost instrumentu — derivát poznáme z transakcí i bez pozice
  const isDerivativeIsin =
    isinParam !== undefined &&
    txs.some(
      (tx) =>
        'isin' in tx &&
        tx.isin === isinParam &&
        'assetClass' in tx &&
        tx.assetClass === 'DERIVATIVE',
    );

  // limit podle režimu (jako v přehledu) — čerpání (příjmy § 8–10) je pro
  // všechny režimy stejné, liší se jen strop a název; zaměstnanec nesmí vidět
  // nerelevantní paušální limit a OSVČ mimo paušál (podává přiznání vždy)
  // žádný režimový řádek — stejně jako přehled. Z téhož výběru bere limit
  // řádek i věta verdiktu, aby si neprotiřečily.
  const regimeLimit = regimeLimitFor(baseline.limits);

  let simulation: ReturnType<typeof simulateSale> | null = null;
  // chyba nese i pole, kterého se týká — jen tak ji jde svázat s inputem přes
  // aria-describedby / aria-invalid (WCAG 3.3.1)
  let formError: { field: SimulatorField; message: string } | null = null;
  if (isDerivativeIsin) {
    // R-12: deriváty nemají osvobození ani limity — simulace by lhala
    formError = {
      field: 'isin',
      message: 'Deriváty simulátor zatím neumí — daní se vždy, bez osvobození i limitů.',
    };
  } else if (selected && priceRaw !== '') {
    const quantity = quantityRaw === '' ? selected.totalRemaining.toString() : quantityRaw;
    // validace výhradně Decimalem — Number by u velkých vstupů přetekl do Infinity
    if (!NUM_RE.test(priceRaw) || !d(priceRaw).gt(0)) {
      formError = {
        field: 'price',
        message: 'Zadej cenu za kus — kladné číslo v měně instrumentu.',
      };
    } else if (d(priceRaw).gt(MAX_INPUT)) {
      formError = { field: 'price', message: 'To není reálná cena — zadej cenu do 1 000 000 000.' };
    } else if (!NUM_RE.test(quantity) || !d(quantity).gt(0)) {
      formError = { field: 'quantity', message: 'Počet kusů musí být kladné číslo.' };
    } else if (d(quantity).gt(MAX_INPUT)) {
      formError = { field: 'quantity', message: 'Zadej počet kusů do 1 000 000 000.' };
    } else if (selected.totalRemaining.lt(quantity)) {
      formError = {
        field: 'quantity',
        message: `Držíš jen ${qty(selected.totalRemaining)} ks — tolik prodat nejde.`,
      };
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

  const methodLabel =
    METHOD_LABEL[baseline.options.matchingMethod] ?? baseline.options.matchingMethod;

  return (
    <>
      <AppToolbar title="Simulátor" titleContext={String(year)} />
      <div className="max-w-[72rem] pt-2 md:pt-4">
        <SimulatorWorkbench
          action={`${basePath}/simulator`}
          options={options}
          selectedIsin={selected?.isin ?? ''}
          quantity={quantityParam}
          price={priceParam}
          resultKey={simulationKey(
            selected?.isin ?? '',
            quantityParam,
            firstParam(params.cena) ?? priceParam,
          )}
          error={formError}
          hasResult={simulation !== null}
        >
          {simulation && selected ? (
            <SimulationResult
              simulation={simulation}
              baseline={baseline}
              regimeLimit={regimeLimit}
              crypto={selected.assetClass === 'CRYPTO'}
              year={year}
              methodLabel={methodLabel}
              basePath={basePath}
            />
          ) : options.length === 0 ? (
            <EmptyState title="Žádné otevřené pozice">
              Simulovat jde prodej pozice, kterou právě držíš.
            </EmptyState>
          ) : selected && !formError ? (
            <EmptyState title="Zadej cenu za kus">
              Poslední cenu téhle pozice neznáme — doplň ji a hned uvidíš dopad.
            </EmptyState>
          ) : selected ? (
            <EmptyState title="Oprav zadání">
              Výsledek se ukáže, jakmile bude zadání platné.
            </EmptyState>
          ) : (
            <EmptyState title="Vyber pozici">
              Hned uvidíš, co prodej udělá s daní a s limity — ještě před obchodem.
            </EmptyState>
          )}
        </SimulatorWorkbench>
      </div>
    </>
  );
}

/** Barva verdiktu: zelená jen pro čistě osvobozený stav, modrá nikdy. */
const VERDICT_TONE: Record<SimulatorVerdict['kind'], Tone> = {
  EXEMPT_CLEAN: 'success',
  EXEMPT_DRAWS_LIMIT: 'caution',
  EXEMPT_BREAKS_100K: 'danger',
  BREAKS_REGIME_LIMIT: 'danger',
  TAXABLE: 'neutral',
};

/** Limit 100 000 Kč, o který prodej přijde — jménem z přehledu. */
const exemptionName = (crypto: boolean): string =>
  (crypto ? LIMIT_NAME.CRYPTO : LIMIT_NAME.SECURITIES).toLowerCase();

/** O kolik vzroste celková daň, když prodej zruší osvobození — jako dovětek věty. */
const retroactiveTax = (taxDeltaCzk: Money): string =>
  taxDeltaCzk.gt(0)
    ? ` Celková daň vzroste o ${czk(taxDeltaCzk)} — za všechny letošní prodeje, ne jen za tenhle.`
    : '';

/**
 * Verdikt ve třech vrstvách podle čisté funkce `simulatorVerdict`: stav jedním
 * slovem, nadpis a nejvýš jedna až dvě věty navíc. Poctivý i u řetězového
 * efektu — prodej, který zruší osvobození do 100 000 Kč, zpětně zdaní dřívější
 * letošní prodeje, a to musí být v nadpisu, ne pod čarou. Platí to pro prodej
 * osvobozený časovým testem i pro zdanitelný (R1B-04).
 *
 * Stav (`status`) je jen tam, kde k nadpisu něco přidává; „Zdanitelné“ nad
 * „Prodej je zdanitelný“ bylo totéž dvakrát (R1B-21).
 *
 * Částka limitu jde ze stavu limitu, ne z pevného textu (částky § 38g se od
 * roku 2027 mění), a limit se jmenuje stejnými slovy jako na přehledu
 * (`LIMIT_NAME`).
 *
 * Export kvůli unit testům — čistá funkce bez JSX.
 */
export function verdictText(verdict: SimulatorVerdict): {
  status?: string;
  tone: Tone;
  headline: string;
  detail?: string;
} {
  const tone = VERDICT_TONE[verdict.kind];
  switch (verdict.kind) {
    case 'EXEMPT_CLEAN':
      return {
        status: 'Osvobozeno',
        tone,
        headline: 'Prodej je celý osvobozený',
        detail: 'Limity ani daň nečerpá.',
      };
    case 'EXEMPT_BREAKS_100K':
      return {
        status: 'Přes limit',
        tone,
        headline: `Prodej zruší ${exemptionName(verdict.crypto)}`,
        detail:
          'Sám je osvobozený časovým testem, ale letošní prodeje s ním přesáhnou 100 000 Kč a ty dřívější se zpětně zdaní.' +
          retroactiveTax(verdict.taxDeltaCzk),
      };
    case 'EXEMPT_DRAWS_LIMIT':
      return verdict.taxDeltaCzk.gt(0)
        ? {
            status: 'Osvobozeno, ale daň vzroste',
            tone,
            headline: 'Prodej je osvobozený, ale daň se zvýší',
            detail: `Celková daň vzroste o ${czk(verdict.taxDeltaCzk)}.`,
          }
        : {
            status: 'Osvobozeno, čerpá limit',
            tone,
            headline: 'Prodej je osvobozený a daň nezvýší',
            detail: `Čerpá ale ${exemptionName(verdict.crypto)} (100 000 Kč za rok) — hlídej, kolik zbývá.`,
          };
    case 'BREAKS_REGIME_LIMIT': {
      const details = [
        // název limitu vedlejších příjmů sám neříká, co jeho prolomení znamená
        verdict.limit.kind === 'EMPLOYEE_SIDE_INCOME'
          ? 'Při překročení za rok podáváš daňové přiznání.'
          : null,
        verdict.brokenExemption
          ? `Zároveň zruší ${exemptionName(verdict.brokenExemption.crypto)}: letošní prodeje přesáhnou 100 000 Kč a zpětně se zdaní i ty dřívější.`
          : null,
      ].filter((part): part is string => part !== null);
      return {
        status: 'Přes limit',
        tone,
        headline: `Prodej prolomí ${limitWithAmount(verdict.limit.kind, verdict.limit.limitCzk)}`,
        detail: details.length > 0 ? details.join(' ') : undefined,
      };
    }
    case 'TAXABLE':
      return verdict.brokenExemption
        ? {
            status: 'Přes limit',
            tone: 'danger',
            headline: `Prodej zruší ${exemptionName(verdict.brokenExemption.crypto)}`,
            detail:
              'Letošní prodeje s ním přesáhnou 100 000 Kč, takže se zpětně zdaní i ty dřívější.' +
              retroactiveTax(verdict.brokenExemption.taxDeltaCzk),
          }
        : { tone, headline: 'Prodej je zdanitelný' };
  }
}

/** Částka „před → po“; beze změny jen jedna hodnota. */
function BeforeAfter({ before, after }: { before: string; after: string }) {
  if (before === after) return <>{after}</>;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-[0.35em]">
      <span className="text-ink-muted">{before}</span>
      <span aria-hidden className="text-ink-muted">
        →
      </span>
      <span className="sr-only">, po prodeji </span>
      <span>{after}</span>
    </span>
  );
}

function SimulationResult({
  simulation,
  baseline,
  regimeLimit,
  crypto,
  year,
  methodLabel,
  basePath,
}: {
  simulation: ReturnType<typeof simulateSale>;
  baseline: ReturnType<typeof analyzeTaxYear>;
  regimeLimit: RegimeLimit | null;
  /** Prodává se kryptoaktivum — čerpá vlastní limit 100 000 Kč. */
  crypto: boolean;
  year: number;
  methodLabel: string;
  basePath: string;
}) {
  const verdict = simulatorVerdict(simulation, regimeLimit);
  const text = verdictText(verdict);
  const taxDelta = simulation.deltas.taxCzk;

  // R-09f: „Orientační daň“ je daň, kdyby se podávalo přiznání. Pod limitem
  // režimu se neplatí; prodej, který limit prolomí, spustí daň ze všech
  // letošních příjmů. Kdo je nad limitem už před prodejem, nic nového nečte.
  const incomeBefore = simulation.baseline.flatTax50kUsedCzk;
  const incomeAfter = simulation.simulated.flatTax50kUsedCzk;
  const underLimitBefore = regimeLimit !== null && !incomeBefore.gt(regimeLimit.limitCzk);
  const breaksRegimeLimit = underLimitBefore && incomeAfter.gt(regimeLimit.limitCzk);
  const staysUnderLimit = underLimitBefore && !breaksRegimeLimit;

  // Paušalista nad limitem už před prodejem: na přehledu a v reportu je jeho
  // hlavní číslo doplatek po odečtení záloh. Simulátor ukazuje daň před a po —
  // rozdíl je stejný —, takže tu zálohy stojí aspoň jako pár slov u čísla,
  // jinak by 2 180 Kč tady a 980 Kč na přehledu vypadaly jako rozpor (R1B-03).
  const advances = taxSummary(baseline).advances;

  const taxNote = [
    taxDelta.gt(0) ? `+${czk(taxDelta)}` : taxDelta.lt(0) ? `${czk(taxDelta)}` : 'beze změny',
    staysUnderLimit ? 'platí se jen při podání přiznání' : null,
    advances ? `před odečtením záloh ${czk(advances.totalCzk)}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  const disposal = simulation.simulatedDisposal;

  return (
    <div className="space-y-12">
      <div className="flex flex-wrap items-end gap-x-16 gap-y-7" aria-live="polite">
        <section aria-label="Verdikt">
          {text.status && <StatusLabel tone={text.tone}>{text.status}</StatusLabel>}
          <h2 className={cn('type-title-1 max-w-[24ch] text-balance', text.status && 'mt-3')}>
            {tidy(text.headline)}
          </h2>
          {text.detail && (
            <p className="type-body mt-3 max-w-[52ch] text-pretty text-ink-muted">
              {tidy(text.detail)}
            </p>
          )}
        </section>
        <dl className="flex flex-wrap items-end gap-x-12 gap-y-6">
          <Stat
            size="lg"
            label={TAX_NAME}
            value={
              <BeforeAfter
                before={czk(simulation.baseline.taxCzk)}
                after={czk(simulation.simulated.taxCzk)}
              />
            }
            note={taxNote}
            info={
              <InfoPopover label={TAX_NAME} title="Daň před prodejem a po něm">
                <p>
                  Změna orientační daně proti stavu bez prodeje. Zahrnuje celoroční dopad, takže
                  může převýšit i tržbu tohoto prodeje — třeba když prolomí limit a zdaní ostatní
                  letošní prodeje.
                </p>
                {advances && (
                  <p>
                    {tidy(
                      `Od daně se ti odečtou zaplacené zálohy z paušálního režimu (${czk(advances.totalCzk)}) — doplatek je o ně nižší před prodejem i po něm, rozdíl zůstává stejný.`,
                    )}
                  </p>
                )}
                {staysUnderLimit && regimeLimit && (
                  <p>
                    Pod limitem {czk(regimeLimit.limitCzk)} přiznání nepodáváš, takže tuhle
                    orientační daň neplatíš — ani po tomhle prodeji. Počítáme jen s příjmy, o
                    kterých Danero ví.
                  </p>
                )}
              </InfoPopover>
            }
          />
          {disposal && (
            <Stat
              size="lg"
              label="Zdanitelná tržba"
              value={czk(disposal.taxableProceedsCzk)}
              // „z 61 622 Kč“ pod „61 622 Kč“ nic neříká (R1B-21)
              note={
                disposal.taxableProceedsCzk.eq(disposal.grossProceedsCzk)
                  ? 'celá tržba'
                  : `z ${czk(disposal.grossProceedsCzk)}`
              }
            />
          )}
        </dl>
      </div>

      {breaksRegimeLimit && regimeLimit && (
        <FilingConsequence limit={regimeLimit} hypotheticalTaxCzk={simulation.simulated.taxCzk} />
      )}

      <Section title="Limity po prodeji">
        <div role="list" className="divide-y divide-line/70">
          {regimeLimit && (
            <LimitChange
              name={regimeLimit.label}
              beforeCzk={incomeBefore}
              afterCzk={incomeAfter}
              limitCzk={regimeLimit.limitCzk}
            />
          )}
          {crypto ? (
            baseline.limits.cryptoLimit100k.applicable ? (
              <LimitChange
                name={LIMIT_NAME.CRYPTO}
                beforeCzk={simulation.baseline.cryptoLimit100kUsedCzk}
                afterCzk={simulation.simulated.cryptoLimit100kUsedCzk}
                limitCzk={baseline.limits.cryptoLimit100k.limitCzk}
                exceeded={!simulation.simulated.cryptoExemptUnder100k}
              />
            ) : (
              /* R-10b: v roce bez krypto osvobození žádný limit není — řádek
                 „0 z 100 000“ by tvrdil, že je co čerpat */
              <NoLimit
                name={`Krypto ${year}`}
                info={
                  <InfoPopover label={`Krypto ${year}`} title="Osvobození neexistuje">
                    <p>
                      Limit 100 000 Kč ani tříletý test pro kryptoaktiva za rok {year} neplatí
                      (zavedl je až zákon č. 32/2025 Sb. od 15. 2. 2025) — tenhle prodej se zdaní
                      celý{regimeLimit ? ` a naplno čerpá ${regimeLimit.label.toLowerCase()}` : ''}.
                    </p>
                  </InfoPopover>
                }
              />
            )
          ) : baseline.limits.limit100k.applicable ? (
            <LimitChange
              name={LIMIT_NAME.SECURITIES}
              beforeCzk={simulation.baseline.limit100kUsedCzk}
              afterCzk={simulation.simulated.limit100kUsedCzk}
              limitCzk={baseline.limits.limit100k.limitCzk}
              exceeded={!simulation.simulated.exemptUnder100k}
            />
          ) : (
            /* R-02f: s cennými papíry v obchodním majetku osvobození neexistuje */
            <NoLimit
              name="Cenné papíry v obchodním majetku"
              info={
                <InfoPopover label="Cenné papíry v obchodním majetku" title="Osvobození neexistuje">
                  <p>
                    {tidy(
                      'Máš v nastavení uvedeno, že cenné papíry patří do tvého obchodního majetku. Roční limit 100 000 Kč ani tříletý časový test se na ně nevztahují.',
                    )}
                  </p>
                </InfoPopover>
              }
            />
          )}
        </div>
      </Section>

      {disposal && (
        <Section
          title="Rozpad prodeje"
          info={
            <InfoPopover label="Rozpad prodeje" title="Jak simulace počítá">
              <p>
                Počítá s prodejem k dnešnímu dni za zadanou cenu, párování metodou {methodLabel}.
                Výdaj je nabývací cena zdanitelné části, přepočtená kurzem roku nákupu.
              </p>
              <p>
                <TextLink href={`${basePath}/report`} chevron>
                  Report
                </TextLink>
              </p>
            </InfoPopover>
          }
        >
          <SaleBreakdown disposal={disposal} />
        </Section>
      )}
    </div>
  );
}

/**
 * Co znamená, když prodej prolomí limit režimu (R-09f, R-08f): přiznání se
 * podá za celý rok a zdaní se v něm všechny letošní příjmy z investic, ne jen
 * tenhle prodej. U paušalisty přibude podnikání a pojistné, proto věta žádné
 * „zaplatíš X“ neslibuje.
 */
function FilingConsequence({
  limit,
  hypotheticalTaxCzk,
}: {
  limit: RegimeLimit;
  /** Orientační daň po prodeji — daň, kdyby se přiznání podávalo. */
  hypotheticalTaxCzk: Money;
}) {
  const taxClause = hypotheticalTaxCzk.gt(0)
    ? `orientačně ${czk(hypotheticalTaxCzk)}`
    : 'i když z nich daň vyjde nulová';
  return (
    <Notice
      tone="danger"
      title="V přiznání se zdaní všechny letošní příjmy z investic, ne jen tenhle prodej"
    >
      <Disclosure summary="Co to znamená">
        <p>
          {limit.kind === 'FLAT_TAX' ? (
            <>
              Tímhle prodejem překročíš {limitWithAmount(limit.kind, limit.limitCzk)}. Za celý rok
              pak podáš běžné přiznání: zdaní se v něm{' '}
              <strong className="text-ink">všechny letošní zdanitelné příjmy z investic</strong> (
              {taxClause}), ne jen tenhle prodej, a k tomu podnikání — doplatíš i pojistné a
              zaplacené paušální zálohy se započtou. Tu část Danero spočítat neumí.
            </>
          ) : (
            <>
              Tímhle prodejem překročíš {limitWithAmount(limit.kind, limit.limitCzk)}, pod kterým
              přiznání nepodáváš. Zdaní se v něm{' '}
              <strong className="text-ink">všechny letošní zdanitelné příjmy z investic</strong> (
              {taxClause}), ne jen tenhle prodej.
            </>
          )}{' '}
          Počítáme jen s příjmy, o kterých Danero ví.
        </p>
      </Disclosure>
    </Notice>
  );
}

/**
 * Řádek limitu po prodeji: název a čerpání „před → po“, odměrka stavu po
 * prodeji, pod ní částky a slovní stav. Červená jen u prolomeného limitu.
 */
function LimitChange({
  name,
  beforeCzk,
  afterCzk,
  limitCzk,
  exceeded,
}: {
  name: string;
  beforeCzk: Money;
  afterCzk: Money;
  limitCzk: Money;
  /** Stav z enginu, kde ho známe přesněji než z poměru (úhrn 100 000 Kč). */
  exceeded?: boolean;
}) {
  const ratioOf = (value: Money): number => (limitCzk.gt(0) ? value.div(limitCzk).toNumber() : 0);
  const before = ratioOf(beforeCzk);
  const after = ratioOf(afterCzk);
  const zone: LimitStatus['zone'] = exceeded ? 'EXCEEDED' : zoneForRatio(after);
  // O kolik prodej čerpání zvedne. Když zruší osvobození do 100 000 Kč, je to
  // víc než jeho tržba (do limitu se vrátí i dřívější prodeje) — bez téhle
  // částky si rozdíl musel čtenář dopočítat (R5-18).
  const increase = afterCzk.sub(beforeCzk);
  return (
    <GroupItem>
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-medium">{name}</span>
        <span className={cn('font-semibold tabular-nums', ZONE_TEXT[zone])}>
          <BeforeAfter before={pct(before * 100)} after={pct(after * 100)} />
        </span>
      </div>
      <LimitBar ratio={after} zone={zone} className="mt-2.5" />
      <div className="type-footnote mt-2 flex items-baseline justify-between gap-4 text-ink-muted">
        <span className="tabular-nums">
          <BeforeAfter before={czk(beforeCzk)} after={czk(afterCzk)} /> z {czk(limitCzk)}
          {increase.gt(0) && <> · +{czk(increase)}</>}
        </span>
        <span className={cn('shrink-0', ZONE_TEXT[zone])}>{ZONE_LABEL[zone]}</span>
      </div>
    </GroupItem>
  );
}

/** Řádek pro případ, kdy limit neexistuje a daní se každý prodej. */
function NoLimit({ name, info }: { name: string; info: React.ReactNode }) {
  return (
    <GroupItem>
      <div className="flex items-baseline justify-between gap-4">
        <span className="inline-flex items-center gap-1 font-medium">
          {name}
          {info}
        </span>
        <span className="font-semibold text-danger">bez limitu</span>
      </div>
      <p className="type-footnote mt-1 text-danger">daní se každý prodej</p>
    </GroupItem>
  );
}

/**
 * Rozpad tržby: jeden pruh rozdělený na osvobozenou část, výdaj a základ daně
 * (dohromady dají tržbu) a pod ním tytéž části čísly. Legendou pruhu jsou
 * řádky pod ním — žádné osy ani popisky navíc.
 */
function SaleBreakdown({ disposal }: { disposal: DisposalReport }) {
  const gross = disposal.grossProceedsCzk;
  if (!gross.gt(0)) return null;
  const exempt = disposal.exemptProceedsCzk;
  const taxable = disposal.taxableProceedsCzk;
  const expense = disposal.allocations.reduce(
    (sum, allocation) => sum.plus(allocation.expenseCzk),
    ZERO,
  );
  const isLoss = taxable.sub(expense).lt(0);
  const base = isLoss ? ZERO : taxable.sub(expense);
  // v pruhu se výdaj kreslí nejvýš do výše zdanitelné tržby (ztráta nemá kam přetéct)
  const expenseShown = isLoss ? taxable : expense;

  const parts = [
    { key: 'exempt', label: 'Osvobozeno', value: exempt, shown: exempt, color: 'bg-success' },
    {
      key: 'expense',
      label: 'Výdaj',
      value: expense,
      shown: expenseShown,
      color: 'bg-ink-muted',
    },
    { key: 'base', label: 'Základ daně', value: base, shown: base, color: 'bg-chart-1' },
  ];
  const percent = (value: Money): number => value.div(gross).toNumber() * 100;

  return (
    <div>
      <div aria-hidden className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
        {parts
          .filter((part) => part.shown.gt(0))
          .map((part) => (
            <span
              key={part.key}
              className={cn('h-full min-w-1', part.color)}
              style={{ width: `${percent(part.shown)}%` }}
            />
          ))}
      </div>
      <Group
        className="mt-3"
        aria-label="Rozpad tržby"
        footer={isLoss ? 'Prodej je ve ztrátě — základ daně z něj je nulový.' : undefined}
      >
        {/* Tečka je legenda pruhu; „Tržba“ je celek, tečku nemá — ale místo
            pro ni ano, ať popisky všech čtyř řádků lícují (R1B-21). */}
        <Row
          label={
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="size-2 shrink-0" />
              Tržba
            </span>
          }
          value={czk(gross)}
        />
        {parts.map((part) => (
          <Row
            key={part.key}
            label={
              <span className="inline-flex items-center gap-2">
                <span aria-hidden className={cn('size-2 shrink-0 rounded-full', part.color)} />
                {part.label}
              </span>
            }
            value={czk(part.value)}
          />
        ))}
      </Group>
    </div>
  );
}
