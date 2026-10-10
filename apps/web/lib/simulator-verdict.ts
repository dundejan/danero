import type { Money } from '@danero/shared';
import { LIMIT_NAME } from '@/lib/limit-names';

/**
 * Verdikt simulátoru prodeje jako čistá funkce (testovatelná bez JSX).
 *
 * Panelové testování odhalilo lhaní verdiktu: prodej osvobozený časovým
 * testem může prolomit úhrn 100 000 Kč (při striktním výkladu R-02c do něj
 * vstupují i osvobozené tržby) a tím ZPĚTNĚ zdanit dřívější letošní prodeje.
 * „Celý osvobozený — limity ani daň nečerpá“ proto platí JEN když se nezvýší
 * daň ani čerpání žádného limitu.
 */

/**
 * Limit, jehož prolomení mění povinnosti poplatníka — podle režimu:
 * paušál 50 000 Kč (R-08b, § 7a), zaměstnanec vedlejší příjmy (R-09b, § 38g
 * odst. 2), „jiné“ obecný limit pro podání přiznání (R-09a, § 38g odst. 1).
 */
export interface RegimeLimit {
  kind: 'FLAT_TAX' | 'EMPLOYEE_SIDE_INCOME' | 'GENERAL_FILING';
  /** Jméno limitu — stejné jako na přehledu a v reportu (`LIMIT_NAME`). */
  label: string;
  /** Strop ze stavu limitu — částky § 38g se od roku 2027 mění, proto ne pevný text. */
  limitCzk: Money;
}

/** Strukturální podmnožina limitů z enginu — jen co výběr limitu potřebuje. */
export interface RegimeLimitsInput {
  flatTax50k: { applicable: boolean; status: { limitCzk: Money } };
  employee20k: { applicable: boolean; status: { limitCzk: Money } };
  generalFiling50k: { applicable: boolean; status: { limitCzk: Money } };
}

/**
 * Limit platný pro režim uživatele — jedno místo pro kartu limitu i verdikt.
 * Čerpání (příjmy § 8–10) je pro všechny režimy stejné, liší se jen strop
 * a název. OSVČ mimo paušál podává přiznání vždy, režimový limit nemá (`null`).
 */
export function regimeLimitFor(limits: RegimeLimitsInput): RegimeLimit | null {
  if (limits.flatTax50k.applicable) {
    return {
      kind: 'FLAT_TAX',
      label: LIMIT_NAME.FLAT_TAX,
      limitCzk: limits.flatTax50k.status.limitCzk,
    };
  }
  if (limits.employee20k.applicable) {
    return {
      kind: 'EMPLOYEE_SIDE_INCOME',
      label: LIMIT_NAME.EMPLOYEE_SIDE_INCOME,
      limitCzk: limits.employee20k.status.limitCzk,
    };
  }
  if (limits.generalFiling50k.applicable) {
    return {
      kind: 'GENERAL_FILING',
      label: LIMIT_NAME.GENERAL_FILING,
      limitCzk: limits.generalFiling50k.status.limitCzk,
    };
  }
  return null;
}

/** Strukturální podmnožina SaleSimulationResult z enginu — jen co verdikt potřebuje. */
export interface VerdictInput {
  baseline: {
    exemptUnder100k: boolean;
    cryptoExemptUnder100k: boolean;
    /** Úhrn příjmů § 8–10 — engine ho vede pod názvem paušálního limitu, platí pro každý režim. */
    flatTax50kUsedCzk: Money;
  };
  simulated: {
    exemptUnder100k: boolean;
    cryptoExemptUnder100k: boolean;
    flatTax50kUsedCzk: Money;
  };
  deltas: {
    taxCzk: Money;
    flatTax50kUsedCzk: Money;
    limit100kUsedCzk: Money;
    cryptoLimit100kUsedCzk: Money;
  };
  simulatedDisposal: { taxableProceedsCzk: Money } | undefined;
}

