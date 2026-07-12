/**
 * R-10a: elektronické peněžní tokeny (EMT dle MiCA čl. 3 odst. 1 bodu 7 —
 * kryptoaktiva vázaná na jednu fiat měnu, tj. stablecoiny). § 4/1 zj) ZDP
 * (zák. č. 32/2025 Sb.) je z hodnotového osvobození 100k výslovně vylučuje.
 *
 * Seznam pokrývá hlavní fiat-podložené EMT a je rozšiřitelný; úplný být nemůže —
 * exotický stablecoin mimo seznam zachytí varování CRYPTO_EMT_ASSUMPTION (R-10g).
 */
export const EMT_TICKERS: ReadonlySet<string> = new Set([
  'USDT', // Tether USD
  'USDC', // USD Coin (Circle)
  'DAI', // Dai (MakerDAO) — algoritmický, ale navázaný na USD
  'BUSD', // Binance USD
  'TUSD', // TrueUSD
  'USDP', // Pax Dollar
  'PYUSD', // PayPal USD
  'FDUSD', // First Digital USD
  'GUSD', // Gemini Dollar
  'USDD', // USDD (Tron)
  'EURC', // Euro Coin (Circle)
  'EURT', // Tether EUR
  'EURS', // STASIS Euro
]);

/**
 * Je identifikátor krypto instrumentu EMT? Importéři u kryptoaktiv ukládají do
 * pole `isin` ticker (Kraken `crypto.asset`, Coinbase/Coinmate/Anycoin/Revolut
 * symbol) — normalizujeme uppercase, ořízneme burzovní sufix (Kraken staked
 * `USDT.S`) a zkusíme i legacy prefix X/Z starých Kraken exportů. Porovnává se
 * výhradně proti seznamu, falešná detekce ne-EMT tickerů proto nehrozí.
 */
export function isEmtIdentifier(identifier: string): boolean {
  const code = identifier
    .trim()
    .toUpperCase()
    .replace(/\.[A-Z0-9]{1,4}$/, '');
  if (EMT_TICKERS.has(code)) return true;
  return (code.startsWith('X') || code.startsWith('Z')) && EMT_TICKERS.has(code.slice(1));
}
