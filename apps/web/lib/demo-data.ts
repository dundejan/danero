import { parseTransactions, type Transaction } from '@danero/shared';
import { d } from '@danero/shared';
import { MapRateProvider, type DailyRateProvider } from '@danero/engine';
import type { ProfileRow } from '@/lib/portfolio';
import type { InstrumentPrice } from '@/lib/prices';
import { UNIFIED_RATES } from '@/lib/tax-config';

/**
 * Ukázková data pro demo prohlídku (bez registrace, bez DB): fiktivní
 * investor — paušální OSVČ s portfoliem 50+ pozic (US i EU akcie, ETF,
 * krypto a opce) v hodnotě ~2 mil. Kč.
 *
 * Dataset je DETERMINISTICKÝ a datumy se počítají RELATIVNĚ k `today`,
 * aby demo příběh platil věčně:
 *  - CSPX splní časový test za ~12 dní, MSFT za ~2 měsíce, NVDA za ~8 měsíců,
 *    VUAA za ~2 roky → horizont osvobození žije v různých vzdálenostech;
 *  - letošní prodeje CP ≈ 91 000 Kč → limit 100k v pásmu CRITICAL (oranžová);
 *  - zdanitelné příjmy (dividendy + úroky + opce) ≈ 64 000 Kč → prolomený
 *    limit 50k paušální daně → verdikt „podáš přiznání“;
 *  - prodej BTC 46 000 Kč → krypto limit v zeleném (osvobozeno úhrnem);
 *  - AAPL má tři nákupní loty s různými cenami → v simulátoru je vidět, že
 *    metoda párování mění výsledek (letošní prodej AAPL kryje úhrn do 100k);
 *  - rok Y−1 prolomil limit 100k (velký prodej SHOP se dvěma loty za různé
 *    ceny) → tabulka „Porovnání variant párování“ má v historii co ukázat
 *    (FIFO/LIFO dávají různý základ), letošní příběh zůstává beze změny;
 *  - v KAŽDÉM roce Y−5…Y jsou prodeje (zisk i ztráta), dividendy, úroky
 *    a poplatky → přehled i grafy žijí pro všechny roky v přepínači.
 *
 * Události BĚŽNÉHO roku (prodeje, dividendy, opce) mají pevné datumy v rámci
 * roku — engine počítá celé zdaňovací období, takže verdikt a odměrky drží
 * po celý rok (část událostí může být vůči dnešku „v budoucnu“, to je záměr).
 */

// ── datumová aritmetika (UTC, ISO stringy) ──────────────────────────────────

const iso = (date: Date): string => date.toISOString().slice(0, 10);
const utc = (isoDate: string): Date => new Date(`${isoDate}T00:00:00Z`);

