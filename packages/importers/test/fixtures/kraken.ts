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

/**
 * L2d-02: přírůstky a úbytky bez protistrany vedle skutečných přesunů.
 * Podle nápovědy Krakenu je `transfer` na prvním místě airdrop nebo fork;
 * tiché smí zůstat jen vyjmenované přesuny mezi peněženkami (spot ↔ staking,
 * spot ↔ futures). Aktiva i částky jsou smyšlené.
 */
export const KRAKEN_AIRDROPS = [
  KRAKEN_HEADERS_NEW,
  // ř. 2: transfer bez subtypu s kladnou částkou = airdrop nebo fork → varování
  '"LAR111-AAAAA-BBBBB1","RAR001-XYZKQ-CCCCC1","2023-02-06 08:00:00","transfer","","currency","FLR","spot / main",150.0000000000,0,150.0000000000',
  // ř. 3 a 4: subtyp airdrop u transfer i earn → varování
  '"LAR112-AAAAA-BBBBB2","RAR002-XYZKQ-CCCCC2","2023-02-07 08:00:00","transfer","airdrop","currency","SGB","spot / main",40.0000000000,0,40.0000000000',
  '"LAR113-AAAAA-BBBBB3","RAR003-XYZKQ-CCCCC3","2023-02-08 08:00:00","earn","airdrop","currency","SGB","earn / flexible",12.0000000000,0,52.0000000000',
  // ř. 5 a 6: převod pozice při stažení aktiva z nabídky (obě znaménka) → varování
  '"LAR114-AAAAA-BBBBB4","RAR004-XYZKQ-CCCCC4","2023-05-02 08:00:00","transfer","delistingconversion","currency","NANO","spot / main",-30.0000000000,0,0.0000000000',
  '"LAR115-AAAAA-BBBBB5","RAR005-XYZKQ-CCCCC5","2023-05-02 08:00:00","earn","delistingconversion","currency","XXBT","earn / flexible",0.0004000000,0,0.0004000000',
  // ř. 7–9: vyjmenované interní přesuny → tiše přeskočeno
  '"LAR116-AAAAA-BBBBB6","RAR006-XYZKQ-CCCCC6","2023-06-01 08:00:00","transfer","spottostaking","currency","ADA","spot / main",-100.0000000000,0,0.0000000000',
  '"LAR117-AAAAA-BBBBB7","RAR006-XYZKQ-CCCCC6","2023-06-01 08:00:00","transfer","stakingfromspot","currency","ADA.S","spot / main",100.0000000000,0,100.0000000000',
  '"LAR118-AAAAA-BBBBB8","RAR007-XYZKQ-CCCCC7","2023-06-02 08:00:00","transfer","spottofutures","currency","ZEUR","spot / main",-250.0000,0,0.0000',
  // ř. 10: transfer bez subtypu se zápornou částkou (odchod na jiný účet Krakenu) → tiše přeskočeno
  '"LAR119-AAAAA-BBBBB9","RAR008-XYZKQ-CCCCC8","2023-06-03 08:00:00","transfer","","currency","XXBT","spot / main",-0.0100000000,0,0.0000000000',
  // ř. 11: subtyp, který neznáme → varování (ticho je jen pro vyjmenované)
  '"LAR120-AAAAA-BBBBC1","RAR009-XYZKQ-CCCCC9","2023-06-04 08:00:00","transfer","vaultmove","currency","DOT","spot / main",7.0000000000,0,7.0000000000',
  // ř. 12: přesun uvnitř Kraken Earn → tiše přeskočeno
  '"LAR121-AAAAA-BBBBC2","RAR010-XYZKQ-CCCCD1","2023-06-05 08:00:00","earn","allocation","currency","DOT","earn / flexible",7.0000000000,0,7.0000000000',
].join('\n');

/**
 * A06-R1-03: všech šest vyjmenovaných přesunů mezi peněženkami. Každý řádek má
 * VLASTNÍ refid a krypto aktivum — jinak by ho umlčelo párování podle refid
 * (A06-R1-01) nebo fiat měna (A06-R1-02) a zkrácení výčtu by test nepoznal.
 */
