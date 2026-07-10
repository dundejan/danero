import { parseTransactions, type Transaction } from '@danero/shared';
import { d } from '@danero/shared';
import type { ProfileRow } from '@/lib/portfolio';
import type { InstrumentPrice } from '@/lib/prices';
import { UNIFIED_RATES } from '@/lib/tax-config';

/**
 * Ukázková data pro demo prohlídku (bez registrace, bez DB): fiktivní
 * investor — paušální OSVČ s portfoliem akcií, ETF, krypta a opcí.
 *
 * Dataset je DETERMINISTICKÝ a datumy se počítají RELATIVNĚ k `today`,
 * aby demo příběh platil věčně:
 *  - CSPX splní časový test za ~12 dní, MSFT za ~2 měsíce, NVDA za ~8 měsíců,
 *    VUAA za ~2 roky → horizont osvobození žije v různých vzdálenostech;
 *  - letošní prodeje CP ≈ 91 000 Kč → limit 100k v pásmu CRITICAL (oranžová);
 *  - zdanitelné příjmy (dividendy + úroky + opce) ≈ 58 000 Kč → prolomený
 *    limit 50k paušální daně → verdikt „podáš přiznání";
 *  - prodej BTC 46 000 Kč → krypto limit v zeleném (osvobozeno úhrnem).
 *
 * Události BĚŽNÉHO roku (prodeje, dividendy, opce) mají pevné datumy v rámci
 * roku — engine počítá celé zdaňovací období, takže verdikt a odměrky drží
 * po celý rok (část událostí může být vůči dnešku „v budoucnu", to je záměr).
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

/** „Dnešek" dema: skutečné datum s rokem přištípnutým na poslední rok s kurzy. */
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
    derivativesExpensesPerDruh: false,
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

export interface DemoDataset {
  txs: Transaction[];
  profile: ProfileRow;
  prices: Map<string, InstrumentPrice>;
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
    // ── nákupy (rozložené Y−5 … letos) ──────────────────────────────────
    trade('BUY', { id: 'demo-ko-b1', isin: 'US1912161007', ticker: 'KO', name: 'Coca-Cola', quantity: '45', price: '54', currency: 'USD', date: `${Y(-5)}-04-12`, fee: '1' }),
    trade('BUY', { id: 'demo-vwce-b1', isin: 'IE00BK5BQT80', ticker: 'VWCE', name: 'Vanguard FTSE All-World', assetClass: 'ETF', quantity: '40.5', price: '95', currency: 'EUR', date: `${Y(-4)}-05-18`, fee: '1.5' }),
    trade('BUY', { id: 'demo-tsla-b1', isin: 'US88160R1014', ticker: 'TSLA', name: 'Tesla', quantity: '5', price: '190', currency: 'USD', date: `${Y(-3)}-02-10`, fee: '1' }),
    trade('BUY', { id: 'demo-sap-b1', isin: 'DE0007164600', ticker: 'SAP', name: 'SAP', quantity: '6', price: '110', currency: 'EUR', date: `${Y(-3)}-03-20`, fee: '1' }),
    // blížící se osvobození (relativně k dnešku — příběh platí věčně)
    trade('BUY', { id: 'demo-cspx-b1', isin: 'IE00B5BMR087', ticker: 'CSPX', name: 'iShares Core S&P 500', assetClass: 'ETF', quantity: '15', price: '430', currency: 'USD', date: cspx.date, settlement: cspx.settlement, fee: '2' }),
    trade('BUY', { id: 'demo-msft-b1', isin: 'US5949181045', ticker: 'MSFT', name: 'Microsoft', quantity: '12', price: '380', currency: 'USD', date: msft.date, settlement: msft.settlement, fee: '1' }),
    trade('BUY', { id: 'demo-nvda-b1', isin: 'US67066G1040', ticker: 'NVDA', name: 'NVIDIA', quantity: '8', price: '95', currency: 'USD', date: nvda.date, settlement: nvda.settlement, fee: '1' }),
    trade('BUY', { id: 'demo-vuaa-b1', isin: 'IE00BFMXXD54', ticker: 'VUAA', name: 'Vanguard S&P 500 (akum.)', assetClass: 'ETF', quantity: '100', price: '96', currency: 'USD', date: vuaa.date, settlement: vuaa.settlement, fee: '1' }),
    trade('BUY', { id: 'demo-btc-b1', isin: 'BTC', ticker: 'BTC', name: 'Bitcoin', assetClass: 'CRYPTO', quantity: '0.05', price: '1900000', currency: 'CZK', date: `${Y(-2)}-01-15` }),
    trade('BUY', { id: 'demo-aapl-b1', isin: 'US0378331005', ticker: 'AAPL', name: 'Apple', quantity: '20', price: '165', currency: 'USD', date: `${Y(-2)}-01-20`, fee: '1' }),
    trade('BUY', { id: 'demo-nke-b1', isin: 'US6541061031', ticker: 'NKE', name: 'Nike', quantity: '12', price: '98', currency: 'USD', date: `${Y(-2)}-03-05`, fee: '1' }),
    trade('BUY', { id: 'demo-alv-b1', isin: 'DE0008404005', ticker: 'ALV', name: 'Allianz', quantity: '4', price: '210', currency: 'EUR', date: `${Y(-2)}-05-11`, fee: '1' }),
    trade('BUY', { id: 'demo-v-b1', isin: 'US92826C8394', ticker: 'V', name: 'Visa', quantity: '5', price: '240', currency: 'USD', date: `${Y(-2)}-06-24`, fee: '1' }),
    trade('BUY', { id: 'demo-asml-b1', isin: 'NL0010273215', ticker: 'ASML', name: 'ASML Holding', quantity: '3', price: '620', currency: 'EUR', date: `${Y(-2)}-09-08`, fee: '1' }),
    trade('BUY', { id: 'demo-ulvr-b1', isin: 'GB00B10RZP78', ticker: 'ULVR', name: 'Unilever', quantity: '25', price: '38.2', currency: 'GBP', date: `${Y(-2)}-11-03`, fee: '1' }),
    trade('BUY', { id: 'demo-mo-b1', isin: 'US02209S1033', ticker: 'MO', name: 'Altria', quantity: '30', price: '41', currency: 'USD', date: `${Y(-1)}-01-22`, fee: '1' }),
    trade('BUY', { id: 'demo-nesn-b1', isin: 'CH0038863350', ticker: 'NESN', name: 'Nestlé', quantity: '12', price: '92', currency: 'EUR', date: `${Y(-1)}-02-12`, fee: '1' }),
    trade('BUY', { id: 'demo-o-b1', isin: 'US7561091049', ticker: 'O', name: 'Realty Income', quantity: '60.25', price: '52', currency: 'USD', date: `${Y(-1)}-03-17`, fee: '1' }),
    trade('BUY', { id: 'demo-amzn-b1', isin: 'US0231351067', ticker: 'AMZN', name: 'Amazon', quantity: '2.6', price: '185', currency: 'USD', date: `${Y(-1)}-06-09`, fee: '1' }),
    trade('BUY', { id: 'demo-tm-b1', isin: 'JP3633400001', ticker: '7203', name: 'Toyota Motor', quantity: '8', price: '168', currency: 'USD', date: `${Y(-1)}-10-02`, fee: '1' }),
    trade('BUY', { id: 'demo-vwce-b2', isin: 'IE00BK5BQT80', ticker: 'VWCE', assetClass: 'ETF', quantity: '5', price: '135', currency: 'EUR', date: `${year}-02-10`, fee: '1' }),

