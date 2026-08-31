import { d, Decimal, roundBaseDownTo100, ZERO, type Money } from '@danero/shared';
import { TAXPAYER_CREDIT_CZK, type TaxYearConfig } from '../config/taxYear';
import type { DerivativesResult } from '../basis/derivatives';
import type { DividendsResult } from '../basis/dividends';
import type { SecuritiesResult } from '../basis/securities';
import { czkText } from '../format';
import { WarningCollector } from '../warnings';

export interface TaxVariant {
  /** Obecný základ (zaokrouhlení na stovky dolů se aplikuje až při výpočtu daně). */
  baseCzk: Money;
  taxBeforeCreditCzk: Money;
  foreignTaxCreditCzk: Money;
  taxCzk: Money;
}

export interface TaxEstimate {
  /** Varianta A: zahraniční příjmy § 8 v obecném základu (15/23 %). */
  general: TaxVariant;
  /** Varianta B (R-07d, § 16a): zahraniční dividendy a úroky v samostatném základu 15 %. */
  separate16a: TaxVariant & { separateBaseCzk: Money; separateTaxCzk: Money };
  recommended: 'GENERAL' | 'SEPARATE_16A';
  note: string;
}

const RATE_BASE = '0.15';
const RATE_HIGHER = '0.23';

function progressiveTax(base: Money, threshold: Money | null): Money {
  const rounded = roundBaseDownTo100(base);
  if (rounded.lte(0)) return ZERO;
  if (threshold === null || rounded.lte(threshold)) return rounded.mul(RATE_BASE);
  return threshold.mul(RATE_BASE).plus(rounded.sub(threshold).mul(RATE_HIGHER));
}

/**
 * R-07c/R-07f: prostý zápočet po státech — strop podílem příjmu státu na základu
 * daně. Příjem státu = dividendy i úroky (§ 38f počítá zápočet za stát jako
 * celek, ne za druh příjmu zvlášť).
 *
 * Koeficient zápočtu (ř. 324 Přílohy 3, tiskopis 25 5405/P3 vzor č. 22) se
 * vyjadřuje **v procentech na dvě desetinná místa** — § 146 odst. 3 daňového
 * řádu: „Výpočet na základě daňové sazby, koeficientů, ukazatelů … se provádí
 * s přesností na dvě platná desetinná místa.“ Přesný podíl proto do stropu
 * dosadit nejde: podatelna přesnější hodnotu ř. 325 odmítne a report by ukazoval
 * jinou daň než odevzdané XML (nález K3-09, rozdíl až o desítky Kč — koeficient
 * zaokrouhlený dolů udělá ze stropu skutečnou mez tam, kde přesný podíl vycházel
 * přesně na smluvní zápočet).
 *
 * ⚠️ Není to zakázané postupné zaokrouhlování (věta druhá § 146 odst. 3):
 * zaokrouhluje se koeficient podle věty první, ne mezivýsledek daně, a hodnota
 * zápočtu za stát se pak zaokrouhlí jen jednou.
 */
function allocateCredit(tax: Money, base: Money, dividends: DividendsResult): Money {
  if (base.lte(0) || tax.lte(0)) return ZERO;
  let credit = ZERO;
  for (const { grossCzk, interestGrossCzk, creditableCzk } of Object.values(
    dividends.creditableByCountry,
  )) {
    // ř. 324 — koeficient v %, dvě desetinná místa; ř. 325 — strop zápočtu
    const coefficientPct = grossCzk
      .plus(interestGrossCzk)
      .div(base)
      .mul(100)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const maxCredit = tax.mul(coefficientPct).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    // ř. 326 je min(ř. 323, ř. 325) a podatelna ten vzorec kontroluje na DVĚ
    // desetinná místa — korunové zaokrouhlení dolů by report zase rozešlo s XML
    // (přesně vada K3-09, jen obráceně). Na celé Kč dolů se zaokrouhluje ř. 323,
    // tedy `creditableCzk`, a to se děje už v `basis/dividends.ts`.
    credit = credit.plus(Decimal.min(creditableCzk, maxCredit));
  }
  return Decimal.min(credit, tax);
}

/**
 * R-07d: mez významnosti doporučení § 16a. Obecná varianta zaokrouhluje na sta
 * dolů jediný základ (§ 16 odst. 2), § 16a dva odděleně — § 16a tak může vyjít
 * nanejvýš o 100 Kč základu levněji, tedy max. o 23 Kč daně, aniž by to byla
 * skutečná úspora. Pod touhle mezí by doporučení stálo slevy na dani
 * a nezdanitelné části základu za pár korun (nález A1-04).
 */
const SEPARATE_16A_MIN_SAVING_CZK = d('100');

/**
 * Orientační daň z investičních příjmů (§ 8 + § 10) ve dvou variantách.
 * Skutečná progrese závisí na celkovém základu vč. § 7 — viz `note`.
 */