export const KRAKEN_WALLET_TRANSFERS = [
  KRAKEN_HEADERS_NEW,
  '"LWT111-AAAAA-BBBBB1","RWT001-XYZKQ-CCCCC1","2023-07-03 09:00:00","transfer","spottostaking","currency","ATOM","spot / main",-20.0000000000,0,0.0000000000',
  '"LWT112-AAAAA-BBBBB2","RWT002-XYZKQ-CCCCC2","2023-07-03 09:00:00","transfer","stakingfromspot","currency","ATOM.S","spot / main",20.0000000000,0,20.0000000000',
  '"LWT113-AAAAA-BBBBB3","RWT003-XYZKQ-CCCCC3","2023-08-14 09:00:00","transfer","stakingtospot","currency","ATOM.S","spot / main",-20.0000000000,0,0.0000000000',
  '"LWT114-AAAAA-BBBBB4","RWT004-XYZKQ-CCCCC4","2023-08-14 09:00:00","transfer","spotfromstaking","currency","ATOM","spot / main",20.0000000000,0,20.0000000000',
  '"LWT115-AAAAA-BBBBB5","RWT005-XYZKQ-CCCCC5","2023-09-05 09:00:00","transfer","spottofutures","currency","XXBT","spot / main",-0.0500000000,0,0.0000000000',
  '"LWT116-AAAAA-BBBBB6","RWT006-XYZKQ-CCCCC6","2023-09-19 09:00:00","transfer","spotfromfutures","currency","XXBT","spot / main",0.0500000000,0,0.0500000000',
].join('\n');

/**
 * A06-R1-01: přesun do stakingu a zpět v exportu BEZ sloupce `subtype` (Kraken
 * pole při exportu nabízí k výběru) — dvojice řádků se společným refid, úbytek
 * a stejně velký přírůstek téhož aktiva (`.S` je tentýž titul).
 */
export const KRAKEN_STAKING_NO_SUBTYPE_COLUMN = [
  '"txid","refid","time","type","aclass","asset","amount","fee","balance"',
  '"LSN111-AAAAA-BBBBB1","RSN001-XYZKQ-CCCCC1","2022-03-04 10:00:00","transfer","currency","DOT",-10.0000000000,0,0.0000000000',
  '"LSN112-AAAAA-BBBBB2","RSN001-XYZKQ-CCCCC1","2022-03-04 10:00:00","transfer","currency","DOT.S",10.0000000000,0,10.0000000000',
  // zpět: přírůstek stojí ve výpisu PŘED úbytkem — na pořadí nesmí záležet
  '"LSN113-AAAAA-BBBBB3","RSN002-XYZKQ-CCCCC2","2022-05-09 10:00:00","transfer","currency","DOT",10.0000000000,0,10.0000000000',
  '"LSN114-AAAAA-BBBBB4","RSN002-XYZKQ-CCCCC2","2022-05-09 10:00:00","transfer","currency","DOT.S",-10.0000000000,0,0.0000000000',
].join('\n');

/**
 * A06-R1-01: řádky `transfer` bez subtypu, které se NEVYRUŠÍ — varování
 * u přírůstku musí zůstat: ř. 2–3 jiná velikost, ř. 4–5 jiné aktivum,
 * ř. 6–7 prázdný refid (ten nic nespojuje), ř. 8–10 skupina s nečitelnou částkou
 * (zbylé dva řádky by se vyrušily, ale o třetím nevíme nic), ř. 11 osamocený
 * řádek s nulovou částkou (jeden řádek není dvojice).
 */
