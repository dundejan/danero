import {
  d,
  sum,
  yearOf,
  type DividendTransaction,
  type InterestTransaction,
  type Money,
  type TaxpayerProfile,
  type Transaction,
} from '@danero/shared';
import { computeDerivatives, type DerivativesResult } from './basis/derivatives';
import {
  computeShortSales,
  isShortSaleTrade,
  warnOpenShorts,
  type ShortSalesResult,
} from './basis/shortSales';
import { computeDividends, type DividendsResult } from './basis/dividends';
import { isDisputedEmtIdentifier } from './basis/emt';
import {
  capExposedProceedsCzk,
  computeSecurities,
  prepareDisposals,
  type PreparedDisposals,
  type SecuritiesResult,
} from './basis/securities';
import { resolveOptions, type EngineOptions } from './config/options';
import type { AssetScope, TaxYearConfig } from './config/taxYear';
import { czDateText, czkText, pctText } from './format';
import { FxConverter, type DailyRateProvider } from './fx/fx';
import { buildLedger, type Ledger } from './ledger/ledger';
import { computeLimits, type LimitsResult } from './limits/limits';
import { estimateTax, type TaxEstimate } from './tax/estimate';
import {
  classifyTimeTest,
  positionsAt,
  type Position,
  type TimeTestContext,
} from './timetest/timeTest';
import { WarningCollector, type EngineWarning } from './warnings';

export interface EngineInput {
  /** Kompletní historie transakcí od prvního nákupu — bez ní nelze párování ani časový test. */
  transactions: Transaction[];
  profile: TaxpayerProfile;
  config: TaxYearConfig;
  options?: Partial<EngineOptions>;
  dailyRates?: DailyRateProvider;
}

export interface TaxYearResult {
  year: number;
  /** Použitá konfigurace přepínačů — tiskne se do reportu (průkaznost). */
  options: EngineOptions;
  securities: SecuritiesResult;
  /**
   * R-13: prodeje nakrátko. Jsou součástí druhu `securities` (týž kód D, tatáž
   * stovka), ale nemají loty, takže v rozpisu prodejů nefigurují — report je
   * vypisuje zvlášť, aby čísla druhu šla dohledat do posledního řádku.
   */
  shortSales: ShortSalesResult;
  /** R-10: kryptoaktiva — jiný druh příjmu § 10 s vlastními limity (zj/zk), bez kompenzace s CP. */
  crypto: SecuritiesResult;
  /** R-12: deriváty — třetí druh § 10 bez jakéhokoli osvobození, bez kompenzace s CP/kryptem. */
  derivatives: DerivativesResult;
  dividends: DividendsResult;
  limits: LimitsResult;
  tax: TaxEstimate;
  /** Otevřené pozice k 31. 12. cílového roku (hlídač volá positionsAt s dneškem). */
  positions: Position[];
  ledger: Ledger;
  warnings: EngineWarning[];
}

/**
 * R-03/R-10d/R-10e: strop § 4 odst. 3 je SPOLEČNÝ přes druhy příjmů, na které se
 * v daném roce vztahuje (2025: CP + krypto; od 2026 jen krypto). Poměr osvobození =
 * strop / kombinovaný úhrn časově osvobozených příjmů; krácení pak každý druh
 * aplikuje na své alokace. Čistá funkce nad připravenými daty obou druhů.
 */