    // ── historické prodeje (graf realizovaných zisků po letech) ─────────
    trade('SELL', { id: 'demo-tsla-s1', isin: 'US88160R1014', quantity: '5', price: '250', currency: 'USD', date: `${Y(-2)}-08-19`, fee: '1' }), // zisk v Y−2
    trade('SELL', { id: 'demo-nke-s1', isin: 'US6541061031', quantity: '12', price: '74', currency: 'USD', date: `${Y(-1)}-09-14`, fee: '1' }), // ztráta v Y−1

    // ── letošní prodeje CP: úhrn ≈ 91 000 Kč → pásmo CRITICAL limitu 100k;
    //    mix důvodů osvobození (časový test × úhrn do 100k) ────────────────
    trade('SELL', { id: 'demo-ko-s1', isin: 'US1912161007', quantity: '1', price: '62', currency: 'USD', date: `${year}-01-28`, fee: '0.5' }), // test splněn
    trade('SELL', { id: 'demo-vwce-s1', isin: 'IE00BK5BQT80', quantity: '20', price: '130', currency: 'EUR', date: `${year}-03-20`, fee: '1.5' }), // test splněn
    trade('SELL', { id: 'demo-aapl-s1', isin: 'US0378331005', quantity: '6', price: '210', currency: 'USD', date: `${year}-05-14`, fee: '1' }), // test NEsplněn → kryje úhrn do 100k

    // ── krypto: částečný prodej pod 100 000 Kč → osvobozeno úhrnem ──────
    trade('SELL', { id: 'demo-btc-s1', isin: 'BTC', assetClass: 'CRYPTO', quantity: '0.02', price: '2300000', currency: 'CZK', date: `${year}-04-22` }),

    // ── opce (PREMIUM): jedna uzavřená (report), jedna otevřená (portfolio) ──
    trade('BUY', { id: 'demo-opt1-b1', isin: 'OPT:AAPL-C230', name: 'Opce AAPL call 230', assetClass: 'DERIVATIVE', settlementStyle: 'PREMIUM', quantity: '1', price: '280', currency: 'USD', date: `${year}-03-03`, fee: '1' }),
    trade('SELL', { id: 'demo-opt1-s1', isin: 'OPT:AAPL-C230', assetClass: 'DERIVATIVE', settlementStyle: 'PREMIUM', quantity: '1', price: '690', currency: 'USD', date: `${year}-06-10`, fee: '1' }),
    trade('BUY', { id: 'demo-opt2-b1', isin: 'OPT:SPY-P560', name: 'Opce SPY put 560', assetClass: 'DERIVATIVE', settlementStyle: 'PREMIUM', quantity: '1', price: '150', currency: 'USD', date: `${year}-06-25`, fee: '1' }),