export const KRAKEN_TRANSFERS_NOT_CANCELLING = [
  KRAKEN_HEADERS_NEW,
  '"LNC111-AAAAA-BBBBB1","RNC001-XYZKQ-CCCCC1","2022-06-01 10:00:00","transfer","","currency","ADA","spot / main",-100.0000000000,0,0.0000000000',
  '"LNC112-AAAAA-BBBBB2","RNC001-XYZKQ-CCCCC1","2022-06-01 10:00:00","transfer","","currency","ADA.S","spot / main",120.0000000000,0,120.0000000000',
  '"LNC113-AAAAA-BBBBB3","RNC002-XYZKQ-CCCCC2","2022-06-02 10:00:00","transfer","","currency","SOL","spot / main",-5.0000000000,0,0.0000000000',
  '"LNC114-AAAAA-BBBBB4","RNC002-XYZKQ-CCCCC2","2022-06-02 10:00:00","transfer","","currency","KSM","spot / main",5.0000000000,0,5.0000000000',
  '"LNC115-AAAAA-BBBBB5","","2022-06-03 10:00:00","transfer","","currency","XTZ","spot / main",-8.0000000000,0,0.0000000000',
  '"LNC116-AAAAA-BBBBB6","","2022-07-21 10:00:00","transfer","","currency","XTZ","spot / main",8.0000000000,0,8.0000000000',
  '"LNC117-AAAAA-BBBBB7","RNC004-XYZKQ-CCCCC4","2022-06-04 10:00:00","transfer","","currency","ALGO","spot / main",n/a,0,0.0000000000',
  '"LNC118-AAAAA-BBBBB8","RNC004-XYZKQ-CCCCC4","2022-06-04 10:00:00","transfer","","currency","ALGO","spot / main",30.0000000000,0,30.0000000000',
  '"LNC120-AAAAA-BBBBC1","RNC004-XYZKQ-CCCCC4","2022-06-04 10:00:00","transfer","","currency","ALGO","spot / main",-30.0000000000,0,0.0000000000',
  '"LNC119-AAAAA-BBBBB9","RNC005-XYZKQ-CCCCC5","2022-06-05 10:00:00","transfer","vaultmove","currency","NEAR","spot / main",0.0000000000,0,0.0000000000',
].join('\n');

/**
 * A06-R1-02: přesuny ve fiat měně. Peníze airdrop ani fork být nemůžou
 * a evidenci kusů pro ně nevedeme → tiché jako vklad a výběr. Výjimka je
 * `delistingconversion` (ř. 5): tam je částka výnos z nuceného převodu pozice.
 */
export const KRAKEN_FIAT_TRANSFERS = [
  KRAKEN_HEADERS_NEW,
  '"LFT111-AAAAA-BBBBB1","RFT001-XYZKQ-CCCCC1","2022-03-04 10:00:00","transfer","","currency","ZEUR","spot / main",250.0000,0,250.0000',
  '"LFT112-AAAAA-BBBBB2","RFT002-XYZKQ-CCCCC2","2022-03-05 10:00:00","transfer","airdrop","currency","USD","spot / main",5.0000,0,5.0000',
  '"LFT113-AAAAA-BBBBB3","RFT003-XYZKQ-CCCCC3","2022-03-06 10:00:00","transfer","vaultmove","currency","ZCZK","spot / main",-900.0000,0,0.0000',
  '"LFT114-AAAAA-BBBBB4","RFT004-XYZKQ-CCCCC4","2022-03-07 10:00:00","transfer","delistingconversion","currency","ZEUR","spot / main",42.0000,0,292.0000',
].join('\n');

/** Hlavička exportu, ve kterém uživatel sloupec `subtype` při stahování odškrtl. */
export const KRAKEN_HEADERS_NO_SUBTYPE =
  '"txid","refid","time","type","aclass","asset","amount","fee","balance"';

/** Řádek `transfer` v exportu bez sloupce `subtype` (A06-R2-01, A06-R2-02). */
const transferWithoutSubtype = (
  txid: string,
  refid: string,
  asset: string,
  amount: string,
): string =>
  `"${txid}","${refid}","2022-10-11 10:00:00","transfer","currency","${asset}",${amount},0,0.0000000000`;

