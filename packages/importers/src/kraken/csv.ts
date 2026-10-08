import { d, type Decimal, TransactionSchema } from '@danero/shared';
import { FIAT_CURRENCIES, HeaderMap, isValidIsoDate, normalizeHeader, parseCsv } from '../csv';
import { fnv1a64 } from '../dedupe';
import { emptyResult, type ImportResult } from '../types';

export const KRAKEN_BROKER = 'kraken';

/**
 * Parser Kraken ledgers.csv — kompletní účetní kniha účtu (obchody, vklady,
 * výběry, staking). Hlavičky se mezi generacemi exportu liší (novější přidávají
 * `wallet`, `subclass`, `amountusd`) → mapování VÝHRADNĚ podle názvů sloupců.
 * Obchod = PÁR řádků `type=trade` se stejným `refid` (jeden asset −, druhý +);
 * nákup kartou = pár `spend`+`receive`. trades.csv se odmítá — neobsahuje
 * vklady/výběry a vedl by ke dvojímu započtení vedle ledgers.
 */

/* ── Normalizace assetů ──────────────────────────────────────────────────── */

/**
 * Kraken interní kódy: fiat s prefixem `Z` (ZEUR), krypto s prefixem `X`
 * (XXBT = BTC!), staked se sufixem `.S` (ADA.S). Novější exporty píší kódy
 * rovnou (BTC, EUR) — mapa proto obsahuje jen známé aliasy, ostatní projdou beze změny.
 *
 * ⚠️ Mapa je VÝČET, prefix se neodřezává: ZCHF vede Kraken jako jiné aktivum
 * než fiat CHF a XTZ nebo ZRX jsou běžné symboly. Kód, který tu chybí, dá
 * témuž obchodu podle generace exportu jiný symbol i dedupe klíč (obchod se
 * při nahrání staršího a novějšího exportu uloží dvakrát) a u fiat měny udělá
 * z nákupu „směnu krypto–krypto“ (L2d-04: XETC, XREP, XMLN, ZPLN, ZSEK, ZDKK).
 */
const ASSET_ALIASES: Record<string, string> = {
  XXBT: 'BTC',
  XBT: 'BTC',
  XETH: 'ETH',
  XETC: 'ETC',
  XXRP: 'XRP',
  XLTC: 'LTC',
  XXLM: 'XLM',
  XZEC: 'ZEC',
  XXMR: 'XMR',
  XREP: 'REP',
  XMLN: 'MLN',
  XXDG: 'DOGE',
  XDG: 'DOGE',
  ZEUR: 'EUR',
  ZUSD: 'USD',
  ZGBP: 'GBP',
  ZCAD: 'CAD',
  ZJPY: 'JPY',
  ZAUD: 'AUD',
  ZCZK: 'CZK',
  ZPLN: 'PLN',
  ZSEK: 'SEK',
  ZDKK: 'DKK',
};

export function normalizeKrakenAsset(asset: string): string {
  let code = asset.trim().toUpperCase();
  // staked varianta (ADA.S) je pro daňové účely tentýž asset
  if (code.endsWith('.S')) code = code.slice(0, -2);
  return ASSET_ALIASES[code] ?? code;
}

// Fiat poznáváme whitelistem ISO kódů (sdílený FIAT_CURRENCIES), NE prefixem —
// „EUR“ se vyskytuje i bez Z.

/* ── Čísla a datumy ──────────────────────────────────────────────────────── */

/** Kraken čísla: čistě desetinná tečka, bez tisícových oddělovačů. */
function parseKrakenNumber(value: string): string | null {
  const v = value.replace(/\s/g, '');
  if (v === '') return null;
  return /^-?\d+(\.\d+)?$/.test(v) ? v : null;
}

/**
 * Množství do hlášky: desetinný zápis bez koncových nul. `toString()` píše
 * hodnoty pod 0,000001 vědecky („2e-7 BTC“) a Kraken vede krypto na deset
 * desetinných míst — uživatel má přitom číslo opsat do šablony (A06-R1-04).
 */
