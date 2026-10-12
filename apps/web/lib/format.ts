import type { Money } from '@danero/shared';

const czkFormat = new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  maximumFractionDigits: 0,
});

// 8 desetinných míst, protože tolik jich mají výpisy kryptoburz: se čtyřmi se
// 0,00075667 BTC ukázalo jako 0,0008 a 0,00004321 jako 0 — a simulátor pak
// číslo, které sám zobrazil, odmítl jako víc, než uživatel drží (L6a-08).
// Koncové nuly formát nepřidává, takže celé kusy zůstávají „10“.
const numberFormat = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 8 });

export const czk = (value: Money | number): string =>
  czkFormat.format(typeof value === 'number' ? value : value.toNumber());

export const qty = (value: Money | number): string =>
  numberFormat.format(typeof value === 'number' ? value : value.toNumber());

/** Datum česky — ISO string („2026-07-12“), nebo Date z DB (v české zóně;
    server rendruje v UTC a kolem půlnoci by datum uteklo o den). */
export const czDate = (value: string | Date): string =>
  typeof value === 'string'
    ? new Date(`${value}T00:00:00`).toLocaleDateString('cs-CZ')
    : value.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' });

/** Datum a čas z DB v české zóně, bez sekund — jednotný tvar pro celé UI. */
export const czDateTime = (value: Date): string =>
  value.toLocaleString('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Výčet roků česky: [2024, 2025] → „2024 a 2025“. Roky, za které existuje XML
 * pro EPO, se v textech neopisují ručně — berou se z `EPO_SUPPORTED_YEARS`.
 */
export const yearList = (years: readonly number[]): string => {
  const sorted = [...years].sort((a, b) => a - b);
  if (sorted.length <= 1) return String(sorted[0] ?? '');
  return `${sorted.slice(0, -1).join(', ')} a ${sorted[sorted.length - 1]}`;
};

/** Kompaktní částka v Kč bez desetin (grafy, tooltips) — nezlomitelná mezera. */
export const czkCompact = (value: number): string =>
  `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(value)}\u00A0Kč`;

/** Procento česky s nezlomitelnou mezerou: pct(91,4) → „91 %“. */
export const pct = (value: number, decimals = 0): string =>
  `${value.toLocaleString('cs-CZ', { maximumFractionDigits: decimals })}\u00A0%`;

/** Procento se znaménkem u kladných hodnot (P/L): signedPct(3,2, 1) → „+3,2 %“. */
export const signedPct = (value: number, decimals = 0): string =>
  `${value >= 0 ? '+' : ''}${pct(value, decimals)}`;

const amountFormat = new Intl.NumberFormat('cs-CZ', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Částka pod haléř: dvě desetinná místa by z ní udělala nulu („0,00 CZK za
// kus“ u mince s cenou 0,00031 Kč vedle pozice za desítky tisíc — R2-11).
// Píšou se proto první tři platné číslice, kolik desetin je potřeba.
const tinyAmountFormat = new Intl.NumberFormat('cs-CZ', { maximumSignificantDigits: 3 });

/**
 * Jednotka měny, jak ji aplikace píše: koruny jsou všude „Kč“, kód měny
 * (ISO 4217) jen u cizích. Do 11. 10. 2026 stálo u korunového titulu „+4 000,00
 * CZK“ hned vedle „Hodnota 40 000 Kč“ — dvě jména téže měny v jednom řádku.
 */
export const currencyUnit = (currency: string): string => (currency === 'CZK' ? 'Kč' : currency);

/**
 * Částka v měně titulu na haléře (cena za kus, částka transakce):
 * „1 234,56 USD“, „1 010,50 Kč“ (+ volitelné znaménko).
 * Před jednotkou je pevná mezera — obyčejná dovolila rozlomit částku na
 * „3 703 703,67 / USD“ (R2-27); stejně to mají `pct` a `czkCompact`.
 */
export const money = (value: Money | number, currency: string, signed = false): string => {
  const n = typeof value === 'number' ? value : value.toNumber();
  const sign = signed && n > 0 ? '+' : '';
  const format = n !== 0 && Math.abs(n) < 0.01 ? tinyAmountFormat : amountFormat;
  return `${sign}${format.format(n)}\u00A0${currencyUnit(currency)}`;
};

/**
 * Zisk nebo ztráta pozice se znaménkem, v měně titulu. V korunách na celé
 * koruny jako každá jiná korunová částka v aplikaci (stojí vedle hodnoty
 * pozice, kterou píše `czk`); pod jednu korunu přesně, aby drobná pozice
 * neukázala „+0 Kč“ (R2-11). Cizí měna na setiny jako cena.
 */
export const profitLoss = (value: Money | number, currency: string): string => {
  const n = typeof value === 'number' ? value : value.toNumber();
  if (currency !== 'CZK' || Math.abs(n) < 1) return money(n, currency, true);
  return `${n > 0 ? '+' : ''}${czk(n)}`;
};

/** Lidské popisky metod párování prodejů (R-05c) — jednotné pro celé UI. */
export const METHOD_LABEL: Record<string, string> = {
  FIFO: 'FIFO',
  LIFO: 'LIFO',
  MAX_PROFIT: 'Max. zisk',
  MAX_LOSS: 'Max. ztráta',
};

/** Popisky kurzové soustavy (R-06) ve srovnáních variant — jednotné pro celé UI. */
export const FX_LABEL: Record<string, string> = {
  UNIFIED: 'jednotný',
  CNB_DAILY: 'denní ČNB',
};

/** Táž soustava (R-06) celou větou — nastavení a výpis zafixovaných roků. */
export const FX_METHOD_LABEL: Record<string, string> = {
  UNIFIED: 'jednotný kurz GFŘ',
  CNB_DAILY: 'denní kurzy ČNB',
};

/** Popisek sporného výkladu limitu 100 000 Kč (R-02c) — bez daňového žargonu. */
export const limit100kLabel = (strict: boolean): string =>
  strict
    ? 'bezpečný výklad — všechny prodeje'
    : 'mírnější výklad — jen prodeje bez časového testu';

/** České zkratky měsíců (osy grafů, horizont osvobození). */
export const MONTH_LABELS = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'];

const czPluralRules = new Intl.PluralRules('cs');

/**
 * Správný český tvar slova k číslu: plural(n, 'transakce', 'transakce', 'transakcí').
 * Vrací jen tvar slova (číslo vypíše volající); „few“ platí pro 2–4, „many“
 * pro 0, 5+ i necelá čísla.
 */
export const plural = (n: number, one: string, few: string, many: string): string => {
  const rule = czPluralRules.select(n);
  return rule === 'one' ? one : rule === 'few' ? few : many;
};