/** Tentýž řádek v plné hlavičce — subtyp je vyplněný, nebo prázdný. */
const transferWithSubtype = (
  txid: string,
  refid: string,
  subtype: string,
  asset: string,
  amount: string,
): string =>
  `"${txid}","${refid}","2022-10-11 10:00:00","transfer","${subtype}","currency","${asset}","spot / main",${amount},0,0.0000000000`;

/**
 * A06-R2-01: nucený převod pozice při stažení aktiva z nabídky v exportu BEZ
 * sloupce `subtype`, každá noha pod vlastním refid. Bez subtypu to parser od
 * přesunu peněz a odchodu kusů na jiný účet nerozezná — nesmí ale mlčet.
 */
export const KRAKEN_DELISTING_NO_SUBTYPE_COLUMN = [
  KRAKEN_HEADERS_NO_SUBTYPE,
  transferWithoutSubtype('LDN111-AAAAA-BBBBB1', 'RDN001-XYZKQ-CCCCC1', 'NANO', '-30.0000000000'),
  transferWithoutSubtype('LDN112-AAAAA-BBBBB2', 'RDN002-XYZKQ-CCCCC2', 'ZEUR', '42.0000'),
].join('\n');

/**
 * A06-R2-01: tentýž převod se SPOLEČNÝM refid — přírůstek peněz, vedle kterého
 * ve stejné operaci ubylo kryptoaktivum, není „převod peněz“. Jednou bez
 * sloupce `subtype`, jednou s prázdným subtypem v plné hlavičce.
 */
export const KRAKEN_CONVERSION_SAME_REFID_NO_SUBTYPE_COLUMN = [
  KRAKEN_HEADERS_NO_SUBTYPE,
  transferWithoutSubtype('LCS111-AAAAA-BBBBB1', 'RCS001-XYZKQ-CCCCC1', 'NANO', '-30.0000000000'),
  transferWithoutSubtype('LCS112-AAAAA-BBBBB2', 'RCS001-XYZKQ-CCCCC1', 'ZEUR', '42.0000'),
].join('\n');

export const KRAKEN_CONVERSION_SAME_REFID = [
  KRAKEN_HEADERS_NEW,
  transferWithSubtype('LCS111-AAAAA-BBBBB1', 'RCS001-XYZKQ-CCCCC1', '', 'NANO', '-30.0000000000'),
  transferWithSubtype('LCS112-AAAAA-BBBBB2', 'RCS001-XYZKQ-CCCCC1', '', 'ZEUR', '42.0000'),
].join('\n');

/**
 * A06-R2-01: co protistranou přírůstku peněz NENÍ a musí zůstat tiché —
 * ř. 2–3 úbytek jiné fiat měny (směna měn), ř. 4–5 kryptoaktivum, které ve
 * stejné operaci taky PŘIBYLO, ř. 6–7 úbytek kryptoaktiva s prázdným refid
 * (ten nic nespojuje), ř. 8–9 peníze, které při úbytku kryptoaktiva ubyly taky.
 */
export const KRAKEN_FIAT_INFLOW_WITHOUT_COUNTERPART = [
  KRAKEN_HEADERS_NEW,
  transferWithSubtype('LFC111-AAAAA-BBBBB1', 'RFC001-XYZKQ-CCCCC1', '', 'ZUSD', '-108.0000'),
  transferWithSubtype('LFC112-AAAAA-BBBBB2', 'RFC001-XYZKQ-CCCCC1', '', 'ZEUR', '100.0000'),
  transferWithSubtype(
    'LFC113-AAAAA-BBBBB3',
    'RFC002-XYZKQ-CCCCC2',
    'airdrop',
    'SGB',
    '9.0000000000',
  ),
  transferWithSubtype('LFC114-AAAAA-BBBBB4', 'RFC002-XYZKQ-CCCCC2', '', 'ZEUR', '15.0000'),
  transferWithSubtype('LFC115-AAAAA-BBBBB5', '', '', 'XTZ', '-8.0000000000'),
  transferWithSubtype('LFC116-AAAAA-BBBBB6', '', '', 'ZEUR', '20.0000'),
  transferWithSubtype('LFC117-AAAAA-BBBBB7', 'RFC004-XYZKQ-CCCCC4', '', 'KSM', '-2.0000000000'),
  transferWithSubtype('LFC118-AAAAA-BBBBB8', 'RFC004-XYZKQ-CCCCC4', '', 'ZEUR', '-60.0000'),
].join('\n');

