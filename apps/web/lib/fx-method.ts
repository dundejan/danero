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
 * Přiznání má stát na jedné kurzové soustavě (R-06, § 38 odst. 1). Soubor
 * varování nenese, takže by smíšená čísla odešla bez jediné poznámky; raději
 * ho nevydáme a řekneme, co s tím.
 */
export function xmlBlockedByFxMix(result: FxResult): string | null {
  if (!mixesFxSystems(result)) return null;
  return result.options.fxMethod === 'UNIFIED'
    ? 'XML teď nevydáme: pro část transakcí chybí jednotný kurz a výpočet u nich použil denní kurz ČNB, takže by soubor nesl čísla ze dvou kurzových soustav. Podrobnosti jsou ve varováních v reportu.'
    : 'XML teď nevydáme: pro část transakcí chyběl denní kurz ČNB a výpočet u nich použil jednotný kurz, takže by soubor nesl čísla ze dvou kurzových soustav. Kurzy se stahují každý den — zkus to zítra, nebo si v Nastavení přepni na jednotný kurz, který je k dispozici vždy.';
}