const plainNumber = (value: string): string => d(value).toFixed();

/** Čas `YYYY-MM-DD HH:MM:SS` (+ volitelné zlomky), UTC → ISO datum. */
function toIsoDate(time: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T]|$)/.exec(time.trim());
  const iso = match ? match[1]! : null;
  return iso !== null && isValidIsoDate(iso) ? iso : null;
}

/* ── Sniff ───────────────────────────────────────────────────────────────── */

const firstLine = (text: string): string => {
  const newline = text.indexOf('\n');
  return newline === -1 ? text : text.slice(0, newline);
};

/** Sloupce, bez kterých se ledgers.csv přečíst NEDÁ — sdílí je sniffer i parser. */
const REQUIRED_HEADERS = ['txid', 'refid', 'time', 'type', 'asset', 'amount'] as const;

/**
 * Detekce Kraken exportů podle hlavičky: ledgers.csv (sloupce, které vyžaduje
 * parser) i trades.csv (txid + ordertxid + pair) — trades parser odmítne se
 * srozumitelnou hláškou, nesmí ale propadnout do univerzální šablony.
 *
 * ⚠️ Sniffer je PODMNOŽINA toho, co vyžaduje parser (pravidlo z CLAUDE.md).
 * Do 23. 8. 2026 tu navíc stálo `aclass` a `balance`, která parser NIKDY nečte
 * (všechny tři výskyty byly ve snifferu). Soubor bez nich se dal přečíst
 * — 1 transakce, 0 chyb — ale sniffer ho odmítl a protože Kraken má sloupec
 * doslova `type`, propadl až na univerzální šablonu (nález K7b-01).
 */
export function sniffKrakenCsv(text: string): boolean {
  if (text.trim() === '') return false;
  const headers = new Set(parseCsv(firstLine(text)).headers.map(normalizeHeader));
  const ledgers = REQUIRED_HEADERS.every((column) => headers.has(column));
  const trades = headers.has('txid') && headers.has('ordertxid') && headers.has('pair');
  return ledgers || trades;
}

/* ── Parser ──────────────────────────────────────────────────────────────── */

/**
 * Přesuny mezi peněženkami téhož účtu (spot ↔ staking, spot ↔ futures) — jediné
 * subtypy řádku `transfer`, které smí zmizet beze slova. Výčet podle nápovědy
 * Krakenu („Explanation of Ledger Fields“).
 */
const INTERNAL_TRANSFER_SUBTYPES = new Set([
  'spottostaking',
  'stakingfromspot',
  'stakingtospot',
  'spotfromstaking',
  'spottofutures',
  'spotfromfutures',
]);

/**
 * Varování k pohybu kusů bez protistrany (L2d-02). Podle nápovědy Krakenu je
 * `transfer` na prvním místě připsání airdropu nebo forku; do 9. 10. 2026 tu
 * takový řádek končil jako „interní přesun — ne daňová událost“ mezi
 * přeskočenými, u kterých UI ukazuje jen počet. Pozdější prodej pak narazil na
 * „prodáno víc, než je evidováno“ s radou nahrát kompletní historii — která
 * kompletní byla.
 *
 * Text je PODMÍNĚNÝ (stejně vypadá i převod z jiného účtu u Krakenu) a ZÁMĚRNĚ
 * neříká, jakou cenu zadat: pravidlo pro airdropy v docs/02 není.
 */