/**
 * A06-R2-01: řádek `earn` v exportu bez sloupce `subtype` — odměnu od přesunu
 * uvnitř Earn odliší jen subtyp.
 */
export const KRAKEN_EARN_NO_SUBTYPE_COLUMN = [
  KRAKEN_HEADERS_NO_SUBTYPE,
  '"LEN111-AAAAA-BBBBB1","REN001-XYZKQ-CCCCC1","2022-10-12 10:00:00","earn","currency","ETH",0.0030000000,0,0.0030000000',
].join('\n');

/** A06-R2-01: export bez sloupce `subtype`, ve kterém na subtypu nic nezávisí. */
export const KRAKEN_TRADE_NO_SUBTYPE_COLUMN = [
  KRAKEN_HEADERS_NO_SUBTYPE,
  '"LTN111-AAAAA-BBBBB1","FTN000-XYZKQ-CCCCC0","2022-10-10 10:00:00","deposit","currency","ZEUR",500.0000,0,500.0000',
  '"LTN112-AAAAA-BBBBB2","TTN001-XYZKQ-CCCCC1","2022-10-13 10:00:00","trade","currency","ZEUR",-300.0000,0.7800,199.2200',
  '"LTN113-AAAAA-BBBBB3","TTN001-XYZKQ-CCCCC1","2022-10-13 10:00:00","trade","currency","XXBT",0.0150000000,0,0.0150000000',
].join('\n');

/**
 * A06-R2-02: přípony, kterými Kraken odlišuje variantu téhož aktiva (staking,
 * vázaný staking s počtem dní, opt-in odměny, ochranná lhůta vkladu…).
 */
export const KRAKEN_ASSET_VARIANT_SUFFIXES = [
  '.S',
  '28.S',
  '.M',
  '.P',
  '.HOLD',
  '.CORE',
  '.INK',
] as const;

/** A06-R2-02: přesun do varianty aktiva a zpět v exportu bez sloupce `subtype`. */
export const krakenVariantTransfer = (suffix: string): string =>
  [
    KRAKEN_HEADERS_NO_SUBTYPE,
    transferWithoutSubtype('LVT111-AAAAA-BBBBB1', 'RVT001-XYZKQ-CCCCC1', 'DOT', '-10.0000000000'),
    transferWithoutSubtype(
      'LVT112-AAAAA-BBBBB2',
      'RVT001-XYZKQ-CCCCC1',
      `DOT${suffix}`,
      '10.0000000000',
    ),
    // interní kód na jedné straně, přípona na druhé
    transferWithoutSubtype(
      'LVT113-AAAAA-BBBBB3',
      'RVT002-XYZKQ-CCCCC2',
      `XBT${suffix}`,
      '-0.5000000000',
    ),
    transferWithoutSubtype('LVT114-AAAAA-BBBBB4', 'RVT002-XYZKQ-CCCCC2', 'XXBT', '0.5000000000'),
  ].join('\n');

/**
 * A06-R2-02: peníze vedené s příponou — ř. 2 osamocený přírůstek (vklad
 * v ochranné lhůtě), ř. 3–4 přesun mezi peněženkami, ř. 5 interní kód s příponou.
 */
export const KRAKEN_FIAT_VARIANT_TRANSFERS = [
  KRAKEN_HEADERS_NEW,
  transferWithSubtype('LFV111-AAAAA-BBBBB1', 'RFV001-XYZKQ-CCCCC1', '', 'EUR.HOLD', '250.0000'),
  transferWithSubtype('LFV112-AAAAA-BBBBB2', 'RFV002-XYZKQ-CCCCC2', '', 'ZUSD', '-100.0000'),
  transferWithSubtype('LFV113-AAAAA-BBBBB3', 'RFV002-XYZKQ-CCCCC2', '', 'USD.M', '100.0000'),
  transferWithSubtype('LFV114-AAAAA-BBBBB4', 'RFV003-XYZKQ-CCCCC3', '', 'ZEUR.HOLD', '75.0000'),
].join('\n');