    // ── dividendy: 5 států, rozprostřené po měsících ─────────────────────
    // US 15 % (W-8BEN v pořádku)
    ...['01', '04', '07', '10'].map((mm, i) =>
      dividend(`demo-ko-d${i}`, 'US1912161007', `${year}-${mm}-09`, '24', '3.60', 'USD', 'US')),
    ...['02', '05', '08', '11'].map((mm, i) =>
      dividend(`demo-aapl-d${i}`, 'US0378331005', `${year}-${mm}-13`, '30', '4.50', 'USD', 'US')),
    ...['03', '06', '09', '12'].map((mm, i) =>
      dividend(`demo-msft-d${i}`, 'US5949181045', `${year}-${mm}-12`, '28', '4.20', 'USD', 'US')),
    ...Array.from({ length: 12 }, (_, i) =>
      dividend(`demo-o-d${i}`, 'US7561091049', `${year}-${String(i + 1).padStart(2, '0')}-15`, '24', '3.60', 'USD', 'US')),
    ...['03', '06', '09', '12'].map((mm, i) =>
      dividend(`demo-v-d${i}`, 'US92826C8394', `${year}-${mm}-03`, '10', '1.50', 'USD', 'US')),
    // US 30 % — u custodiana chybí W-8BEN → varování „srážka nad smlouvu"
    ...['01', '04', '07', '10'].map((mm, i) =>
      dividend(`demo-mo-d${i}`, 'US02209S1033', `${year}-${mm}-25`, '75', '22.50', 'USD', 'US')),
    // DE 26,375 % (KESt nad smluvních 15 %)
    dividend('demo-sap-d0', 'DE0007164600', `${year}-05-20`, '160', '42.20', 'EUR', 'DE'),
    dividend('demo-alv-d0', 'DE0008404005', `${year}-05-08`, '240', '63.30', 'EUR', 'DE'),
    // NL 15 % nad smluvních 10 %
    dividend('demo-asml-d0', 'NL0010273215', `${year}-02-18`, '95', '14.25', 'EUR', 'NL'),
    dividend('demo-asml-d1', 'NL0010273215', `${year}-08-12`, '95', '14.25', 'EUR', 'NL'),
    // JP 15 % (v rámci smlouvy)
    dividend('demo-tm-d0', 'JP3633400001', `${year}-05-27`, '110', '16.50', 'USD', 'JP'),
    dividend('demo-tm-d1', 'JP3633400001', `${year}-11-26`, '110', '16.50', 'USD', 'JP'),
    // GB 0 % srážka
    dividend('demo-ulvr-d0', 'GB00B10RZP78', `${year}-03-27`, '55', '0', 'GBP', 'GB'),
    dividend('demo-ulvr-d1', 'GB00B10RZP78', `${year}-09-24`, '55', '0', 'GBP', 'GB'),

    // ── úroky z hotovosti u brokera ──────────────────────────────────────
    { type: 'INTEREST' as const, id: 'demo-int-1', amount: '30', currency: 'USD', sourceCountry: 'US', date: `${year}-02-01` },
    { type: 'INTEREST' as const, id: 'demo-int-2', amount: '35', currency: 'USD', sourceCountry: 'US', date: `${year}-08-01` },
  ];

  // ── poslední ceny (jako od brokera; asOf = dnešek dema) ───────────────────
  // hodnota portfolia ≈ 1,16 mil. Kč; NESN a MO záměrně ve ztrátě
  const priceList: Array<[isin: string, price: string, currency: string]> = [
    ['IE00BK5BQT80', '138', 'EUR'],
    ['IE00B5BMR087', '560', 'USD'],
    ['US0378331005', '210', 'USD'],
    ['US5949181045', '505', 'USD'],
    ['US67066G1040', '176', 'USD'],
    ['US1912161007', '62', 'USD'],
    ['US7561091049', '58', 'USD'],
    ['IE00BFMXXD54', '102', 'USD'],
    ['NL0010273215', '810', 'EUR'],
    ['DE0007164600', '205', 'EUR'],
    ['DE0008404005', '345', 'EUR'],
    ['CH0038863350', '78', 'EUR'],
    ['GB00B10RZP78', '44.1', 'GBP'],
    ['US02209S1033', '39.5', 'USD'],
    ['JP3633400001', '178', 'USD'],
    ['US0231351067', '225', 'USD'],
    ['US92826C8394', '290', 'USD'],
    ['BTC', '2350000', 'CZK'],
  ];
  const asOf = utc(today);
  const prices = new Map<string, InstrumentPrice>(
    priceList.map(([isin, price, currency]) => [
      isin,
      { price: d(price), currency, source: 'demo', asOf },
    ]),
  );

  return { txs: parseTransactions(raw), profile: demoProfile(), prices };
}
