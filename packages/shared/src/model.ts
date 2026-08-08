/**
 * Kanonický model transakcí (docs/03-brokeri-import.md).
 * Importéry brokerů převádějí data do tohoto modelu; engine nikdy nevidí formát brokera.
 */
import { z } from 'zod';
import { Decimal, d, ZERO } from './money';

export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum musí být ve formátu YYYY-MM-DD');

const MoneySchema = z
  .union([z.string(), z.number(), z.instanceof(Decimal)])
  .transform((v) => d(v as Decimal.Value));

const PositiveMoney = MoneySchema.refine((v) => v.gt(0), 'Hodnota musí být kladná');
const NonNegativeMoney = MoneySchema.refine((v) => v.gte(0), 'Hodnota nesmí být záporná');

const Currency = z.string().regex(/^[A-Z]{3}$/, 'Měna musí být třípísmenný ISO kód');
const Country = z.string().regex(/^[A-Z]{2}$/, 'Země musí být dvoupísmenný ISO kód');

export const AssetClassSchema = z.enum(['STOCK', 'ETF', 'BOND', 'CRYPTO', 'DERIVATIVE', 'OTHER']);
export type AssetClass = z.infer<typeof AssetClassSchema>;

export const FeeSchema = z.object({
  amount: NonNegativeMoney,
  currency: Currency,
});

const base = {
  id: z.string().min(1),
  account: z.string().optional(),
  note: z.string().optional(),
};

const tradeFields = {
  ...base,
  isin: z.string().min(1),
  ticker: z.string().optional(),
  name: z.string().optional(),
  assetClass: AssetClassSchema.default('STOCK'),
  quantity: PositiveMoney,
  pricePerShare: NonNegativeMoney,
  currency: Currency,
  fee: FeeSchema.optional(),
  tradeDate: IsoDateSchema,
  /** Datum vypořádání; pokud chybí, engine dopočte (T+1 US od 28. 5. 2024
   * a CA od 27. 5. 2024, jinak T+2; krypto T+0). */
  settlementDate: IsoDateSchema.optional(),
  /**
   * R-12f/g: způsob vypořádání derivátu. PREMIUM (opce) = cena je skutečný
   * cash tok; MARGIN (futures, CFD) = cash tok je až ROZDÍL cen při uzavření
   * (nominál pozice není příjem). U nederivátů se ignoruje.
   */
  settlementStyle: z.enum(['PREMIUM', 'MARGIN']).optional(),
};

export const BuyTxSchema = z.object({ type: z.literal('BUY'), ...tradeFields });
export const SellTxSchema = z.object({ type: z.literal('SELL'), ...tradeFields });

export const DividendTxSchema = z.object({
  type: z.literal('DIVIDEND'),
  ...base,
  isin: z.string().optional(),
  ticker: z.string().optional(),
  gross: NonNegativeMoney,
  currency: Currency,
  withholdingTax: NonNegativeMoney.default(ZERO),
  /** Země zdroje; pokud chybí, odvodí se z prefixu ISIN. */
  sourceCountry: Country.optional(),
  date: IsoDateSchema,
});

export const InterestTxSchema = z.object({
  type: z.literal('INTEREST'),
  ...base,
  amount: NonNegativeMoney,
  currency: Currency,
  /**
   * R-07f: daň sražená v zahraničí z úroku (ve stejné měně jako `amount`).
   * Bez tohoto pole se informace ztratila už v importu a zápočet z úroku
   * nešlo uplatnit vůbec — strop je ale dle čl. 11 smlouvy, ne čl. 10.
   */
  withholdingTax: NonNegativeMoney.default(ZERO),
  sourceCountry: Country.optional(),
  date: IsoDateSchema,
});

export const FeeTxSchema = z.object({
  type: z.literal('FEE'),
  ...base,
  amount: NonNegativeMoney,
  currency: Currency,
  date: IsoDateSchema,
});

export const FxConversionTxSchema = z.object({
  type: z.literal('FX_CONVERSION'),
  ...base,
  fromAmount: NonNegativeMoney,
  fromCurrency: Currency,
  toAmount: NonNegativeMoney,
  toCurrency: Currency,
  date: IsoDateSchema,
});

export const DepositTxSchema = z.object({
  type: z.literal('DEPOSIT'),
  ...base,
  amount: NonNegativeMoney,
  currency: Currency,
  date: IsoDateSchema,
});

export const WithdrawalTxSchema = z.object({
  type: z.literal('WITHDRAWAL'),
  ...base,
  amount: NonNegativeMoney,
  currency: Currency,
  date: IsoDateSchema,
});