/**
 * A06-R2-03: dvojice se společným refid a subtypem, který neznáme — vyruší se,
 * takže je to přesun mezi peněženkami, ať ve sloupci subtypu stojí cokoli.
 */
export const KRAKEN_UNKNOWN_SUBTYPE_PAIR = [
  KRAKEN_HEADERS_NEW,
  transferWithSubtype(
    'LUS111-AAAAA-BBBBB1',
    'RUS001-XYZKQ-CCCCC1',
    'vaultmove',
    'NEAR',
    '-7.0000000000',
  ),
  transferWithSubtype(
    'LUS112-AAAAA-BBBBB2',
    'RUS001-XYZKQ-CCCCC1',
    'vaultmove',
    'NEAR',
    '7.0000000000',
  ),
].join('\n');

/**
 * A06-R1-04: množství pod 0,000001 (Kraken píše krypto na deset desetinných
 * míst) — airdrop a poplatek na samostatném řádku.
 */
export const KRAKEN_TINY_AMOUNTS = [
  KRAKEN_HEADERS_NEW,
  '"LTA111-AAAAA-BBBBB1","RTA001-XYZKQ-CCCCC1","2022-03-04 10:00:00","transfer","airdrop","currency","XXBT","spot / main",0.0000002000,0,0.0000002000',
  '"LTA112-AAAAA-BBBBB2","TTA002-XYZKQ-CCCCC2","2022-03-04 10:00:00","trade","","currency","ZEUR","spot / main",-600.0000,0,400.0000',
  '"LTA113-AAAAA-BBBBB3","TTA002-XYZKQ-CCCCC2","2022-03-04 10:00:00","trade","","currency","XXBT","spot / main",0.0300000000,0,0.0300002000',
  '"LTA114-AAAAA-BBBBB4","TTA002-XYZKQ-CCCCC2","2022-03-04 10:00:00","trade","","currency","XETH","spot / main",0.0000000000,0.0000005000,0.0000000000',
].join('\n');

/**
 * L2d-06: obchod s poplatkem z kreditů KFEE — třetí řádek se stejným refid,
 * částka 0 a poplatek v jiném aktivu. Řádek není noha směny.
 */
export const KRAKEN_KFEE_TRADE = [
  KRAKEN_HEADERS_NEW,
  '"LKF111-AAAAA-BBBBB1","TKF001-XYZKQ-CCCCC1","2022-09-12 10:00:00","trade","","currency","ZEUR","spot / main",-600.0000,0,400.0000',
  '"LKF112-AAAAA-BBBBB2","TKF001-XYZKQ-CCCCC1","2022-09-12 10:00:00","trade","","currency","XXBT","spot / main",0.0300000000,0,0.0300000000',
  '"LKF113-AAAAA-BBBBB3","TKF001-XYZKQ-CCCCC1","2022-09-12 10:00:00","trade","","currency","KFEE","spot / main",0.00,156.00,844.00',
].join('\n');

/** Tentýž obchod, řádek poplatku je ve skupině první — na pořadí nesmí záležet. */
export const KRAKEN_KFEE_TRADE_FEE_FIRST = (() => {
  const [header, fiat, crypto, fee] = KRAKEN_KFEE_TRADE.split('\n');
  return [header, fee, fiat, crypto].join('\n');
})();

/**
 * A06-R1-03: třetí řádek má nulovou částku, ale poplatek ŽÁDNÝ — to není řádek
 * poplatku, ale třetí noha, a se třemi nohami si obchod nespárujeme.
 */
