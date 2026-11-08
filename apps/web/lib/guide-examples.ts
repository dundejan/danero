import { DEFAULT_OPTIONS, filingDeadlines, UNIFIED_RATES_VERIFIED } from '@danero/engine';
import { d, type Money } from '@danero/shared';
import { configForYear } from '@/lib/tax-config';

/**
 * Čísla do příkladů v článcích průvodce. Nikde se nepíšou ručně: limity
 * a lhůty jdou z konfigurace roku a z enginu (R-09a, R-09b, R-08b, R-09e),
 * kurzy z ověřené tabulky jednotných kurzů (R-06a) a stropy srážek ze
 * smluvních sazeb enginu (R-07c). Že engine nad stejnými transakcemi dojde
 * k týmž číslům a verdiktům, hlídá `test/guide-examples.test.ts`.
 *
 * Roky jsou v článcích pevné schválně: článek „Kdy podat přiznání“ vysvětluje
 * přechod mezi rokem 2026 a 2027 a příklad s dividendami počítá ověřeným
 * kurzem roku 2025, který se už nezmění. Kdo článek přepisuje na další rok,
 * mění rok tady a datum `modified` v `lib/articles.ts`.
 */

/** Rok, za který se podává přiznání na jaře 2027 — ještě se starými částkami. */
export const CURRENT_FILING_YEAR = 2026;
/** První rok s vyššími limity podle zák. č. 180/2026 Sb. */
export const RAISED_LIMITS_YEAR = 2027;

export interface FilingLimits {
  /** R-09b: vedlejší příjmy zaměstnance. */
  employee: Money;
  /** R-09a: obecný limit. */
  general: Money;
  /** R-08b: příjmy § 8–10 pro daň rovnou paušální dani. */
  flatTax: Money;
  /** R-09d: oznámení osvobozeného příjmu. */
  exemptReporting: Money;
}

export function filingLimits(year: number): FilingLimits {
  const { limits } = configForYear(year);
  return {
    employee: d(limits.employeeSideIncome),
    general: d(limits.generalFiling),
    flatTax: d(limits.flatTaxOtherIncome),
    exemptReporting: d(limits.exemptIncomeReporting),
  };
}

/** Lhůty pro přiznání za rok 2026 (R-09e) — spočítané, ne opsané. */
export const currentFilingDeadlines = () => filingDeadlines(CURRENT_FILING_YEAR);

/** Situace z příkladů článku A: kdo, kolik zahraničních dividend brutto a jaký limit hlídá. */
export interface FilingExample {
  id: 'employee' | 'other' | 'flatTax';
  /** Zahraniční dividendy brutto za rok v Kč. */
  dividendsCzk: Money;
  limit: (limits: FilingLimits) => Money;
}

export const FILING_EXAMPLES: FilingExample[] = [
  { id: 'employee', dividendsCzk: d(30_000), limit: (l) => l.employee },
  { id: 'other', dividendsCzk: d(70_000), limit: (l) => l.general },
  { id: 'flatTax', dividendsCzk: d(70_000), limit: (l) => l.flatTax },
];

/** Podává za rok `year`? Limit se musí PŘESÁHNOUT („přesahují“), rovnost nestačí. */
export function mustFile(example: FilingExample, year: number): boolean {
  return example.dividendsCzk.gt(example.limit(filingLimits(year)));
}

export const filingExample = (id: FilingExample['id']): FilingExample =>
  FILING_EXAMPLES.find((example) => example.id === id)!;

/** Rok ověřeného jednotného kurzu, kterým se počítá příklad v článku B. */
export const DIVIDEND_EXAMPLE_YEAR = 2025;

/** Sazba, kterou USA srazí bez formuláře W-8BEN (R-07c). */
export const US_RATE_WITHOUT_W8BEN = d('0.30');

export interface UsDividendExample {
  year: number;
  rateUsd: Money;
  grossUsd: Money;
  grossCzk: Money;
  /** Smluvní strop srážky pro USA (čl. 10 smlouvy). */
  treatyCap: Money;
  withW8ben: { withheldUsd: Money; withheldCzk: Money; creditableCzk: Money };
  withoutW8ben: { withheldUsd: Money; withheldCzk: Money; creditableCzk: Money; lostCzk: Money };
}

/**
 * Americká dividenda 250 USD brutto. Částka je zvolená tak, aby všechna čísla
 * vyšla na celé koruny (kurz 2025 je 21,84 Kč) — zápočet se v přiznání po
 * státech zaokrouhluje dolů na celé Kč a článek nemá ukazovat haléře, které
 * pak v přiznání nebudou.
 */
export function usDividendExample(): UsDividendExample {
  const rateUsd = d(UNIFIED_RATES_VERIFIED[DIVIDEND_EXAMPLE_YEAR]!.USD!);
  const grossUsd = d(250);
  const grossCzk = grossUsd.mul(rateUsd);
  const treatyCap = d(DEFAULT_OPTIONS.treatyWithholdingCap.US!);
  const capCzk = grossCzk.mul(treatyCap);
  const withW8Usd = grossUsd.mul(treatyCap);
  const withoutW8Usd = grossUsd.mul(US_RATE_WITHOUT_W8BEN);
  const withoutW8Czk = withoutW8Usd.mul(rateUsd);
  return {
    year: DIVIDEND_EXAMPLE_YEAR,
    rateUsd,
    grossUsd,
    grossCzk,
    treatyCap,
    withW8ben: {
      withheldUsd: withW8Usd,
      withheldCzk: withW8Usd.mul(rateUsd),
      creditableCzk: capCzk,
    },
    withoutW8ben: {
      withheldUsd: withoutW8Usd,
      withheldCzk: withoutW8Czk,
      creditableCzk: capCzk,
      lostCzk: withoutW8Czk.sub(capCzk),
    },
  };
}

/** Nizozemsko: strop 10 %, i když srážka bývá vyšší (R-07c). */
export const nlTreatyCap = (): Money => d(DEFAULT_OPTIONS.treatyWithholdingCap.NL!);

/** Hranice 23% sazby pro rok `year` (36násobek průměrné mzdy, § 16) — u § 16a. */
export function progressiveThreshold(year: number): Money | null {
  const value = configForYear(year).progressiveThreshold;
  return value === null ? null : d(value);
}