function unmatchedMovementWarning(
  type: string,
  subtype: string,
  asset: string,
  amount: string | null,
): string {
  const label = subtype === '' ? type : `${type} / ${subtype}`;
  const movement = `${amount === null ? '' : `${plainNumber(amount)} `}${asset}`;
  if (subtype === 'delistingconversion') {
    return (
      `Řádek „${label}“ (${movement}): převod pozice při stažení aktiva z nabídky Krakenu jsme do evidence nezařadili — řádek přeskočen. ` +
      'Pohyb kusů doplň přes univerzální šablonu, jinak nebude sedět počet kusů ani nabývací cena při pozdějším prodeji.'
    );
  }
  if ((subtype === '' || subtype === 'airdrop') && amount !== null && d(amount).gt(0)) {
    return (
      `Připsání ${movement} bez protistrany („${label}“) jsme do evidence nezařadili — řádek přeskočen. ` +
      'Pokud jde o airdrop nebo fork, je to nabytí bez úplaty (kusy jsi dostal zdarma): doplň ho přes univerzální šablonu, ' +
      'jinak se prodej těchto kusů spočítá s nulovou nabývací cenou a bez časového testu.'
    );
  }
  return (
    `Řádek „${label}“ (${movement}) neumíme zařadit — řádek přeskočen. ` +
    'Pokud jím kusy přibyly nebo ubyly, doplň to přes univerzální šablonu.'
  );
}

/** Klíč skupiny řádků `transfer`: stejný refid a stejné aktivum po normalizaci. */
const transferGroupKey = (refid: string, asset: string): string => `${refid}|${asset}`;

/**
 * Skupiny řádků `transfer`, které se uvnitř téhož aktiva vyruší na nulu
 * (A06-R1-01): stejný refid, aspoň dva řádky, všechny částky čitelné a součet 0.
 * To je přesun mezi peněženkami bez ohledu na to, co stojí ve sloupci `subtype`
 * — ten jde při exportu odškrtnout a parser soubor bez něj přijímá. `.S` je po
 * normalizaci tentýž titul, takže −10 DOT a +10 DOT.S se vyruší.
 *
 * Prázdný refid nic nespojuje (stejná opatrnost jako u noh obchodu níž):
 * slepil by nesouvisející řádky z různých měsíců.
 */
function findCancellingTransfers(rows: string[][], map: HeaderMap): Set<string> {
  const groups = new Map<string, { count: number; sum: Decimal | null }>();
  for (const row of rows) {
    if (map.get(row, 'type').toLowerCase() !== 'transfer') continue;
    const refid = map.get(row, 'refid');
    if (refid === '') continue;
    const key = transferGroupKey(refid, normalizeKrakenAsset(map.get(row, 'asset')));
    const group = groups.get(key) ?? { count: 0, sum: d(0) };
    const amount = parseKrakenNumber(map.get(row, 'amount'));
    group.count += 1;
    // nečitelná částka = o skupině nevíme nic → rozhodne se po řádcích jako dřív
    group.sum = amount === null || group.sum === null ? null : group.sum.plus(amount);
    groups.set(key, group);
  }
  const cancelling = new Set<string>();
  for (const [key, group] of groups) {
    if (group.count >= 2 && group.sum !== null && group.sum.eq(0)) cancelling.add(key);
  }
  return cancelling;
}

/** Jedna noha obchodu (řádek type=trade / spend / receive) čekající na spárování. */
interface TradeLeg {
  line: number;
  txid: string;
  time: string;
  asset: string;
  amountRaw: string;
  feeRaw: string;
  raw: string;
}