function resolveSharedCapRatios(
  config: TaxYearConfig,
  prepared: Record<AssetScope, PreparedDisposals>,
  warnings: WarningCollector,
  includesTimeTestExempt: boolean,
  valueExemptionAvailable: Record<AssetScope, boolean>,
  /** R-13e: tržby ze shortů čerpají pool 100k druhu CP — test uvnitř stropu
      musí vidět tentýž úhrn jako `computeSecurities`, jinak by u téhož roku
      vycházel jednou osvobozený a jednou ne. */
  shortProceedsCzk: Money,
): Record<AssetScope, Money> {
  const ratios: Record<AssetScope, Money> = { SECURITIES: d(1), CRYPTO: d(1) };
  const cap = config.limits.timeTestCap;
  if (!cap) return ratios;
  const capCzk = d(cap.amountCzk);
  // § 4 odst. 3 váže strop VÝHRADNĚ na osvobození podle q), u) a zk) — tedy na
  // časový test a podíly. Hodnotový limit t)/zj) v tom výčtu není, takže druh,
  // jehož úhrn tržeb se vejde do 100 000 Kč, je osvobozený hodnotově a do stropu
  // nemá co přinést ani z něj co ubrat. Bez téhle podmínky vycházela absurdita:
  // táž krypto tržba 90 000 Kč dala při držbě 5 let VYŠŠÍ daň než při držbě
  // 1 rok (1 028 289,84 vs. 1 015 915,84 Kč), protože delší držba ji přesunula
  // pod strop sdílený s cennými papíry (nález A2-9).
  //
  // Pozor na podmínku: „úhrn do 100k" osvobozuje časově osvobozené tržby jen
  // tehdy, když do toho úhrnu vůbec vstupují — tedy při striktním výkladu R-02c
  // (default). Při mírnějším výkladu je pool klidně nulový, a přesto jsou desítky
  // milionů osvobozené časovým testem podle u)/zk), takže strop na ně dopadá
  // plnou vahou (golden test „strop platí i při mírnějším výkladu limitu 100k").
  // R-03a: vyloučení hodnotově osvobozených příjmů je per PRODEJ, ne per druh —
  // prodej stablecoinu osvobozený časovým testem stojí čistě na zk) a strop na
  // něj dopadá, i když úhrn ostatních tržeb druhu zůstane pod 100 000 Kč
  // (nález A2-3-01). Formule je sdílená s `computeSecurities`, aby se ukazatel
  // v UI nemohl rozejít s výpočtem.
  const exposed: Record<AssetScope, Money> = {
    SECURITIES: capExposedProceedsCzk(prepared.SECURITIES, {
      exemptionLimitCzk: d(config.limits.securitiesProceedsExemption),
      valueExemptionAvailable: valueExemptionAvailable.SECURITIES,
      includesTimeTestExempt,
      extraPoolCzk: shortProceedsCzk,
    }),
    CRYPTO: capExposedProceedsCzk(prepared.CRYPTO, {
      exemptionLimitCzk: d(config.limits.cryptoProceedsExemption),
      valueExemptionAvailable: valueExemptionAvailable.CRYPTO,
      includesTimeTestExempt,
    }),
  };
  const podStropem = cap.appliesTo.filter((scope) => exposed[scope].gt(0));
  const combined = sum(podStropem.map((scope) => exposed[scope]));
  if (combined.lte(capCzk)) return ratios;

  const ratio = capCzk.div(combined);
  const scopeLabel = podStropem
    .map((scope) => (scope === 'SECURITIES' ? 'CP' : 'kryptoaktiva'))
    .join(' + ');
  warnings.add(
    'CAP_40M_REDUCED',
    'WARNING',
    `Úhrn příjmů osvobozených časovým testem (${scopeLabel}) ${czkText(combined)} přesáhl strop ${czkText(capCzk)} (§ 4 odst. 3, R-03/R-10d). Osvobození je kráceno poměrně: osvobozeno zůstává ${pctText(ratio, 2)} těchto příjmů, zbytek vstupuje do dílčího základu § 10 s poměrnou částí výdajů. Rozhodný je moment přijetí peněz — zkontroluj vypořádání přes přelom roku.`,
  );
  // krátí se jen druhy, které do stropu skutečně vstoupily
  for (const scope of podStropem) ratios[scope] = ratio;
  return ratios;
}

/**
 * Kontext pro hlídač otevřených pozic: co všechno kromě tří let rozhoduje
 * o tom, jestli osvobození vůbec přijde (A2-3-04). Vytažené ven, aby si
 * aplikace mohla `positionsAt` zavolat s dneškem a se stejnými pravidly,
 * jaká používá výpočet roku.
 */
export function timeTestContext(input: EngineInput): TimeTestContext {
  return {
    securitiesInBusinessAssets: input.profile.hasSecuritiesInBusinessAssets,
    crypto: {
      available: input.config.cryptoRules.exemptionsAvailable,
      effectiveFrom: input.config.cryptoRules.effectiveFrom,
    },
    emtTimeTestExempt: resolveOptions(input.options).emtTimeTestExempt,
  };
}

/**
 * Čistá funkce (transakce, konfigurace) → výsledek. Žádné I/O, deterministická —
 * každý přepočet je plně reprodukovatelný od nuly (docs/04, klíčový invariant).
 */