export const KRAKEN_ZERO_LEG_WITHOUT_FEE = KRAKEN_KFEE_TRADE.replace(
  '"KFEE","spot / main",0.00,156.00,844.00',
  '"KFEE","spot / main",0.00,0.00,844.00',
);

/**
 * L2d-04: tytéž obchody ve starším zápisu s interními kódy Krakenu (XETC, XREP,
 * XMLN, ZEUR) a v novějším s běžnými symboly — txid, časy i částky shodné.
 */
const internalCodeTrades = (codes: {
  etc: string;
  rep: string;
  mln: string;
  eur: string;
}): string =>
  [
    KRAKEN_HEADERS_OLD,
    // BUY 20 ETC za 200 EUR
    `"LIC111-AAAAA-BBBBB1","TIC001-XYZKQ-CCCCC1","2021-02-01 10:00:00","trade","","currency","${codes.eur}",-200.0000,0.5200,800.0000`,
    `"LIC112-AAAAA-BBBBB2","TIC001-XYZKQ-CCCCC1","2021-02-01 10:00:00","trade","","currency","${codes.etc}",20.0000000000,0,20.0000000000`,
    // SELL 5 REP za 90 EUR
    `"LIC113-AAAAA-BBBBB3","TIC002-XYZKQ-CCCCC2","2021-03-01 10:00:00","trade","","currency","${codes.rep}",-5.0000000000,0,0.0000000000`,
    `"LIC114-AAAAA-BBBBB4","TIC002-XYZKQ-CCCCC2","2021-03-01 10:00:00","trade","","currency","${codes.eur}",90.0000,0.2300,889.7700`,
    // BUY 2 MLN za 70 EUR
    `"LIC115-AAAAA-BBBBB5","TIC003-XYZKQ-CCCCC3","2021-04-01 10:00:00","trade","","currency","${codes.eur}",-70.0000,0.1800,819.5900`,
    `"LIC116-AAAAA-BBBBB6","TIC003-XYZKQ-CCCCC3","2021-04-01 10:00:00","trade","","currency","${codes.mln}",2.0000000000,0,2.0000000000`,
  ].join('\n');

export const KRAKEN_INTERNAL_CODES_OLD = internalCodeTrades({
  etc: 'XETC',
  rep: 'XREP',
  mln: 'XMLN',
  eur: 'ZEUR',
});

export const KRAKEN_INTERNAL_CODES_NEW = internalCodeTrades({
  etc: 'ETC',
  rep: 'REP',
  mln: 'MLN',
  eur: 'EUR',
});

/** L2d-04: nákupy BTC za zloté, švédské a dánské koruny s interním kódem fiat měny. */
export const KRAKEN_INTERNAL_FIAT_CODES = [
  KRAKEN_HEADERS_NEW,
  '"LIF111-AAAAA-BBBBB1","TIF001-XYZKQ-CCCCC1","2022-02-01 10:00:00","trade","","currency","ZPLN","spot / main",-2000.0000,5.2000,3000.0000',
  '"LIF112-AAAAA-BBBBB2","TIF001-XYZKQ-CCCCC1","2022-02-01 10:00:00","trade","","currency","XXBT","spot / main",0.0100000000,0,0.0100000000',
  '"LIF113-AAAAA-BBBBB3","TIF002-XYZKQ-CCCCC2","2022-02-02 10:00:00","trade","","currency","ZSEK","spot / main",-3000.0000,7.8000,1000.0000',
  '"LIF114-AAAAA-BBBBB4","TIF002-XYZKQ-CCCCC2","2022-02-02 10:00:00","trade","","currency","XXBT","spot / main",0.0100000000,0,0.0200000000',
  '"LIF115-AAAAA-BBBBB5","TIF003-XYZKQ-CCCCC3","2022-02-03 10:00:00","trade","","currency","ZDKK","spot / main",-2500.0000,6.5000,500.0000',
  '"LIF116-AAAAA-BBBBB6","TIF003-XYZKQ-CCCCC3","2022-02-03 10:00:00","trade","","currency","XXBT","spot / main",0.0100000000,0,0.0300000000',
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