export function parseKrakenCsv(text: string): ImportResult {
  const result = emptyResult(KRAKEN_BROKER);
  // prázdný soubor = prázdné období, ne chyba formátu (konzistentně s T212)
  if (text.trim() === '') return result;

  const { headers: rawHeaders, rows } = parseCsv(text);
  const headers = rawHeaders.map(normalizeHeader);
  const headerSet = new Set(headers);

  // trades.csv (txid,ordertxid,pair,…) vedle ledgers = dvojí započtení → odmítnout
  if (headerSet.has('ordertxid') && headerSet.has('pair')) {
    result.errors.push({
      line: 1,
      message:
        'Nahraj prosím export Ledgers (ledgers.csv) — obsahuje kompletní historii včetně vkladů; trades.csv by vedl ke dvojímu započtení.',
    });
    return result;
  }

  const map = new HeaderMap(headers);
  for (const required of REQUIRED_HEADERS) {
    if (!map.has(required)) {
      result.errors.push({
        line: 1,
        message: `Soubor nevypadá jako Kraken ledgers.csv — chybí sloupec „${required}“. Nalezené sloupce: ${rawHeaders.filter((h) => h !== '').join(', ')}`,
      });
      return result;
    }
  }

  // obchodní páry sbíráme podle refid, ostatní typy vyřizujeme rovnou
  const tradeGroups = new Map<string, TradeLeg[]>();
  const cancellingTransfers = findCancellingTransfers(rows, map);

  rows.forEach((row, rowIndex) => {
    const line = rowIndex + 2; // 1 = hlavička
    if (row.every((cell) => cell.trim() === '')) return;

    const type = map.get(row, 'type').toLowerCase();
    const subtype = map.get(row, 'subtype').toLowerCase();
    const asset = normalizeKrakenAsset(map.get(row, 'asset'));
    const raw = row.join(',');

    switch (type) {
      case 'trade':
      case 'spend':
      case 'receive': {
        const refid = map.get(row, 'refid');
        const legs = tradeGroups.get(refid) ?? [];
        legs.push({
          line,
          txid: map.get(row, 'txid'),
          time: map.get(row, 'time'),
          asset: map.get(row, 'asset'),
          amountRaw: map.get(row, 'amount'),
          feeRaw: map.get(row, 'fee'),
          raw,
        });
        tradeGroups.set(refid, legs);
        return;
      }
      case 'deposit':
      case 'withdrawal':
        result.skipped.push({
          line,
          message: `${type === 'deposit' ? 'Vklad' : 'Výběr'} ${asset} — převod peněz či kryptoaktiv, ne zdanitelná událost.`,
        });
        return;
      case 'staking':
        result.warnings.push({
          line,
          message: `Odměna ze stakingu (${asset}) — odměny ze stakingu zatím daňově nezařazujeme, řádek přeskočen.`,
          raw,
        });
        return;
      case 'earn':
        if (subtype === 'reward') {
          result.warnings.push({
            line,
            message: `Odměna z Kraken Earn (${asset}) — odměny ze stakingu zatím daňově nezařazujeme, řádek přeskočen.`,
            raw,
          });
        } else if (subtype === 'airdrop' || subtype === 'delistingconversion') {
          // L2d-02: kusy přibyly (nebo ubyly) bez protistrany — to není přesun
          result.warnings.push({
            line,
            message: unmatchedMovementWarning(
              type,
              subtype,
              asset,
              parseKrakenNumber(map.get(row, 'amount')),
            ),
            raw,
          });
        } else {
          // allocation/deallocation/migration… = přesun v rámci účtu, ne daňová událost
          result.skipped.push({
            line,
            message: `Přesun v rámci Kraken Earn (${subtype || 'bez subtypu'}, ${asset}) — ne daňová událost.`,
          });
        }
        return;
      case 'transfer': {
        const amount = parseKrakenNumber(map.get(row, 'amount'));
        // A06-R1-02: peníze airdrop ani fork být nemůžou a evidenci kusů pro ně
        // nevedeme → tiše jako vklad a výběr. Výjimka je `delistingconversion`:
        // tam je částka výnos z nuceného převodu pozice a varování je jediné
        // místo, kde ji uživatel uvidí.
        if (FIAT_CURRENCIES.has(asset) && subtype !== 'delistingconversion') {
          result.skipped.push({
            line,
            message: `Přesun ${asset} (${subtype || 'transfer'}) — převod peněz, ne zdanitelná událost.`,
          });
          return;
        }
        // Tiché jsou jen vyjmenované přesuny mezi peněženkami, dvojice, která
        // se ve stejném refid vyruší (A06-R1-01), a úbytek bez subtypu (odchod
        // na jiný účet u Krakenu). Přírůstek bez subtypu, který protějšek
        // opravdu nemá, je podle nápovědy Krakenu nejspíš airdrop nebo fork
        // → varování (L2d-02).
        const cancelsWithinRefid = cancellingTransfers.has(
          transferGroupKey(map.get(row, 'refid'), asset),
        );
        const outgoingWithoutSubtype = subtype === '' && amount !== null && !d(amount).gt(0);
        if (
          INTERNAL_TRANSFER_SUBTYPES.has(subtype) ||
          cancelsWithinRefid ||
          outgoingWithoutSubtype
        ) {
          result.skipped.push({
            line,
            message: `Interní přesun (${subtype || 'transfer'}, ${asset}) — ne daňová událost.`,
          });
        } else {
          result.warnings.push({
            line,
            message: unmatchedMovementWarning(type, subtype, asset, amount),
            raw,
          });
        }
        return;
      }
      case 'margin':
      case 'margin trade':
      case 'rollover':
      case 'settled':
        result.warnings.push({
          line,
          message: `Řádek „${type}“: marginové obchody na Krakenu zatím nepodporujeme — řádek přeskočen, výsledek doplň přes univerzální šablonu.`,
          raw,
        });
        return;
      default:
        result.warnings.push({
          line,
          message: `Typ záznamu „${map.get(row, 'type')}“ zatím nepodporujeme — řádek přeskočen. Pokud jde o zdanitelnou událost, doplň ji přes univerzální šablonu.`,
          raw,
        });
        return;
    }
  });

  // druhý průchod: párování obchodů podle refid
  for (const [refid, allLegs] of tradeGroups) {
    // L2d-06: řádek s nulovou částkou a poplatkem není noha směny, ale poplatek
    // účtovaný zvlášť v jiném aktivu (typicky kredity KFEE). Dokud se počítal
    // mezi nohy, kontrola „právě dvě“ odmítla celý obchod s radou stáhnout
    // kompletní export — který kompletní byl. Do výpočtu ho nezahrnujeme
    // (kredity ocenit neumíme) → varování, stejně jako u poplatku na krypto
    // noze níž. Řádek s nulovou částkou BEZ poplatku nohou zůstává.
    const legs: TradeLeg[] = [];
    for (const leg of allLegs) {
      const amount = parseKrakenNumber(leg.amountRaw);
      const fee = parseKrakenNumber(leg.feeRaw);
      if (amount === null || fee === null || !d(amount).eq(0) || d(fee).eq(0)) {
        legs.push(leg);
        continue;
      }
      const feeAsset = normalizeKrakenAsset(leg.asset);
      result.warnings.push({
        line: leg.line,
        message: `Obchod ${refid || '(bez refid)'}: poplatek ${plainNumber(fee)} ${feeAsset}${feeAsset === 'KFEE' ? ' (poplatkové kredity Krakenu)' : ''} je účtovaný na samostatném řádku — do výpočtu nebyl odečten.`,
        raw: leg.raw,
      });
    }

    if (legs.length !== 2) {
      for (const leg of legs) {
        result.errors.push({
          line: leg.line,
          message: `Obchod ${refid} nemá párový řádek (druhou stranu směny) — export je nejspíš neúplný, stáhni prosím kompletní ledgers.csv.`,
          raw: leg.raw,
        });
      }
      continue;
    }

    const parsed = legs.map((leg) => ({
      leg,
      date: toIsoDate(leg.time),
      amount: parseKrakenNumber(leg.amountRaw),
      fee: parseKrakenNumber(leg.feeRaw) ?? '0',
      asset: normalizeKrakenAsset(leg.asset),
    }));

    let invalid = false;
    for (const p of parsed) {
      if (p.date === null) {
        result.errors.push({
          line: p.leg.line,
          message: `Neplatný čas „${p.leg.time}“ (očekáváme YYYY-MM-DD HH:MM:SS).`,
          raw: p.leg.raw,
        });
        invalid = true;
      } else if (p.amount === null) {
        result.errors.push({
          line: p.leg.line,
          message: `Částku „${p.leg.amountRaw}“ se nepodařilo přečíst.`,
          raw: p.leg.raw,
        });
        invalid = true;
      }
    }
    if (invalid) continue;

    const a = parsed[0]!;
    const b = parsed[1]!;

    // Dvě nohy spojuje jen refid, a ten může být i prázdný — bez kontroly času
    // se pak tiše slepily nohy z různých měsíců do jednoho „obchodu“ s datem
    // té druhé. Obě strany směny nastávají naráz, takže různý den = nepárujeme.
    if (a.date !== b.date) {
      for (const leg of [a, b]) {
        result.errors.push({
          line: leg.leg.line,
          message: `Obchod ${refid || '(bez refid)'}: nohy směny mají různá data (${a.date} a ${b.date}), takže je nepárujeme — zkontroluj export, nebo řádky doplň přes univerzální šablonu.`,
          raw: leg.leg.raw,
        });
      }
      continue;
    }

    const aIsFiat = FIAT_CURRENCIES.has(a.asset);
    const bIsFiat = FIAT_CURRENCIES.has(b.asset);

    if (aIsFiat && bIsFiat) {
      result.skipped.push({
        line: a.leg.line,
        message: `Směna měn ${a.asset} ↔ ${b.asset} — FX konverze, pro daňový výpočet kryptoaktiv není potřeba.`,
      });
      continue;
    }
    if (!aIsFiat && !bIsFiat) {
      const sold = d(a.amount!).lt(0) ? a : b;
      const bought = sold === a ? b : a;
      result.warnings.push({
        line: a.leg.line,
        message: `Směna krypto–krypto ${sold.asset} → ${bought.asset} bez fiat protihodnoty — oceň a doplň přes univerzální šablonu jako prodej + nákup. Řádky přeskočeny.`,
        raw: `${a.leg.raw} | ${b.leg.raw}`,
      });
      continue;
    }

    const fiat = aIsFiat ? a : b;
    const crypto = aIsFiat ? b : a;
    const fiatAmount = d(fiat.amount!);
    const cryptoAmount = d(crypto.amount!);

    const type = cryptoAmount.gt(0) && fiatAmount.lt(0)
      ? 'BUY'
      : cryptoAmount.lt(0) && fiatAmount.gt(0)
        ? 'SELL'
        : null;
    if (type === null) {
      result.errors.push({
        line: crypto.leg.line,
        message: `Obchod ${refid}: obě strany směny mají stejné znaménko (${fiat.amount} ${fiat.asset} / ${crypto.amount} ${crypto.asset}) — řádky nedávají smysl jako nákup ani prodej.`,
        raw: `${a.leg.raw} | ${b.leg.raw}`,
      });
      continue;
    }

    const quantity = cryptoAmount.abs();
    if (quantity.eq(0)) {
      result.errors.push({
        line: crypto.leg.line,
        message: `Obchod ${refid} má nulový počet kusů — řádek nelze zpracovat.`,
        raw: crypto.leg.raw,
      });
      continue;
    }
    const total = fiatAmount.abs();

    // poplatek ve fiat odečítáme; poplatek v kryptu ocenit neumíme → poctivý warning
    const cryptoFee = d(crypto.fee);
    if (cryptoFee.gt(0)) {
      result.warnings.push({
        line: crypto.leg.line,
        message: `Poplatek ${crypto.fee} ${crypto.asset} je v kryptoměně — neumíme ho ocenit ve fiat, do výpočtu nebyl odečten.`,
      });
    }
    const fiatFee = d(fiat.fee);
    const fee = fiatFee.gt(0) ? { amount: fiatFee.toString(), currency: fiat.asset } : undefined;

    const id = `kraken-${crypto.leg.txid !== '' ? crypto.leg.txid : fnv1a64(`${refid}|${crypto.leg.raw}`)}`;

    try {
      result.transactions.push(
        TransactionSchema.parse({
          type,
          id,
          isin: crypto.asset,
          assetClass: 'CRYPTO',
          quantity: quantity.toString(),
          pricePerShare: total.div(quantity).toString(),
          currency: fiat.asset,
          fee,
          tradeDate: crypto.date!,
        }),
      );
    } catch (err) {
      result.errors.push({
        line: crypto.leg.line,
        message: `Obchod ${refid} se nepodařilo zpracovat: ${err instanceof Error ? err.message : String(err)}`,
        raw: `${a.leg.raw} | ${b.leg.raw}`,
      });
    }
  }

  return result;
}
