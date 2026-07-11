/**
 * Fixtures Kraken ledgers.csv — hlavičky i tvar řádků PŘESNĚ podle reálných
 * exportů (všechna pole v uvozovkách, čísla s desetinnou tečkou, čas UTC).
 * Novější generace má navíc sloupec `wallet` (za asset), starší je bez něj.
 */

export const KRAKEN_HEADERS_NEW =
  '"txid","refid","time","type","subtype","aclass","asset","wallet","amount","fee","balance"';

export const KRAKEN_HEADERS_OLD =
  '"txid","refid","time","type","subtype","aclass","asset","amount","fee","balance"';

/** Happy path: BUY pár, SELL pár, spend+receive (karta), vklad, výběr, staking. */
export const KRAKEN_LEDGERS_NEW = [
  KRAKEN_HEADERS_NEW,
  // vklad EUR → skipped
  '"L4UESK-KG3EQ-UFO4T5","FTQcuQ-V143K-VNFZE3","2024-01-05 12:00:00","deposit","","currency","ZEUR","spot / main",1000.0000,0,1000.0000',
  // BUY pár: -100 EUR (poplatek 0.18 EUR) → +0.002 BTC
  '"LFTGXD-RWVPJ-J645GJ","TA4RTP-4TUW5-G5DGTA","2024-03-19 19:43:31","trade","","currency","ZEUR","spot / main",-100.0000,0.1800,899.8200',
  '"LS4N2A-5DK5R-DRB7ZL","TA4RTP-4TUW5-G5DGTA","2024-03-19 19:43:31","trade","","currency","XXBT","spot / main",0.0020000000,0,0.0020000000',
  // SELL pár: -1 LTC → +80 EUR (poplatek 0.20 EUR)
  '"LWXHDF-MB4N7-DPQXVJ","TBK6HW-37GRP-AAHXTQ","2024-04-02 10:15:00","trade","","currency","XLTC","spot / main",-1.0000000000,0,0.0772481500',
  '"LN2FQP-GH5DK-2WCPXR","TBK6HW-37GRP-AAHXTQ","2024-04-02 10:15:00","trade","","currency","ZEUR","spot / main",80.0000,0.2000,979.6200',
  // nákup kartou = pár spend+receive: -50 EUR → +0.001 BTC
  '"LHK3M2-QWERT-YUIOP1","QCCTL7-KDIRA-EPMPGE","2024-05-01 08:00:00","spend","","currency","ZEUR","spot / main",-50.0000,0,929.6200',
  '"LPO9I8-ASDFG-HJKLM2","QCCTL7-KDIRA-EPMPGE","2024-05-01 08:00:00","receive","","currency","XXBT","spot / main",0.0010000000,0,0.0030000000',
  // staking odměna (staked asset ADA.S) → warning + skip
  '"LSTAK1-AAAAA-BBBBB1","STVXPB-XZDKB-QGCFTM","2024-06-01 01:00:00","staking","","currency","ADA.S","earn / bonded",5.0000000000,0,105.0000000000',
  // výběr LTC (s poplatkem sítě) → skipped
  '"LEMCZY-4QN7D-AHHLOF","FTS9z1b-zVNdUE1trYlXT8OWPvPcWf","2024-06-10 09:00:00","withdrawal","","currency","XLTC","spot / main",-0.9212000000,0.0020000000,0.1540481500',
].join('\n');

/** Starší hlavička bez wallet, assety bez prefixů, čas se zlomky sekund. */
export const KRAKEN_LEDGERS_OLD = [
  KRAKEN_HEADERS_OLD,
  '"LOLD11-EUREU-AAAAA1","TOLD01-XYZKQ-BBBBB1","2023-01-15 09:30:00.1234","trade","","currency","EUR",-200.00,0.32,500.00',
  '"LOLD12-BTCBT-AAAAA2","TOLD01-XYZKQ-BBBBB1","2023-01-15 09:30:00.1234","trade","","currency","BTC",0.0100000000,0,0.0100000000',
].join('\n');

/** Směna krypto–krypto (BTC → ETH) — bez fiat protihodnoty → warning + skip. */
export const KRAKEN_CRYPTO_CRYPTO = [
  KRAKEN_HEADERS_NEW,
  '"LCC111-AAAAA-BBBBB1","TCC001-XYZKQ-CCCCC1","2024-02-01 11:00:00","trade","","currency","XXBT","spot / main",-0.0050000000,0,0.0100000000',
  '"LCC112-AAAAA-BBBBB2","TCC001-XYZKQ-CCCCC1","2024-02-01 11:00:00","trade","","currency","XETH","spot / main",0.1000000000,0.0001000000,0.1000000000',
].join('\n');

