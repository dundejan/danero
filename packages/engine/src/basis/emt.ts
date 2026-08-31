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
  'BUSD', // Binance USD
  'TUSD', // TrueUSD
  'USDP', // Pax Dollar
  'PYUSD', // PayPal USD
  'FDUSD', // First Digital USD
  'GUSD', // Gemini Dollar
  'EURC', // Euro Coin (Circle)
  'EURT', // Tether EUR
  'EURS', // STASIS Euro
]);

/**
 * Tokeny, které se běžně řadí ke stablecoinům, ale **fiat za sebou nemají**:
 * DAI je krytý nadkolateralizovanými kryptoaktivy (MakerDAO), USDD je
 * algoritmický (Tron). Část výkladu je proto mezi EMT neřadí — a § 4/1 zj)
 * vylučuje z hodnotového osvobození jen EMT.
 *
 * **Primární pramen ale svědčí pro opak** (nález K7a-05): definice EMT v MiCA
 * čl. 3 odst. 1 bodu 7 chce jen to, aby token udržoval stabilní hodnotu odkazem
 * na hodnotu JEDNÉ ÚŘEDNÍ MĚNY — o krytí peněžními prostředky v ní není nic.
 * Bod odůvodnění 41 navíc výslovně říká, že se režim použije „bez ohledu na …
 * mechanismus pro udržování jejich stabilní hodnoty“ a že „totéž platí pro tzv.
 * algoritmické stablecoiny“; ART je v bodě 6 vymezen negativně jako token, který
 * EMT NENÍ. Dřívější odůvodnění („jsou nanejvýš ART“) stálo na kritériu, které
 * v nařízení není.
 *
 * Do vyloučení je tedy pouštíme dál — nejen jako bezpečný default (opačné
 * rozhodnutí = doměrek), ale i jako výkladově pravděpodobnější variantu.
 * Držíme je zvlášť, aby engine mohl poctivě říct, kolik na tomhle sporu visí,
 * a nechal rozhodnutí na uživateli (R-10a, nálezy A2-3-13 a K7a-05).
 */
export const EMT_DISPUTED_TICKERS: ReadonlySet<string> = new Set([
  'DAI', // Dai (MakerDAO) — nadkolateralizovaný kryptoaktivy, ne fiat
  'USDD', // USDD (Tron) — algoritmický
]);

/**
 * Ticker krypto instrumentu na porovnatelný tvar. Importéři u kryptoaktiv
 * ukládají do pole `isin` ticker (Kraken `crypto.asset`,
 * Coinbase/Coinmate/Anycoin/Revolut symbol) — uppercase, ořízne burzovní sufix
 * (Kraken staked `USDT.S`) a legacy prefix X/Z starých Kraken exportů.
 */
function candidates(identifier: string): string[] {
  const code = identifier
    .trim()
    .toUpperCase()
    .replace(/\.[A-Z0-9]{1,4}$/, '');
  const stripped = code.startsWith('X') || code.startsWith('Z') ? code.slice(1) : null;
  return stripped ? [code, stripped] : [code];
}

/**
 * Je identifikátor krypto instrumentu EMT? Porovnává se výhradně proti
 * seznamům, falešná detekce ne-EMT tickerů proto nehrozí. Sporné tokeny
 * (`EMT_DISPUTED_TICKERS`) sem patří taky — default je bezpečný výklad.
 */
export function isEmtIdentifier(identifier: string): boolean {
  return candidates(identifier).some(
    (code) => EMT_TICKERS.has(code) || EMT_DISPUTED_TICKERS.has(code),
  );
}

/** Je to EMT jen podle sporného výkladu (fiat za sebou nemá)? Viz R-10g. */
export function isDisputedEmtIdentifier(identifier: string): boolean {
  return candidates(identifier).some((code) => EMT_DISPUTED_TICKERS.has(code));
}
