import type { TaxYearResult } from '@danero/engine';

/**
 * Jak pojmenovat kurzovou soustavu, kterou výsledek OPRAVDU nese (R-06b,
 * rozhodnutí R5 z revize 5).
 *
 * Zvolená metoda a použitá čísla se můžou rozejít: chybí-li denní kurz ČNB
 * (výpadek stahování, měna mimo denní lístek), engine u té transakce použije
 * jednotný kurz téhož roku a přidá varování — a obráceně u chybějícího
 * jednotného kurzu. Report, tisk i XML do revize 5 dál tvrdily jen zvolenou
 * metodu, takže podklad pro finanční úřad nesl čísla ze dvou soustav bez
 * stopy. Odsud se bere jedna pravdivá věta pro všechny výstupy.
 */
type FxResult = Pick<TaxYearResult, 'options' | 'warnings'>;

const DAILY_MISSING = 'FX_DAILY_RATE_MISSING';
const UNIFIED_MISSING = 'FX_UNIFIED_RATE_MISSING';

/** Sešly se ve výsledku obě kurzové soustavy? */
export function mixesFxSystems(result: FxResult): boolean {
  const fallback = result.options.fxMethod === 'UNIFIED' ? UNIFIED_MISSING : DAILY_MISSING;
  return result.warnings.some((warning) => warning.code === fallback);
}

/** Označení kurzů do hlavičky reportu a do tisku. */
export function fxMethodLabel(result: FxResult): string {
  const unified = result.options.fxMethod === 'UNIFIED';
  const chosen = unified ? 'jednotný kurz GFŘ' : 'denní kurzy ČNB';
  if (!mixesFxSystems(result)) return chosen;
  return unified
    ? `${chosen}, u části transakcí denní kurz ČNB (jednotný kurz chyběl)`
    : `${chosen}, u části transakcí jednotný kurz GFŘ (denní kurz chyběl)`;
}

/**
 * Proč teď nejde vydat XML pro finanční úřad — nebo `null`, když jde.
 *
 * Blokuje se JEN zvolená metoda denních kurzů s chybějícím kurzem: přiznání
 * má stát na jedné kurzové soustavě (R-06, § 38 odst. 1), soubor varování
 * nenese a uživatel má cestu ven (počkat na kurzy, nebo přepnout na jednotný).
 *
 * U zvoleného JEDNOTNÉHO kurzu se neblokuje. Tabulka jednotných kurzů začíná
 * rokem 2020 a u nákupu ze starších let engine vědomě sahá po denním kurzu
 * (K1-04) — to není výpadek a uživatel s tím nic nenadělá; blokace by mu XML
 * vzala natrvalo. Označení v reportu a tisku druhou soustavu přizná i tam.
 *
 * Známá nepřesnost: varování o chybějícím denním kurzu vznikne i u derivátu
 * uzavřeného v JINÉM roce (engine převádí dřív, než položku podle roku
 * vyřadí). Je to vzácné — chce zvolené denní kurzy a měnu, kterou denní
 * lístek ČNB nevede — a rada z hlášky funguje i tehdy.
 */
export function xmlBlockedByFxMix(result: FxResult): string | null {
  if (result.options.fxMethod !== 'CNB_DAILY' || !mixesFxSystems(result)) return null;
  return 'XML teď nevydáme: pro část transakcí chyběl denní kurz ČNB a výpočet u nich použil jednotný kurz, takže by soubor nesl čísla ze dvou kurzových soustav. Kurzy se stahují každý den — zkus to zítra. Nebo přepni v Nastavení kurzy na jednotný kurz; má-li tenhle rok zafixovanou konfiguraci, zruš tam nejdřív jeho fixaci.';
}