export function estimateTax(
  securities: SecuritiesResult,
  crypto: SecuritiesResult,
  derivatives: DerivativesResult,
  dividends: DividendsResult,
  config: TaxYearConfig,
  warnings: WarningCollector,
): TaxEstimate {
  const threshold = config.progressiveThreshold === null ? null : d(config.progressiveThreshold);
  if (threshold === null) {
    warnings.add(
      'PROGRESSIVE_THRESHOLD_UNKNOWN',
      'WARNING',
      `Hranice 23% sazby pro rok ${config.year} není v konfiguraci — orientační daň počítám celou 15% sazbou.`,
    );
  }

  // R-05d/R-10c/R-12l: dílčí základ § 10 = max(0, CP) + max(0, krypto) +
  // max(0, deriváty) — druhy se NEkompenzují, každý base10Czk už je nezáporný
  const base10 = securities.base10Czk.plus(crypto.base10Czk).plus(derivatives.base10Czk);

  // Varianta A: vše v obecném základu
  const baseA = base10.plus(dividends.base8Czk);
  const taxA = progressiveTax(baseA, threshold);
  const creditA = allocateCredit(taxA, baseA, dividends);

  // Varianta B: § 16a — jen zahraniční dividendy/úroky (§ 8) v samostatném
  // základu 15 %; kryptoaktiv se § 16a netýká (R-10)
  const baseB = base10;
  const separateBase = dividends.base8Czk;
  const taxB = progressiveTax(baseB, threshold);
  const separateTax = roundBaseDownTo100(separateBase).mul(RATE_BASE);
  const creditB = allocateCredit(separateTax, separateBase, dividends);

  const general: TaxVariant = {
    baseCzk: baseA,
    taxBeforeCreditCzk: taxA,
    foreignTaxCreditCzk: creditA,
    taxCzk: taxA.sub(creditA),
  };
  const separate16a = {
    baseCzk: baseB,
    separateBaseCzk: separateBase,
    separateTaxCzk: separateTax,
    taxBeforeCreditCzk: taxB.plus(separateTax),
    foreignTaxCreditCzk: creditB,
    taxCzk: taxB.plus(separateTax).sub(creditB),
  };

  // § 16a doporučujeme jen když obecný základ skutečně překračuje ZNÁMOU
  // hranici progrese A úspora přesáhne mez významnosti — jinak je rozdíl jen
  // zaokrouhlovací šum (sta dolů se zaokrouhlují u variant odděleně); § 16a
  // navíc znamená ztrátu slev na dani a nezdanitelných částí.
  const saving = general.taxCzk.sub(separate16a.taxCzk);
  const recommended: 'GENERAL' | 'SEPARATE_16A' =
    threshold !== null && baseA.gt(threshold) && saving.gte(SEPARATE_16A_MIN_SAVING_CZK)
      ? 'SEPARATE_16A'
      : 'GENERAL';

  // R-07i: porovnání dvou daní ztrátu slevy na poplatníka nevidí — sleva se
  // podle § 35ba odst. 1 uplatní JEN proti dani podle § 16, a ta ve variantě
  // § 16a klesá. Kdo jiné příjmy nemá, může o nevyčerpaný zbytek přijít.
  // Doporučení se tím nemění (spotřebu slevy na § 6/§ 7 engine nevidí), ale
  // musí se říct nahlas i s čísly.
  const credit = d(TAXPAYER_CREDIT_CZK);
  if (recommended === 'SEPARATE_16A' && taxB.lt(credit)) {
    const lost = credit.sub(taxB);
    warnings.add(
      'SEPARATE_16A_CREDIT_LOSS',
      'WARNING',
      `Samostatný základ § 16a ti podle našeho propočtu ušetří ${czkText(saving)}. ` +
        `Než ho zvolíš: slevu na poplatníka (${czkText(credit)}) jde uplatnit jen proti dani ` +
        `počítané podle § 16 — a přesunem dividend do § 16a ti tahle daň klesne na ${czkText(taxB)}. ` +
        `Pokud kromě investic nemáš další příjmy (zaměstnání, podnikání), zbylých ${czkText(lost)} ` +
        `ze slevy propadne a § 16a tě vyjde dráž. Máš-li příjmy z § 6 nebo § 7, spotřebuje se sleva ` +
        `tam a propočet platí — to už ale Danero nevidí.`,
      {
        savingCzk: saving.toFixed(2),
        taxUnderSection16Czk: taxB.toFixed(2),
        unusedCreditCzk: lost.toFixed(2),
      },
    );
  }

  return {
    general,
    separate16a,
    recommended,
    note: 'Orientační výpočet pouze z investičních příjmů — skutečná progrese (23 %) závisí na celkovém základu daně včetně § 7. Ve variantě § 16a nelze uplatnit slevy na dani ani nezdanitelné části základu.',
  };
}