/**
 * Zdanitelný prodej, který zároveň zruší osvobození úhrnem do 100 000 Kč:
 * před ním byly letošní prodeje osvobozené celé, po něm se zdaní zpětně i ty
 * dřívější. Daň pak roste o víc, než kolik připadá na tenhle prodej — bez
 * téhle informace čísla na obrazovce neseděla (základ 340 Kč, daň +866 Kč;
 * nález R1B-04).
 */
export interface BrokenExemption {
  crypto: boolean;
  /** Změna celkové orientační daně — za všechny letošní prodeje, ne jen za tenhle. */
  taxDeltaCzk: Money;
}

export type SimulatorVerdict =
  /** Celý osvobozený, daň se nezvýší a žádný limit se nezhorší. */
  | { kind: 'EXEMPT_CLEAN' }
  /** Osvobozený testem, ale prolomí úhrn 100k (CP/krypto) → knock-on na dřívější prodeje. */
  | { kind: 'EXEMPT_BREAKS_100K'; crypto: boolean; taxDeltaCzk: Money }
  /** Osvobozený, nic neprolomí, ale zhorší čerpání limitu (příp. i daň). */
  | { kind: 'EXEMPT_DRAWS_LIMIT'; crypto: boolean; taxDeltaCzk: Money }
  /** Zdanitelný prodej, který nově prolomí limit platný pro režim uživatele. */
  | { kind: 'BREAKS_REGIME_LIMIT'; limit: RegimeLimit; brokenExemption: BrokenExemption | null }
  | { kind: 'TAXABLE'; brokenExemption: BrokenExemption | null };

/**
 * @param regimeLimit limit platný pro režim (`regimeLimitFor`); `null` = režim
 *   žádný nemá. Prolomení se počítá proti JEHO stropu — stav paušálního limitu
 *   engine vede pro každý režim, takže by zaměstnanci hlásil hranici, která se
 *   ho netýká, a o té jeho mlčel.
 */
export function simulatorVerdict(
  simulation: VerdictInput,
  regimeLimit: RegimeLimit | null,
): SimulatorVerdict {
  const { baseline, simulated, deltas, simulatedDisposal } = simulation;
  const fullyExempt =
    simulatedDisposal !== undefined && simulatedDisposal.taxableProceedsCzk.lte(0);
  // prolomení úhrnu 100k: před prodejem osvobozeno úhrnem, po prodeji už ne
  const breaksSecurities = baseline.exemptUnder100k && !simulated.exemptUnder100k;
  const breaksCrypto = baseline.cryptoExemptUnder100k && !simulated.cryptoExemptUnder100k;

  if (fullyExempt) {
    if (breaksSecurities || breaksCrypto) {
      return {
        kind: 'EXEMPT_BREAKS_100K',
        crypto: breaksCrypto && !breaksSecurities,
        taxDeltaCzk: deltas.taxCzk,
      };
    }
    // zhoršení bez prolomení: vyšší daň, nebo vyšší čerpání některého limitu
    const drawsSecurities = deltas.limit100kUsedCzk.gt(0);
    const drawsCrypto = deltas.cryptoLimit100kUsedCzk.gt(0);
    if (deltas.taxCzk.gt(0) || drawsSecurities || drawsCrypto || deltas.flatTax50kUsedCzk.gt(0)) {
      return {
        kind: 'EXEMPT_DRAWS_LIMIT',
        crypto: drawsCrypto && !drawsSecurities,
        taxDeltaCzk: deltas.taxCzk,
      };
    }
    return { kind: 'EXEMPT_CLEAN' };
  }

  const brokenExemption: BrokenExemption | null =
    breaksSecurities || breaksCrypto
      ? { crypto: breaksCrypto && !breaksSecurities, taxDeltaCzk: deltas.taxCzk }
      : null;

  // limity jsou „do částky včetně“ (jako v enginu) — přesně na stropu ještě vyhovuje
  if (
    regimeLimit &&
    simulated.flatTax50kUsedCzk.gt(regimeLimit.limitCzk) &&
    !baseline.flatTax50kUsedCzk.gt(regimeLimit.limitCzk)
  ) {
    return { kind: 'BREAKS_REGIME_LIMIT', limit: regimeLimit, brokenExemption };
  }
  return { kind: 'TAXABLE', brokenExemption };
}