const addDays = (isoDate: string, days: number): string => {
  const date = utc(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
};

const addMonths = (isoDate: string, months: number): string => {
  const date = utc(isoDate);
  date.setUTCMonth(date.getUTCMonth() + months);
  return iso(date);
};

const addYears = (isoDate: string, years: number): string =>
  addMonths(isoDate, years * 12);

/** Poslední rok, pro který známe jednotný kurz — demo nesmí spadnout 1. ledna
 *  (kurz nového roku se doplňuje ručně dle runbooku, R-06a). */
const LAST_RATE_YEAR = Math.max(...Object.keys(UNIFIED_RATES).map(Number));

/** „Dnešek“ dema: skutečné datum s rokem přištípnutým na poslední rok s kurzy. */
export function demoToday(now: Date = new Date()): string {
  const real = iso(now);
  const year = Math.min(Number(real.slice(0, 4)), LAST_RATE_YEAR);
  const monthDay = real.slice(5) === '02-29' ? '02-28' : real.slice(5); // přestupný okraj
  return `${year}-${monthDay}`;
}

// ── profil fiktivního investora ─────────────────────────────────────────────

/** Konstantní timestamp → stabilní otisk pro engine cache. */
const DEMO_PROFILE_AT = new Date('2024-01-01T00:00:00Z');

export const DEMO_USER_ID = 'demo';

/** Paušální OSVČ s výchozí (bezpečnou) konfigurací výpočtu — jako reálný profil. */
function demoProfile(): ProfileRow {
  return {
    userId: DEMO_USER_ID,
    regime: 'PAUSAL',
    hasBusinessAssets: false,
    w8benFiled: true,
    otherIncomeCzk: '0',
    matchingMethod: 'FIFO',
    fxMethod: 'UNIFIED',
    limit100kStrict: true,
    timeTestBasis: 'settlement',
    derivativesExpensesPerType: false,
    emtTimeTestExempt: false,
    returnOfCapitalReducesBasis: false,
    createdAt: DEMO_PROFILE_AT,
    updatedAt: DEMO_PROFILE_AT,
  };
}

// ── transakce ───────────────────────────────────────────────────────────────

/** Zkratka pro BUY/SELL — poplatek v měně obchodu (grafy poplatků žijí). */
interface TradeArgs {
  id: string;
  isin: string;
  ticker?: string;
  name?: string;
  quantity: string;
  price: string;
  currency: string;
  date: string;
  settlement?: string;
  fee?: string;
  assetClass?: 'STOCK' | 'ETF' | 'CRYPTO' | 'DERIVATIVE';
  settlementStyle?: 'PREMIUM' | 'MARGIN';
}

const trade = (type: 'BUY' | 'SELL', args: TradeArgs) => ({
  type,
  id: args.id,
  isin: args.isin,
  ticker: args.ticker,
  name: args.name,
  assetClass: args.assetClass ?? 'STOCK',
  quantity: args.quantity,
  pricePerShare: args.price,
  currency: args.currency,
  tradeDate: args.date,
  settlementDate: args.settlement,
  fee: args.fee ? { amount: args.fee, currency: args.currency } : undefined,
  settlementStyle: args.settlementStyle,
});

const dividend = (
  id: string,
  isin: string,
  date: string,
  gross: string,
  withholding: string,
  currency: string,
  country: string,
) => ({
  type: 'DIVIDEND' as const,
  id,
  isin,
  gross,
  withholdingTax: withholding,
  currency,
  sourceCountry: country,
  date,
});

// ── katalog držených instrumentů (tabulkou — 50+ otevřených pozic) ──────────

/** Obchod v tabulce: rok jako OFFSET vůči běžnému roku (0 = letos). */
interface HoldingTrade {
  y: number;
  md: string; // 'MM-DD'
  qty: string;
  price: string;
  fee?: string;
}

interface Holding {
  tag: string; // do ID transakcí
  ticker: string;
  isin: string;
  name: string;
  currency: string;
  assetClass?: 'STOCK' | 'ETF' | 'CRYPTO';
  buys: HoldingTrade[];
  sells?: HoldingTrade[];
  /** Aktuální cena „od brokera“ (měna = currency instrumentu). */
  price: string;
}

/**
 * 48 instrumentů (+ 4 s relativním datem níže = 52 otevřených pozic).
 * ISINy jsou skutečné; prodeje nikdy nevyprázdní pozici. Historické prodeje
 * jsou rozprostřené tak, aby KAŽDÝ rok Y−5…Y−1 měl zisk i ztrátu.
 */
const HOLDINGS: Holding[] = [
  // ── US akcie ──────────────────────────────────────────────────────────
  // tři loty s RŮZNÝMI cenami (rostoucí) → metoda párování má na co působit,
  // tržba prodeje beze změny (limity a pásma drží); test NEsplněn → kryje úhrn do 100k
  { tag: 'aapl', ticker: 'AAPL', isin: 'US0378331005', name: 'Apple', currency: 'USD', price: '210', buys: [{ y: -2, md: '01-20', qty: '8', price: '150', fee: '1' }, { y: -1, md: '03-12', qty: '6', price: '172', fee: '1' }, { y: 0, md: '02-05', qty: '6', price: '205', fee: '1' }], sells: [{ y: 0, md: '05-14', qty: '6', price: '210', fee: '1' }] },
  { tag: 'googl', ticker: 'GOOGL', isin: 'US02079K3059', name: 'Alphabet', currency: 'USD', price: '195', buys: [{ y: -4, md: '07-19', qty: '12', price: '105', fee: '1' }] },
  { tag: 'amzn', ticker: 'AMZN', isin: 'US0231351067', name: 'Amazon', currency: 'USD', price: '225', buys: [{ y: -2, md: '06-09', qty: '2.6', price: '185', fee: '1' }] },
  { tag: 'meta', ticker: 'META', isin: 'US30303M1027', name: 'Meta Platforms', currency: 'USD', price: '700', buys: [{ y: -2, md: '02-22', qty: '4', price: '480', fee: '1' }], sells: [{ y: -1, md: '06-18', qty: '1', price: '620', fee: '1' }] },
  { tag: 'tsla', ticker: 'TSLA', isin: 'US88160R1014', name: 'Tesla', currency: 'USD', price: '330', buys: [{ y: -3, md: '02-10', qty: '8', price: '190', fee: '1' }], sells: [{ y: -3, md: '08-19', qty: '3', price: '250', fee: '1' }] },
  { tag: 'brkb', ticker: 'BRK.B', isin: 'US0846707026', name: 'Berkshire Hathaway B', currency: 'USD', price: '475', buys: [{ y: -3, md: '08-09', qty: '2', price: '300', fee: '1' }] },
  { tag: 'v', ticker: 'V', isin: 'US92826C8394', name: 'Visa', currency: 'USD', price: '290', buys: [{ y: -2, md: '06-24', qty: '5', price: '240', fee: '1' }] },
  { tag: 'ma', ticker: 'MA', isin: 'US57636Q1040', name: 'Mastercard', currency: 'USD', price: '520', buys: [{ y: -3, md: '06-21', qty: '3', price: '360', fee: '1' }] },
  { tag: 'ko', ticker: 'KO', isin: 'US1912161007', name: 'Coca-Cola', currency: 'USD', price: '62', buys: [{ y: -5, md: '04-12', qty: '45', price: '54', fee: '1' }], sells: [{ y: -5, md: '09-20', qty: '5', price: '57', fee: '1' }, { y: 0, md: '01-28', qty: '1', price: '62', fee: '0.5' }] }, // letošní prodej: test splněn
  { tag: 'pep', ticker: 'PEP', isin: 'US7134481081', name: 'PepsiCo', currency: 'USD', price: '172', buys: [{ y: -5, md: '05-20', qty: '10', price: '148', fee: '1' }] },
  { tag: 'mcd', ticker: 'MCD', isin: 'US5801351017', name: "McDonald's", currency: 'USD', price: '295', buys: [{ y: -5, md: '06-14', qty: '4', price: '232', fee: '1' }] },
  { tag: 'nke', ticker: 'NKE', isin: 'US6541061031', name: 'Nike', currency: 'USD', price: '75', buys: [{ y: -2, md: '03-05', qty: '20', price: '98', fee: '1' }], sells: [{ y: -2, md: '09-14', qty: '8', price: '74', fee: '1' }] },
  { tag: 'jnj', ticker: 'JNJ', isin: 'US4781601046', name: 'Johnson & Johnson', currency: 'USD', price: '155', buys: [{ y: -5, md: '02-08', qty: '10', price: '165', fee: '1' }] },
  { tag: 'pg', ticker: 'PG', isin: 'US7427181091', name: 'Procter & Gamble', currency: 'USD', price: '165', buys: [{ y: -5, md: '03-15', qty: '12', price: '135', fee: '1' }] },
  { tag: 'xom', ticker: 'XOM', isin: 'US30231G1022', name: 'Exxon Mobil', currency: 'USD', price: '112', buys: [{ y: -5, md: '08-19', qty: '25', price: '58', fee: '1' }], sells: [{ y: -4, md: '11-08', qty: '10', price: '95', fee: '1' }] },
  { tag: 'jpm', ticker: 'JPM', isin: 'US46625H1005', name: 'JPMorgan Chase', currency: 'USD', price: '245', buys: [{ y: -3, md: '04-05', qty: '10', price: '135', fee: '1' }] },
  { tag: 'dis', ticker: 'DIS', isin: 'US2546871060', name: 'Walt Disney', currency: 'USD', price: '112', buys: [{ y: -5, md: '03-02', qty: '10', price: '180', fee: '1' }], sells: [{ y: -3, md: '10-12', qty: '4', price: '85', fee: '1' }] },
  { tag: 'nflx', ticker: 'NFLX', isin: 'US64110L1061', name: 'Netflix', currency: 'USD', price: '990', buys: [{ y: -4, md: '04-22', qty: '5', price: '220', fee: '1' }], sells: [{ y: -4, md: '10-14', qty: '2', price: '190', fee: '1' }] },
  { tag: 'amd', ticker: 'AMD', isin: 'US0079031078', name: 'AMD', currency: 'USD', price: '160', buys: [{ y: -4, md: '06-08', qty: '30', price: '85', fee: '1' }], sells: [{ y: -2, md: '07-25', qty: '10', price: '160', fee: '1' }] },
  { tag: 'intc', ticker: 'INTC', isin: 'US4581401001', name: 'Intel', currency: 'USD', price: '24', buys: [{ y: -5, md: '01-21', qty: '40', price: '52', fee: '1' }], sells: [{ y: -5, md: '11-05', qty: '15', price: '45', fee: '1' }] },
  { tag: 'adbe', ticker: 'ADBE', isin: 'US00724F1012', name: 'Adobe', currency: 'USD', price: '520', buys: [{ y: -3, md: '09-14', qty: '3', price: '480', fee: '1' }] },
  { tag: 'crm', ticker: 'CRM', isin: 'US79466L3024', name: 'Salesforce', currency: 'USD', price: '270', buys: [{ y: -3, md: '10-05', qty: '4', price: '210', fee: '1' }], sells: [{ y: -1, md: '04-15', qty: '1', price: '195', fee: '1' }] },
  { tag: 'orcl', ticker: 'ORCL', isin: 'US68389X1054', name: 'Oracle', currency: 'USD', price: '150', buys: [{ y: -4, md: '09-12', qty: '15', price: '70', fee: '1' }], sells: [{ y: -1, md: '09-10', qty: '5', price: '150', fee: '1' }] },
  { tag: 'csco', ticker: 'CSCO', isin: 'US17275R1023', name: 'Cisco', currency: 'USD', price: '58', buys: [{ y: -4, md: '02-15', qty: '20', price: '43', fee: '1' }] },
  { tag: 'pltr', ticker: 'PLTR', isin: 'US69608A1088', name: 'Palantir', currency: 'USD', price: '79', buys: [{ y: -2, md: '05-30', qty: '40', price: '22', fee: '1' }] },
  { tag: 'cost', ticker: 'COST', isin: 'US22160K1051', name: 'Costco', currency: 'USD', price: '940', buys: [{ y: -1, md: '02-04', qty: '1', price: '890', fee: '1' }] },
  { tag: 'mo', ticker: 'MO', isin: 'US02209S1033', name: 'Altria', currency: 'USD', price: '39.5', buys: [{ y: -1, md: '01-22', qty: '30', price: '41', fee: '1' }] },
  { tag: 'o', ticker: 'O', isin: 'US7561091049', name: 'Realty Income', currency: 'USD', price: '58', buys: [{ y: -4, md: '03-17', qty: '40.25', price: '52', fee: '1' }] },
  // velký prodej v Y−1 (dva loty za různé ceny, prodej jen části) → rok Y−1
  // prolomí limit 100k a varianty párování dávají RŮZNÝ základ (FIFO zisk,
  // LIFO ztrátu) — letošního příběhu se nedotýká (engine počítá roky odděleně)
  { tag: 'shop', ticker: 'SHOP', isin: 'CA82509L1076', name: 'Shopify', currency: 'USD', price: '103', buys: [{ y: -3, md: '05-08', qty: '80', price: '40', fee: '1' }, { y: -2, md: '04-14', qty: '80', price: '65', fee: '1' }], sells: [{ y: -1, md: '08-20', qty: '80', price: '48', fee: '1' }] },
  // ── mimo USA ──────────────────────────────────────────────────────────
  { tag: 'ulvr', ticker: 'ULVR', isin: 'GB00B10RZP78', name: 'Unilever', currency: 'GBP', price: '44.1', buys: [{ y: -2, md: '11-03', qty: '25', price: '38.2', fee: '1' }] },
  { tag: 'tm', ticker: '7203', isin: 'JP3633400001', name: 'Toyota Motor', currency: 'USD', price: '178', buys: [{ y: -1, md: '10-02', qty: '8', price: '168', fee: '1' }] },
  { tag: 'asml', ticker: 'ASML', isin: 'NL0010273215', name: 'ASML Holding', currency: 'EUR', price: '810', buys: [{ y: -2, md: '09-08', qty: '3', price: '620', fee: '1' }] },
  { tag: 'sap', ticker: 'SAP', isin: 'DE0007164600', name: 'SAP', currency: 'EUR', price: '205', buys: [{ y: -3, md: '03-20', qty: '6', price: '110', fee: '1' }] },
  { tag: 'mc', ticker: 'MC', isin: 'FR0000121014', name: 'LVMH', currency: 'EUR', price: '640', buys: [{ y: -3, md: '04-18', qty: '1', price: '820', fee: '1' }] },
  { tag: 'nesn', ticker: 'NESN', isin: 'CH0038863350', name: 'Nestlé', currency: 'CHF', price: '78', buys: [{ y: -1, md: '02-12', qty: '12', price: '92', fee: '1' }] },
  { tag: 'novo', ticker: 'NOVO-B', isin: 'DK0062498333', name: 'Novo Nordisk', currency: 'DKK', price: '450', buys: [{ y: -2, md: '04-10', qty: '15', price: '700', fee: '2' }] },
  { tag: 'alv', ticker: 'ALV', isin: 'DE0008404005', name: 'Allianz', currency: 'EUR', price: '345', buys: [{ y: -2, md: '05-11', qty: '4', price: '210', fee: '1' }] },
  { tag: 'sie', ticker: 'SIE', isin: 'DE0007236101', name: 'Siemens', currency: 'EUR', price: '230', buys: [{ y: -5, md: '09-07', qty: '6', price: '130', fee: '1' }] },
  { tag: 'bmw', ticker: 'BMW', isin: 'DE0005190003', name: 'BMW', currency: 'EUR', price: '88', buys: [{ y: -5, md: '10-12', qty: '8', price: '84', fee: '1' }] },
  // ── ETF ───────────────────────────────────────────────────────────────
  { tag: 'vwce', ticker: 'VWCE', isin: 'IE00BK5BQT80', name: 'Vanguard FTSE All-World', currency: 'EUR', assetClass: 'ETF', price: '138', buys: [{ y: -4, md: '05-18', qty: '60.5', price: '95', fee: '1.5' }, { y: 0, md: '02-10', qty: '5', price: '135', fee: '1' }], sells: [{ y: 0, md: '03-20', qty: '20', price: '130', fee: '1.5' }] }, // letošní prodej: test splněn
  { tag: 'iwda', ticker: 'IWDA', isin: 'IE00B4L5Y983', name: 'iShares Core MSCI World', currency: 'USD', assetClass: 'ETF', price: '110', buys: [{ y: -1, md: '07-03', qty: '25', price: '95', fee: '1' }] },
  { tag: 'vusa', ticker: 'VUSA', isin: 'IE00B3XXRP09', name: 'Vanguard S&P 500', currency: 'EUR', assetClass: 'ETF', price: '105', buys: [{ y: -1, md: '05-14', qty: '12', price: '90', fee: '1' }] },
  { tag: 'qdve', ticker: 'QDVE', isin: 'IE00B3WJKG14', name: 'iShares S&P 500 Information Technology', currency: 'EUR', assetClass: 'ETF', price: '34', buys: [{ y: -1, md: '06-11', qty: '10', price: '28', fee: '1' }] },
  { tag: 'eimi', ticker: 'EIMI', isin: 'IE00BKM4GZ66', name: 'iShares Core MSCI EM IMI', currency: 'USD', assetClass: 'ETF', price: '36', buys: [{ y: -1, md: '04-08', qty: '30', price: '33', fee: '1' }] },
  { tag: 'aggh', ticker: 'AGGH', isin: 'IE00BDBRDM35', name: 'iShares Core Global Aggregate Bond EUR Hedged', currency: 'EUR', assetClass: 'ETF', price: '5.15', buys: [{ y: -1, md: '08-20', qty: '200', price: '5.05', fee: '1' }] },
  // ── krypto (ISIN = symbol, ceny v CZK) ────────────────────────────────
  { tag: 'btc', ticker: 'BTC', isin: 'BTC', name: 'Bitcoin', currency: 'CZK', assetClass: 'CRYPTO', price: '2350000', buys: [{ y: -2, md: '01-15', qty: '0.05', price: '1900000' }], sells: [{ y: 0, md: '04-22', qty: '0.02', price: '2300000' }] }, // 46 000 Kč → krypto limit v zeleném
  { tag: 'eth', ticker: 'ETH', isin: 'ETH', name: 'Ethereum', currency: 'CZK', assetClass: 'CRYPTO', price: '75000', buys: [{ y: -3, md: '05-11', qty: '0.5', price: '42000' }] },
  { tag: 'sol', ticker: 'SOL', isin: 'SOL', name: 'Solana', currency: 'CZK', assetClass: 'CRYPTO', price: '3900', buys: [{ y: -1, md: '03-27', qty: '5', price: '3400' }] },
];

// ── plán dividend (rok jako offset → měsíce výplat) ─────────────────────────

const Q_LEDEN = ['01', '04', '07', '10'];
const Q_UNOR = ['02', '05', '08', '11'];
const Q_BREZEN = ['03', '06', '09', '12'];
const MESICNE = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

interface DividendPlan {
  tag: string;
  isin: string;
  currency: string;
  country: string;
  gross: string;
  wht: string;
  day: string;
  byYear: Record<number, string[]>;
}

/** První výplata každého instrumentu je vždy až PO jeho nákupu. */
const DIVIDEND_PLANS: DividendPlan[] = [
  // US 15 % (W-8BEN v pořádku)
  { tag: 'ko', isin: 'US1912161007', currency: 'USD', country: 'US', gross: '24', wht: '3.60', day: '09', byYear: { [-5]: ['07', '10'], [-4]: Q_LEDEN, [-3]: Q_LEDEN, [-2]: Q_LEDEN, [-1]: Q_LEDEN, 0: Q_LEDEN } },
  { tag: 'aapl', isin: 'US0378331005', currency: 'USD', country: 'US', gross: '30', wht: '4.50', day: '13', byYear: { [-2]: Q_UNOR, [-1]: Q_UNOR, 0: Q_UNOR } },
  { tag: 'msft', isin: 'US5949181045', currency: 'USD', country: 'US', gross: '28', wht: '4.20', day: '12', byYear: { 0: Q_BREZEN } },
  { tag: 'o', isin: 'US7561091049', currency: 'USD', country: 'US', gross: '24', wht: '3.60', day: '15', byYear: { [-4]: MESICNE.slice(3), [-3]: MESICNE, [-2]: MESICNE, [-1]: MESICNE, 0: MESICNE } },
  { tag: 'v', isin: 'US92826C8394', currency: 'USD', country: 'US', gross: '10', wht: '1.50', day: '03', byYear: { [-2]: ['09', '12'], [-1]: Q_BREZEN, 0: Q_BREZEN } },
  { tag: 'jnj', isin: 'US4781601046', currency: 'USD', country: 'US', gross: '28', wht: '4.20', day: '10', byYear: { [-5]: ['06', '09', '12'], [-4]: Q_BREZEN, [-3]: Q_BREZEN, [-2]: Q_BREZEN, [-1]: Q_BREZEN, 0: Q_BREZEN } },
  { tag: 'pg', isin: 'US7427181091', currency: 'USD', country: 'US', gross: '26', wht: '3.90', day: '17', byYear: { [-5]: ['05', '08', '11'], [-4]: Q_UNOR, [-3]: Q_UNOR, [-2]: Q_UNOR, [-1]: Q_UNOR, 0: Q_UNOR } },
  { tag: 'xom', isin: 'US30231G1022', currency: 'USD', country: 'US', gross: '22', wht: '3.30', day: '10', byYear: { [-5]: ['09', '12'], [-4]: Q_BREZEN, [-3]: Q_BREZEN, [-2]: Q_BREZEN, [-1]: Q_BREZEN, 0: Q_BREZEN } },
  // US 30 % — u custodiana chybí W-8BEN → varování „srážka nad smlouvu“
  { tag: 'mo', isin: 'US02209S1033', currency: 'USD', country: 'US', gross: '75', wht: '22.50', day: '25', byYear: { [-1]: ['04', '07', '10'], 0: Q_LEDEN } },
  // DE 26,375 % (KESt nad smluvních 15 %)
  { tag: 'sap', isin: 'DE0007164600', currency: 'EUR', country: 'DE', gross: '160', wht: '42.20', day: '20', byYear: { [-2]: ['05'], [-1]: ['05'], 0: ['05'] } },
  { tag: 'alv', isin: 'DE0008404005', currency: 'EUR', country: 'DE', gross: '240', wht: '63.30', day: '08', byYear: { [-1]: ['05'], 0: ['05'] } },
  // NL 15 % nad smluvních 10 %
  { tag: 'asml', isin: 'NL0010273215', currency: 'EUR', country: 'NL', gross: '95', wht: '14.25', day: '15', byYear: { [-1]: ['02', '08'], 0: ['02', '08'] } },
  // JP 15 % (v rámci smlouvy)
  { tag: 'tm', isin: 'JP3633400001', currency: 'USD', country: 'JP', gross: '110', wht: '16.50', day: '27', byYear: { 0: ['05', '11'] } },
  // GB 0 % srážka
  { tag: 'ulvr', isin: 'GB00B10RZP78', currency: 'GBP', country: 'GB', gross: '55', wht: '0', day: '25', byYear: { [-1]: ['03', '09'], 0: ['03', '09'] } },
];

// ── syntetické denní kurzy ──────────────────────────────────────────────────

/** Deterministický wiggle ±2 % z FNV-1a hashe klíče (žádný Math.random). */
function rateWiggle(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.sin(((hash >>> 0) / 0xffffffff) * Math.PI * 2) * 0.02;
}

/**
 * Syntetické denní kurzy pro srovnání variant výpočtu v demo reportu:
 * pro každé datum × měnu transakce kurz = jednotný kurz roku × (1 ± 2 %),
 * deterministicky (sinus z hashe klíče). Reálný report bere denní kurzy ČNB
 * z DB (loadDailyRates) — demo tak ukáže kompletní tabulku 8 variant.
 */
function syntheticDailyRates(
  txs: Transaction[],
  today: string,
): DailyRateProvider & { fingerprint: string } {
  const rates: Record<string, string> = {};
  const add = (currency: string, date: string | undefined): void => {
    if (!date || currency === 'CZK') return;
    const key = `${currency}:${date}`;
    if (rates[key]) return;
    const unified = UNIFIED_RATES[Number(date.slice(0, 4))]?.[currency];
    if (!unified) return; // bez jednotného kurzu není z čeho odvozovat
    rates[key] = d(unified)
      .mul(d((1 + rateWiggle(key)).toFixed(6)))
      .toDecimalPlaces(4)
      .toString();
  };
  for (const tx of txs) {
    if (tx.type === 'BUY' || tx.type === 'SELL') {
      add(tx.currency, tx.tradeDate);
      add(tx.currency, tx.settlementDate);
      if (tx.fee) {
        add(tx.fee.currency, tx.tradeDate);
        add(tx.fee.currency, tx.settlementDate);
      }
    } else if ('currency' in tx && 'date' in tx) {
      add(tx.currency, tx.date);
    }
  }
  const provider = new MapRateProvider(rates);
  // otisk pro cache výsledků enginu (F-3-1): dataset i kurzy jsou plně určené
  // „dneškem" dema, takže veřejný demo report nepočítá 9 běhů enginu při každém
  // zobrazení znovu
  return { fingerprint: `demo:${today}`, getRate: (c, day) => provider.getRate(c, day) };
}

// ── sestavení datasetu ──────────────────────────────────────────────────────

export interface DemoDataset {
  txs: Transaction[];
  profile: ProfileRow;
  prices: Map<string, InstrumentPrice>;
  /** Syntetické denní kurzy (jednotný kurz roku ±2 %) — pro varianty v reportu. */
  dailyRates: DailyRateProvider & { fingerprint: string };
}

export function demoDataset(today: string): DemoDataset {
  const year = Number(today.slice(0, 4));
  const Y = (offset: number): number => year + offset;

  // pozice s blížícím se osvobozením: datum VYPOŘÁDÁNÍ = dnešek − 3 roky
  // + požadovaný odstup → časový test doběhne přesně za ~12 dní / 2 měsíce /
  // 8 měsíců / 2 roky (obchod o 2 dny dřív, T+2)
  const settleAt = (shift: (base: string) => string): { date: string; settlement: string } => {
    const settlement = shift(addYears(today, -3));
    return { date: addDays(settlement, -2), settlement };
  };
  const cspx = settleAt((base) => addDays(base, 12));
  const msft = settleAt((base) => addMonths(base, 2));
  const nvda = settleAt((base) => addMonths(base, 8));
  const vuaa = settleAt((base) => addMonths(base, 24));

  const raw = [
    // ── nákupy a prodeje z katalogu (Y−5 … letos) ────────────────────────
    ...HOLDINGS.flatMap((h) => [
      ...h.buys.map((b, i) =>
        trade('BUY', { id: `demo-${h.tag}-b${i + 1}`, isin: h.isin, ticker: h.ticker, name: h.name, assetClass: h.assetClass, quantity: b.qty, price: b.price, currency: h.currency, date: `${Y(b.y)}-${b.md}`, fee: b.fee })),
      ...(h.sells ?? []).map((s, i) =>
        trade('SELL', { id: `demo-${h.tag}-s${i + 1}`, isin: h.isin, assetClass: h.assetClass, quantity: s.qty, price: s.price, currency: h.currency, date: `${Y(s.y)}-${s.md}`, fee: s.fee })),
    ]),

    // ── blížící se osvobození (relativně k dnešku — příběh platí věčně) ──
    trade('BUY', { id: 'demo-cspx-b1', isin: 'IE00B5BMR087', ticker: 'CSPX', name: 'iShares Core S&P 500', assetClass: 'ETF', quantity: '15', price: '430', currency: 'USD', date: cspx.date, settlement: cspx.settlement, fee: '2' }),
    trade('BUY', { id: 'demo-msft-b1', isin: 'US5949181045', ticker: 'MSFT', name: 'Microsoft', quantity: '12', price: '380', currency: 'USD', date: msft.date, settlement: msft.settlement, fee: '1' }),
    trade('BUY', { id: 'demo-nvda-b1', isin: 'US67066G1040', ticker: 'NVDA', name: 'NVIDIA', quantity: '8', price: '95', currency: 'USD', date: nvda.date, settlement: nvda.settlement, fee: '1' }),
    trade('BUY', { id: 'demo-vuaa-b1', isin: 'IE00BFMXXD54', ticker: 'VUAA', name: 'Vanguard S&P 500 (akum.)', assetClass: 'ETF', quantity: '70', price: '96', currency: 'USD', date: vuaa.date, settlement: vuaa.settlement, fee: '1' }),

    // ── opce (PREMIUM): jedna uzavřená (report), jedna otevřená (portfolio) ──
    trade('BUY', { id: 'demo-opt1-b1', isin: 'OPT:AAPL-C230', name: 'Opce AAPL call 230', assetClass: 'DERIVATIVE', settlementStyle: 'PREMIUM', quantity: '1', price: '280', currency: 'USD', date: `${year}-03-03`, fee: '1' }),
    trade('SELL', { id: 'demo-opt1-s1', isin: 'OPT:AAPL-C230', assetClass: 'DERIVATIVE', settlementStyle: 'PREMIUM', quantity: '1', price: '690', currency: 'USD', date: `${year}-06-10`, fee: '1' }),
    trade('BUY', { id: 'demo-opt2-b1', isin: 'OPT:SPY-P560', name: 'Opce SPY put 560', assetClass: 'DERIVATIVE', settlementStyle: 'PREMIUM', quantity: '1', price: '150', currency: 'USD', date: `${year}-06-25`, fee: '1' }),

    // ── dividendy podle plánu (každý rok Y−5 … Y) ────────────────────────
    ...DIVIDEND_PLANS.flatMap((plan) =>
      Object.entries(plan.byYear).flatMap(([offset, months]) =>
        months.map((mm, i) =>
          dividend(`demo-${plan.tag}-d${offset}-${i}`, plan.isin, `${Y(Number(offset))}-${mm}-${plan.day}`, plan.gross, plan.wht, plan.currency, plan.country)))),

    // ── úroky z hotovosti u brokera (každý rok) ──────────────────────────
    ...[-5, -4, -3, -2, -1, 0].flatMap((offset) => [
      { type: 'INTEREST' as const, id: `demo-int${offset}-1`, amount: '30', currency: 'USD', sourceCountry: 'US', date: `${Y(offset)}-02-01` },
      { type: 'INTEREST' as const, id: `demo-int${offset}-2`, amount: '35', currency: 'USD', sourceCountry: 'US', date: `${Y(offset)}-08-01` },
    ]),
  ];

  // ── poslední ceny (jako od brokera; asOf = dnešek dema) ───────────────────
  // hodnota portfolia ≈ 2 mil. Kč; INTC, NKE, NESN, NOVO-B, MC a MO ve ztrátě
  const asOf = utc(today);
  const prices = new Map<string, InstrumentPrice>([
    ...HOLDINGS.map((h): [string, InstrumentPrice] => [
      h.isin,
      { price: d(h.price), currency: h.currency, source: 'demo', asOf },
    ]),
    ['IE00B5BMR087', { price: d('560'), currency: 'USD', source: 'demo', asOf }],
    ['US5949181045', { price: d('505'), currency: 'USD', source: 'demo', asOf }],
    ['US67066G1040', { price: d('176'), currency: 'USD', source: 'demo', asOf }],
    ['IE00BFMXXD54', { price: d('102'), currency: 'USD', source: 'demo', asOf }],
  ]);

  const txs = parseTransactions(raw);
  return { txs, profile: demoProfile(), prices, dailyRates: syntheticDailyRates(txs, today) };
}