export const CorporateActionSubtypeSchema = z.enum([
  'SPLIT',
  'ISIN_CHANGE',
  'MERGER',
  'SPINOFF',
  'DELISTING',
]);
export type CorporateActionSubtype = z.infer<typeof CorporateActionSubtypeSchema>;

/**
 * Korporátní akce je první-třídní entita (R-04): transformuje loty, u splitů/změn ISIN
 * bez resetu data nabytí. Povinnost `ratio`/`newIsin` dle podtypu validuje engine
 * (discriminatedUnion nedovoluje refine na členech).
 */
export const CorporateActionTxSchema = z.object({
  type: z.literal('CORPORATE_ACTION'),
  ...base,
  subtype: CorporateActionSubtypeSchema,
  isin: z.string().min(1),
  date: IsoDateSchema,
  /** Poměr výměny: za `from` starých kusů `to` nových (split 2:1 → from=1, to=2). */
  ratio: z.object({ from: PositiveMoney, to: PositiveMoney }).optional(),
  newIsin: z.string().optional(),
  /**
   * R-04b/c: zachovává akce datum nabytí pro časový test? Default dle podtypu
   * (SPLIT/ISIN_CHANGE ano; MERGER ano s výkladovou vlajkou; SPINOFF u nových kusů ne).
   */
  preservesAcquisitionDate: z.boolean().optional(),
  /** R-04f: podíl nabývací ceny mateřské pozice alokovaný na spin-off (0–1). */
  costFraction: MoneySchema.refine((v) => v.gte(0) && v.lte(1), 'Musí být 0–1').optional(),
});

export const TransferInTxSchema = z.object({
  type: z.literal('TRANSFER_IN'),
  ...base,
  isin: z.string().min(1),
  ticker: z.string().optional(),
  name: z.string().optional(),
  assetClass: AssetClassSchema.default('STOCK'),
  quantity: PositiveMoney,
  date: IsoDateSchema,
  /** Původní nabytí (R-04i: převod mezi brokery nepřerušuje test) — bez něj cost 0 a test od převodu. */
  acquisition: z
    .object({
      date: IsoDateSchema,
      costPerShare: NonNegativeMoney.optional(),
      currency: Currency.optional(),
    })
    .optional(),
});

export const TransferOutTxSchema = z.object({
  type: z.literal('TRANSFER_OUT'),
  ...base,
  isin: z.string().min(1),
  quantity: PositiveMoney,
  date: IsoDateSchema,
});

export const TransactionSchema = z.discriminatedUnion('type', [
  BuyTxSchema,
  SellTxSchema,
  DividendTxSchema,
  InterestTxSchema,
  FeeTxSchema,
  FxConversionTxSchema,
  DepositTxSchema,
  WithdrawalTxSchema,
  CorporateActionTxSchema,
  TransferInTxSchema,
  TransferOutTxSchema,
]);

export type Transaction = z.infer<typeof TransactionSchema>;
export type BuyTransaction = z.infer<typeof BuyTxSchema>;
export type SellTransaction = z.infer<typeof SellTxSchema>;
export type DividendTransaction = z.infer<typeof DividendTxSchema>;
export type InterestTransaction = z.infer<typeof InterestTxSchema>;
export type CorporateActionTransaction = z.infer<typeof CorporateActionTxSchema>;
export type TransferInTransaction = z.infer<typeof TransferInTxSchema>;

export const parseTransactions = (raw: unknown[]): Transaction[] =>
  raw.map((r) => TransactionSchema.parse(r));

/**
 * Daňový profil poplatníka — určuje, které limity se hlídají (R-08, R-09).
 */
export const TaxpayerProfileSchema = z.object({
  regime: z.enum(['PAUSAL', 'ZAMESTNANEC', 'OSVC', 'JINE']),
  /** R-01c/R-02f: CP v obchodním majetku (nebo do 3 let od ukončení činnosti) → žádné
   * osvobození CP (časový test ani 100k); kryptoaktiv se flag netýká. */
  hasSecuritiesInBusinessAssets: z.boolean().default(false),
  /** Informativní pro UI (kontrola sazby srážky u US dividend); engine kryje přes treaty cap. */
  w8benFiled: z.boolean().default(true),
  /** Další zdanitelné příjmy § 8–10 mimo evidované transakce (nájem…), pro hlídač 50k. */
  otherTaxableIncome8to10Czk: NonNegativeMoney.default(ZERO),
});
export type TaxpayerProfile = z.infer<typeof TaxpayerProfileSchema>;