export function analyzeTaxYear(input: EngineInput): TaxYearResult {
  const options = resolveOptions(input.options);
  const warnings = new WarningCollector();
  const fx = new FxConverter(input.config, options.fxMethod, warnings, input.dailyRates);
  const config = input.config;
  const year = config.year;

  // R-10/R-12: druh příjmu je vlastnost INSTRUMENTU, ne řádku — stačí jediná
  // transakce označená CRYPTO/DERIVATIVE a celý ISIN se počítá daným druhem.
  // Jinak by prodej s nevyplněným asset_class tiše sklouzl pod CP limit a test.
  const isinsOf = (assetClass: string) =>
    new Set(
      input.transactions.flatMap((tx) =>
        'assetClass' in tx && tx.assetClass === assetClass ? [tx.isin] : [],
      ),
    );
  const cryptoIsins = isinsOf('CRYPTO');
  const derivativeIsins = isinsOf('DERIVATIVE');

  // R-12: deriváty nejsou inventář CP — VŠECHNY transakce derivátového
  // instrumentu (obchody i převody) jdou mimo CP/krypto ledger do vlastního
  // výpočtu (short pozice, hotovostní prémie, MARGIN vypořádání)
  const isDerivativeIsin = (tx: Transaction): boolean =>
    'isin' in tx && typeof tx.isin === 'string' && derivativeIsins.has(tx.isin);
  const derivativeTxs = input.transactions.filter(
    (
      tx,
    ): tx is Extract<Transaction, { type: 'BUY' | 'SELL' | 'TRANSFER_IN' | 'TRANSFER_OUT' }> =>
      (tx.type === 'BUY' || tx.type === 'SELL' || tx.type === 'TRANSFER_IN' || tx.type === 'TRANSFER_OUT') &&
      derivativeIsins.has(tx.isin),
  );
  // R-13: prodeje nakrátko a jejich pokrytí do inventáře lotů NEPATŘÍ — short
  // žádný lot nespotřebovává a zpětný nákup není pořízení pozice. V ledgeru by
  // vyrobily `NEGATIVE_POSITION` (nulová nabývací cena) a fantomový lot.
  const shortSaleTxs = input.transactions.filter(
    (tx) => isShortSaleTrade(tx) && !isDerivativeIsin(tx) && !cryptoIsins.has(tx.isin),
  );
  const shortSaleIds = new Set(shortSaleTxs.map((tx) => tx.id));
  const ledgerTransactions = input.transactions
    .filter((tx) => !shortSaleIds.has(tx.id))
    .filter((tx) => {
      if (!isDerivativeIsin(tx)) return true;
      if (tx.type === 'CORPORATE_ACTION') {
        warnings.add(
          'DERIVATIVE_ACTION_UNSUPPORTED',
          'WARNING',
          `Korporátní akce na derivátovém instrumentu ${tx.isin} z ${czDateText(tx.date)} — u derivátů ji neumíme zpracovat, transakce je vynechána. Uprav historii ručně (např. uzavření a nové otevření pozice).`,
          { txId: tx.id },
        );
      }
      return false;
    })
    // Normalizaci druhu musí vidět UŽ ledger, ne až klasifikace za ním: dopočet
    // data vypořádání se řídí `assetClass` řádku (`inferSettlementDate`) a krypto
    // se vypořádává T+0. Řádek bez asset_class by dostal T+2, což posune rok
    // příjmu (R-05a) i hranici účinnosti krypto osvobození 15. 2. 2025 (R-10b).
    .map((tx) =>
      'assetClass' in tx && tx.assetClass !== 'CRYPTO' && cryptoIsins.has(tx.isin)
        ? { ...tx, assetClass: 'CRYPTO' as const }
        : tx,
    );

  // R-10/R-12: smíšené označení instrumentu (část transakcí bez asset_class)
  // normalizujeme na úroveň instrumentu — ale nahlas, ne tiše
  for (const [label, isins] of [
    ['kryptoaktivum', cryptoIsins],
    ['derivát', derivativeIsins],
  ] as const) {
    const mixed = input.transactions.find(
      (tx) =>
        (tx.type === 'BUY' || tx.type === 'SELL') &&
        isins.has(tx.isin) &&
        tx.assetClass !== (label === 'kryptoaktivum' ? 'CRYPTO' : 'DERIVATIVE'),
    );
    if (mixed && 'isin' in mixed) {
      warnings.add(
        'ASSET_CLASS_NORMALIZED',
        'INFO',
        `Instrument ${mixed.isin} má u části transakcí vyplněný druh ${label} a u části ne — počítáme celý instrument jako ${label}. Sjednoť sloupec asset_class v importu.`,
        { isin: mixed.isin },
      );
    }
  }
  const conflicting = [...derivativeIsins].filter((isin) => cryptoIsins.has(isin));
  if (conflicting.length > 0) {
    warnings.add(
      'ASSET_CLASS_CONFLICT',
      'ERROR',
      `Instrument ${conflicting[0]!} je v importu označen zároveň jako kryptoaktivum i derivát — počítáme ho jako derivát (bez osvobození = bezpečnější). Oprav asset_class v importu.`,
      { isins: conflicting },
    );
  }

  const ledger = buildLedger(ledgerTransactions, options, warnings, fx);
  classifyTimeTest(ledger.disposals, input.profile, cryptoIsins);
  const isCryptoDisposal = (disposal: (typeof ledger.disposals)[number]) =>
    cryptoIsins.has(disposal.isin);

  const yearDisposals = ledger.disposals.filter((disposal) => disposal.incomeYear === year);
  // R-02f: CP v obchodním majetku nemají ani hodnotové osvobození 100k (§ 4/1 t
  // je vylučuje stejně jako u) — prodeje jsou zdanitelné a pool 100k nečerpají
  const securitiesPrepared = prepareDisposals(
    yearDisposals.filter((disposal) => !isCryptoDisposal(disposal)),
    fx,
    options,
    { available: !input.profile.hasSecuritiesInBusinessAssets, effectiveFrom: null },
  );
  // R-10b: krypto osvobození až od účinnosti zák. č. 32/2025 Sb. (2025: od 15. 2.;
  // ZO ≤ 2024 žádné) — dřívější prodeje jsou plně zdanitelné a nečerpají limit 100k.
  // R-10a: detekce EMT (stablecoinů) podle tickeru — jen u druhu kryptoaktiva.
  const cryptoPrepared = prepareDisposals(
    yearDisposals.filter((disposal) => isCryptoDisposal(disposal)),
    fx,
    options,
    {
      available: config.cryptoRules.exemptionsAvailable,
      effectiveFrom: config.cryptoRules.effectiveFrom,
      detectEmt: true,
    },
  );

  const valueExemptionAvailable: Record<AssetScope, boolean> = {
    SECURITIES: !input.profile.hasSecuritiesInBusinessAssets,
    CRYPTO: config.cryptoRules.exemptionsAvailable,
  };
  // shorty musí být spočítané dřív než poměr stropu — jejich tržby patří do
  // téhož poolu 100k jako běžné prodeje CP
  const shortSales = computeShortSales(shortSaleTxs, year, fx, options, warnings);
  warnOpenShorts(shortSales, year, options, warnings);
  const capRatios = resolveSharedCapRatios(
    config,
    { SECURITIES: securitiesPrepared, CRYPTO: cryptoPrepared },
    warnings,
    options.limit100kIncludesTimeTestExempt,
    valueExemptionAvailable,
    shortSales.proceedsCzk,
  );
  // R-13: shorty jsou týž druh jako ostatní prodeje CP — počítají se zvlášť
  // (nemají loty), ale do stovky i do kompenzace vstupují dohromady s nimi.
  const securities = computeSecurities(
    securitiesPrepared,
    fx,
    {
      exemptionLimitCzk: d(config.limits.securitiesProceedsExemption),
      capExemptRatio: capRatios.SECURITIES,
      includesTimeTestExempt: options.limit100kIncludesTimeTestExempt,
      label: 'CP',
      lossRuleId: 'R-05d',
      valueExemptionAvailable: valueExemptionAvailable.SECURITIES,
      shortSales,
    },
    warnings,
  );
  const crypto = computeSecurities(
    cryptoPrepared,
    fx,
    {
      exemptionLimitCzk: d(config.limits.cryptoProceedsExemption),
      capExemptRatio: capRatios.CRYPTO,
      includesTimeTestExempt: options.limit100kIncludesTimeTestExempt,
      label: 'kryptoaktiv',
      lossRuleId: 'R-10c',
      valueExemptionAvailable: valueExemptionAvailable.CRYPTO,
    },
    warnings,
  );

  // R-10a/R-10g: prodeje detekovaných EMT (stablecoinů) — zj) je vylučuje vždy,
  // časový test zk) jen dle přepínače; poctivě vyčísli dopad mírnějšího výkladu.
  //
  // Ve zdaňovacím období před účinností novely (15. 2. 2025) žádné krypto
  // osvobození neexistuje, takže EMT nemá být vůči čemu vylučovat — varování
  // tam tvrdilo nesmysl („osvobození se na ně nevztahuje“, když se nevztahuje
  // na nic) a u čtyři roky drženého USDT i nepravdu o držbě (nález A2-3-09).
  if (config.cryptoRules.exemptionsAvailable && cryptoPrepared.emtProceedsCzk.gt(0)) {
    const testable = cryptoPrepared.emtTimeTestableProceedsCzk;
    const timeTestPart = options.emtTimeTestExempt
      ? `Máš zapnutý mírnější výklad (R-10g): časový test 3 roky stablecoiny osvobozuje — z prodejů to je ${czkText(testable)}. Opora je jen v doslovném textu § 4/1 zk); finanční správa výklad nepotvrdila a při sporu hrozí doměrek daně s příslušenstvím.`
      : testable.gt(0)
        ? `Při bezpečném výkladu se na stablecoiny neuplatňuje ani časový test 3 let; mírnější výklad (§ 4/1 zk) je na rozdíl od zj) nevylučuje) by osvobodil ${czkText(testable)} — přepínač najdeš v Nastavení. Riziko mírnějšího výkladu: nepotvrzený výklad, hrozí doměrek daně s příslušenstvím.`
        : `Při bezpečném výkladu se na stablecoiny neuplatňuje ani časový test 3 let (žádný z letošních prodejů ho zatím nesplňuje, mírnější výklad by nic nezměnil).`;
    warnings.add(
      'CRYPTO_EMT_DETECTED',
      'WARNING',
      `Prodeje stablecoinů (elektronických peněžních tokenů — EMT) za ${czkText(cryptoPrepared.emtProceedsCzk)}: osvobození do 100 000 Kč se na ně nevztahuje (§ 4/1 zj) je výslovně vylučuje) — prodeje jsou vždy zdanitelné dle § 10 s výdaji a jejich tržby se do úhrnu 100k nepočítají. ${timeTestPart}`,
      {
        emtProceedsCzk: cryptoPrepared.emtProceedsCzk.toFixed(2),
        emtTimeTestableCzk: testable.toFixed(2),
      },
    );
  }

  // R-10a/R-10g: DAI a USDD za sebou nemají fiat (nadkolateralizovaný, resp.
  // algoritmický) a část výkladu je proto mezi EMT neřadí. Primární pramen ale
  // svědčí opačně: MiCA čl. 3 odst. 1 bod 7 krytí vůbec nezmiňuje a bod
  // odůvodnění 41 výslovně říká, že na mechanismu udržování hodnoty nezáleží
  // a že totéž platí pro algoritmické stablecoiny (nález K7a-05). Držíme je tedy
  // ve vyloučení nejen jako bezpečný, ale i jako pravděpodobnější výklad —
  // a uživatel má právo vědět, kolik na tom sporu visí a že opačný výklad není
  // jednoznačně výhodnější (nemonotónnost úhrnu 100k).
  if (config.cryptoRules.exemptionsAvailable) {
    const disputed = crypto.disposals.filter((report) => isDisputedEmtIdentifier(report.isin));
    if (disputed.length > 0) {
      const disputedProceedsCzk = sum(disputed.map((report) => report.grossProceedsCzk));
      const tickers = [...new Set(disputed.map((report) => report.isin.toUpperCase()))].sort();
      warnings.add(
        'CRYPTO_EMT_DISPUTED',
        'INFO',
        `Prodeje ${tickers.join(', ')} za ${czkText(disputedProceedsCzk)} počítáme jako elektronické peněžní tokeny (stablecoiny), tedy bez osvobození do 100 000 Kč. Vede se o to spor: DAI stojí na kryptozástavě a USDD na algoritmu, ne na penězích v bance, a část výkladu je proto mezi elektronické peněžní tokeny neřadí. Evropská definice ale krytí vůbec nezmiňuje — rozhoduje podle ní jedině to, že token drží hodnotu jedné úřední měny (nařízení MiCA, čl. 3 odst. 1 bod 7), a bod odůvodnění 41 výslovně dodává, že na mechanismu udržování hodnoty nezáleží a že totéž platí pro algoritmické stablecoiny. Naše zařazení je tedy nejen bezpečnější, ale podle textu nařízení i pravděpodobnější. Druhý výklad navíc není jednoznačně výhodnější: tržby z těchhle tokenů by sice mohly být osvobozené do 100 000 Kč, ale zároveň by se do toho úhrnu počítaly — a mohly by přes něj přetlačit i ostatní krypto prodeje, které jsou dnes osvobozené. Rozhodnutí je na tobě; opačný výklad znamená riziko doměrku daně s příslušenstvím.`,
        {
          disputedProceedsCzk: disputedProceedsCzk.toFixed(2),
          tickers: tickers.join(','),
        },
      );
    }
  }

  // R-10g: seznam EMT tickerů nemůže být úplný — při aplikaci krypto osvobození
  // na ne-EMT tržby upozorni na případný exotický stablecoin mimo seznam
  const cryptoExemptCzk = sum(
    crypto.disposals.filter((report) => !report.isEmt).map((report) => report.exemptProceedsCzk),
  );
  if (cryptoExemptCzk.gt(0)) {
    warnings.add(
      'CRYPTO_EMT_ASSUMPTION',
      'WARNING',
      `Osvobozené příjmy z kryptoaktiv ${czkText(cryptoExemptCzk)}: hlavní stablecoiny (USDT, USDC, DAI…) poznáme podle tickeru a z osvobození je vyloučíme sami — exotický stablecoin mimo náš seznam ale nepoznáme. Pokud jsi takový prodával, vyřaď ho nebo označ ručně (elektronické peněžní tokeny nárok na osvobození 100 000 Kč nemají).`,
      { exemptCzk: cryptoExemptCzk.toFixed(2) },
    );
  }

  // R-04j: frakční akcie mají nejasný právní status (u některých brokerů jde
  // o derivátový nárok, ne CP) — počítáme je jako CP a poctivě to vlajkujeme
  const fractionalIsins = [
    ...new Set(
      yearDisposals
        .filter((disposal) => !isCryptoDisposal(disposal) && !disposal.quantity.isInteger())
        .map((disposal) => disposal.isin),
    ),
  ];
  if (fractionalIsins.length > 0) {
    warnings.add(
      'FRACTIONAL_SHARES',
      'INFO',
      `Část letošních prodejů proběhla ve frakcích (zlomcích akcií): ${fractionalIsins.join(', ')}. Právní status frakcí není jednoznačný — u některých brokerů jde technicky o derivátový nárok, ne o cenný papír. Počítáme je jako cenné papíry včetně časového testu a limitu 100 000 Kč (převažující výklad, R-04j).`,
      { isins: fractionalIsins },
    );
  }

  const dividendTxs = input.transactions.filter(
    (tx): tx is DividendTransaction => tx.type === 'DIVIDEND' && yearOf(tx.date) === year,
  );
  const interestTxs = input.transactions.filter(
    (tx): tx is InterestTransaction => tx.type === 'INTEREST' && yearOf(tx.date) === year,
  );
  const dividends = computeDividends(
    dividendTxs,
    interestTxs,
    fx,
    options,
    warnings,
    ledger.returnOfCapitalTaxable,
  );
  const derivatives = computeDerivatives(derivativeTxs, year, fx, options, warnings);

  // daň se počítá PŘED limity: hlídač 50k z ní vyčísluje dopad prolomení (R-08f)
  const tax = estimateTax(securities, crypto, derivatives, dividends, config, warnings);
  const limits = computeLimits(
    securities,
    crypto,
    derivatives,
    dividends,
    tax,
    input.profile,
    config,
    warnings,
    options.limit100kIncludesTimeTestExempt,
  );
  // A2-3-04: hlídač musí znát i důvody, proč osvobození NIKDY nepřijde
  // (obchodní majetek, EMT, období bez krypto osvobození) — jinak posílá
  // „osvobozeno 🎉" k pozici, která je zdanitelná vždy
  const positions = positionsAt(ledger, `${year}-12-31`, timeTestContext(input));

  return {
    year,
    options,
    securities,
    shortSales,
    crypto,
    derivatives,
    dividends,
    limits,
    tax,
    positions,
    ledger,
    warnings: warnings.items,
  };
}