/** BUY pár s poplatkem na KRYPTO noze (0.00001 BTC) → warning, poplatek se ignoruje. */
export const KRAKEN_CRYPTO_FEE = [
  KRAKEN_HEADERS_NEW,
  '"LCF111-AAAAA-BBBBB1","TCF001-XYZKQ-CCCCC1","2024-02-02 11:00:00","trade","","currency","ZEUR","spot / main",-100.0000,0,400.0000',
  '"LCF112-AAAAA-BBBBB2","TCF001-XYZKQ-CCCCC1","2024-02-02 11:00:00","trade","","currency","XXBT","spot / main",0.0020000000,0.0000100000,0.0020000000',
].join('\n');

/** Fiat–fiat pár (ZEUR → ZUSD) = FX konverze → skipped. */
export const KRAKEN_FIAT_FIAT = [
  KRAKEN_HEADERS_NEW,
  '"LFX111-AAAAA-BBBBB1","TFX001-XYZKQ-CCCCC1","2024-03-05 10:00:00","trade","","currency","ZEUR","spot / main",-100.0000,0,300.0000',
  '"LFX112-AAAAA-BBBBB2","TFX001-XYZKQ-CCCCC1","2024-03-05 10:00:00","trade","","currency","ZUSD","spot / main",108.0000,0.1500,108.0000',
].join('\n');

/** Nespárovaný trade řádek (chybí druhá strana směny) → error s číslem řádku. */
export const KRAKEN_UNPAIRED = [
  KRAKEN_HEADERS_NEW,
  '"LUP111-AAAAA-BBBBB1","TUP001-XYZKQ-CCCCC1","2024-03-10 10:00:00","trade","","currency","XXBT","spot / main",-0.0010000000,0,0.0090000000',
].join('\n');

/** Marginové řádky → warning + skip. */
export const KRAKEN_MARGIN = [
  KRAKEN_HEADERS_NEW,
  '"LMG111-AAAAA-BBBBB1","TMG001-XYZKQ-CCCCC1","2024-04-15 14:00:00","margin trade","","currency","XXBT","spot / main",0.0100000000,0.0000200000,0.0200000000',
  '"LRO111-AAAAA-BBBBB2","TMG001-XYZKQ-CCCCC2","2024-04-16 14:00:00","rollover","","currency","ZUSD","spot / main",0,0.5000,150.0000',
].join('\n');

/** Ostatní typy: earn reward (warning), earn allocation + transfer (skipped), adjustment (warning). */
export const KRAKEN_MISC_TYPES = [
  KRAKEN_HEADERS_NEW,
  '"LER111-AAAAA-BBBBB1","ELCCZM-AAAAA-CCCCC1","2024-03-01 00:00:00","earn","reward","currency","ETH","earn / bonded",0.0010000000,0,0.5010000000',
  '"LEA111-AAAAA-BBBBB2","ELALLO-AAAAA-CCCCC2","2024-03-02 00:00:00","earn","allocation","currency","ETH","earn / bonded",0.5000000000,0,0.5000000000',
  '"LTR111-AAAAA-BBBBB3","RTFVVK-AAAAA-CCCCC3","2024-03-03 00:00:00","transfer","spottostaking","currency","ADA","spot / main",-100.0000000000,0,0.0000000000',
  '"LAD111-AAAAA-BBBBB4","ADJST1-AAAAA-CCCCC4","2024-03-04 00:00:00","adjustment","","currency","XXDG","spot / main",1.0000000000,0,1.0000000000',
].join('\n');

/** Pár s nesmyslným kalendářním datem → error, ne tichý posun. */
export const KRAKEN_BAD_DATE = [
  KRAKEN_HEADERS_NEW,
  '"LBD111-AAAAA-BBBBB1","TBD001-XYZKQ-CCCCC1","2024-13-40 10:00:00","trade","","currency","ZEUR","spot / main",-10.0000,0,90.0000',
  '"LBD112-AAAAA-BBBBB2","TBD001-XYZKQ-CCCCC1","2024-13-40 10:00:00","trade","","currency","XXBT","spot / main",0.0002000000,0,0.0002000000',
].join('\n');

/** trades.csv (exekuce bez vkladů/výběrů) — parser ho musí odmítnout. */
export const KRAKEN_TRADES_CSV = [
  '"txid","ordertxid","pair","time","type","ordertype","price","cost","fee","vol","margin","misc","ledgers"',
  '"TDNN5P-YWGRO-YF32BH","OS6ZQP-JLQZV-8QW9K2","XXBTZEUR","2024-03-19 19:43:31.6798","buy","limit",54054.0,100.00,0.18,0.00185,0.00000,"","LFTGXD-RWVPJ-J645GJ,LS4N2A-5DK5R-DRB7ZL"',
].join('\n');

/** Hlavička Trading212 exportu — protipříklad pro sniff (nesmí být false positive). */
export const T212_HEADER_SAMPLE =
  'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID,Currency conversion fee,Currency (Currency conversion fee)';
