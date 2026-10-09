import { Decimal, TransactionSchema } from '@danero/shared';
import { cleanNumber, firstLine, HeaderMap, isAmbiguousThousands, parseCsv } from '../csv';
import { fnv1a64, uniqueIdFactory } from '../dedupe';
import { emptyResult, type ImportResult } from '../types';
import { YearBoundaryWatch } from '../year-boundary';

export const TRADING212_BROKER = 'trading212';

/**
 * Názvy sloupce s časem obchodu, novější první.
 *
 * ⚠️ T212 sloupec kdykoli přejmenuje: v srpnu 2026 se z „Time“ stalo
 * „Time (UTC)“ a protože se autodetekce ptala na přesné „Time“, přestal se
 * export poznávat ÚPLNĚ — soubor propadl až k univerzální šabloně a uživatel
 * dostal nesmyslné „Chybí povinný sloupec type“. Platí to pro ruční nahrání
 * i pro API sync, protože obojí jde stejnou autodetekcí. Nový název přidávej
 * SEM, ne do podmínek.
 */
export const TRADING212_TIME_COLUMNS = ['Time (UTC)', 'Time'] as const;

/**
 * Poplatkové sloupce T212 exportu (sada se liší podle účtu a období).
 * Každý má párový sloupec `Currency (<název>)`.
 */
const FEE_COLUMNS = [
  'Currency conversion fee',
  'Stamp duty',
  'Stamp duty reserve tax',
  'French transaction tax',
  'Transaction fee',
  'Finra fee',
  'SEC fee',
] as const;

type RowKind =
  | { kind: 'BUY' | 'SELL' }
  | { kind: 'DIVIDEND' }
  | { kind: 'INTEREST' }
  | { kind: 'DEPOSIT' | 'WITHDRAWAL' }
  | { kind: 'SPLIT_CLOSE' | 'SPLIT_OPEN' }
  | { kind: 'SPINOFF' }
  | { kind: 'SKIP'; reason: string }
  | { kind: 'SHARE_MOVEMENT'; guidance: string }
  | { kind: 'UNKNOWN' };

/**
 * Pohyby kusů, které z řádku T212 zaúčtovat neumíme (L2a-03): řádek nenese
 * datum ani cenu původního pořízení, u jednořádkového splitu ani poměr. Chyba
 * je správný směr — tiše přeskočený řádek by rozhodil počty kusů a prodej by
 * pak neseděl bez jediného slova. Hláška ale musí říct, co se s kusy stalo
 * a kudy je doplnit; „neznámý typ, nahlaš nám ho“ u běžné hodnoty exportu
 * nepomůže.
 *
 * ⚠️ U připsaných kusů (Stock distribution) text schválně neříká, jakou cenu
 * a datum pořízení zadat: záleží na tom, o jakou událost šlo, a z řádku se to
 * nepozná.
 */
const SHARE_MOVEMENT_GUIDANCE = {
  distribution:
    'Trading 212 ti tímhle řádkem připsal kusy bez nákupu. Je to pohyb kusů, který sami nezaúčtujeme — z řádku se nepozná, o jakou událost šlo. Kusy proto v evidenci chybí a jejich pozdější prodej nebude sedět. Zjisti si u brokera, proč ti je připsal, a doplň je přes univerzální šablonu.',
  transferIn:
    'převod kusů na tenhle účet. Je to pohyb kusů, který sami nezaúčtujeme — řádek nenese datum ani cenu, za kterou jsi je původně pořídil. Kusy proto v evidenci chybí a jejich pozdější prodej nebude sedět. Doplň je přes univerzální šablonu řádkem TRANSFER_IN s datem a cenou původního pořízení.',
  transferOut:
    'převod kusů z tohohle účtu jinam (není to prodej). Je to pohyb kusů, který sami nezaúčtujeme, takže v evidenci dál zůstávají kusy, které tu už nemáš. Doplň ho přes univerzální šablonu řádkem TRANSFER_OUT.',
  singleLineSplit:
    'změna počtu kusů (split) zapsaná jedním řádkem — umíme ji jen jako dvojici řádků „Stock split close“ a „Stock split open“. Je to pohyb kusů, který sami nezaúčtujeme, takže počet kusů v evidenci po téhle události nesedí. Doplň ji přes univerzální šablonu řádkem CORPORATE_ACTION se subtypem SPLIT a poměrem starých a nových kusů.',
} as const;

/** Klasifikace řádku podle sloupce Action (hodnoty typu "Market buy", "Dividend (Ordinary)"…). */
function classifyAction(action: string): RowKind {
  const normalized = action.toLowerCase();
  // korporátní akce dřív než obecné buy/sell — T212 je reportuje párem close/open řádků
  if (normalized.includes('stock split close')) return { kind: 'SPLIT_CLOSE' };
  if (normalized.includes('stock split open')) return { kind: 'SPLIT_OPEN' };
  // až ZA párem close/open: jednořádkový „Stock Split“ poměr nenese
  if (normalized.includes('stock split'))
    return { kind: 'SHARE_MOVEMENT', guidance: SHARE_MOVEMENT_GUIDANCE.singleLineSplit };
  // „Stock distribution“ i „Custom stock distribution“
  if (normalized.includes('stock distribution'))
    return { kind: 'SHARE_MOVEMENT', guidance: SHARE_MOVEMENT_GUIDANCE.distribution };
  if (normalized === 'transfer in')
    return { kind: 'SHARE_MOVEMENT', guidance: SHARE_MOVEMENT_GUIDANCE.transferIn };
  if (normalized === 'transfer out')
    return { kind: 'SHARE_MOVEMENT', guidance: SHARE_MOVEMENT_GUIDANCE.transferOut };
  if (normalized.includes('spin off') || normalized.includes('spin-off'))
    return { kind: 'SPINOFF' };
  // vratka („Card refund“) je tentýž pohyb peněz jako platba, jen opačným směrem
  if (
    normalized.includes('card debit') ||
    normalized.includes('card credit') ||
    normalized.includes('card refund')
  )
    return { kind: 'SKIP', reason: 'platba kartou — pohyb peněz mimo daňový výpočet CP' };
  if (normalized.includes('spending cashback'))
    return { kind: 'SKIP', reason: 'cashback za platby kartou — mimo daňový výpočet CP' };
  if (normalized.includes('buy')) return { kind: 'BUY' };
  if (normalized.includes('sell')) return { kind: 'SELL' };
  if (normalized.startsWith('dividend')) return { kind: 'DIVIDEND' };
  if (normalized.includes('interest')) return { kind: 'INTEREST' };
  if (normalized === 'deposit') return { kind: 'DEPOSIT' };
  if (normalized === 'withdrawal') return { kind: 'WITHDRAWAL' };
  if (normalized.includes('currency conversion'))
    return { kind: 'SKIP', reason: 'FX konverze — pro daňový výpočet není potřeba' };
  if (normalized.includes('result adjustment'))
    return { kind: 'SKIP', reason: 'Result adjustment — interní korekce T212' };
  return { kind: 'UNKNOWN' };
}

interface SplitLeg {
  isin: string;
  date: string;
  quantity: string;
  line: number;
  id: string;
}

/**
 * Poznává T212 export podle hlavičky. Čte se JEN první řádek — plný parse
 * 20MB CSV by tu byl zbytečný.
 *
 * Tohle je JEDINÉ místo, kde se rozhoduje „tenhle soubor je z T212“:
 * autodetekce i parser se ptají stejnou funkcí, takže se nemůžou rozejít.
 * Dokud měla autodetekce vlastní kopii podmínky, stačilo přejmenování sloupce
 * v exportu a import přestal fungovat, aniž by spadl jediný test.
 */
export function sniffTrading212Csv(text: string): boolean {
  const { headers } = parseCsv(firstLine(text));
  const map = new HeaderMap(headers);
  return map.has('Action') && map.hasAny(TRADING212_TIME_COLUMNS);
}

/**
 * Parser CSV exportu Trading212 (History → Export, kategorie Orders/Dividends/
 * Transactions/Interest). Mapuje výhradně podle NÁZVŮ sloupců — T212 mění jejich
 * sadu i pořadí podle zvolených kategorií. Datum vypořádání export neobsahuje,
 * engine ho dopočítá (T+1 US od 28. 5. 2024 a CA od 27. 5. 2024, jinak T+2).
 */
/**
 * Věta k nerozhodnutelnému počtu kusů (B-3-12) — jedna definice pro obchody
 * i dividendy: u obou se z kusů počítá číslo, které jde do přiznání.
 */
const ambiguousSharesNote = (sharesRaw: string): string =>
  `Počet kusů „${sharesRaw}“ jsme přečetli jako ${cleanNumber(sharesRaw)}. Čárka tu může být ` +
  'i desetinná (Trading 212 prodává zlomky akcií) — pak by šlo o tisíckrát menší množství. ' +
  'Zkontroluj si tenhle řádek ve výpisu.';

export function parseTrading212Csv(text: string): ImportResult {
  const result = emptyResult(TRADING212_BROKER);
  const { headers, rows } = parseCsv(text);
  const map = new HeaderMap(headers);

  // Úplně prázdný soubor = prázdné období (T212 ho vrací pro roky před založením
  // účtu) — to není chyba formátu, ale nula transakcí.
  if (text.trim() === '') return result;

  if (!map.has('Action') || !map.hasAny(TRADING212_TIME_COLUMNS)) {
    result.errors.push({
      line: 1,
      message: `Soubor nevypadá jako Trading212 export — chybí sloupce "Action"/"Time". Nalezené sloupce: ${headers.join(', ')}`,
    });
    return result;
  }

  const seenIds = new Set<string>();
  const uniqueId = uniqueIdFactory();
  const seenNoIdBases = new Set<string>();
  const splitCloses: SplitLeg[] = [];
  const splitOpens: SplitLeg[] = [];
  // R-05d: sloupec je ve světovém čase, den i rok se berou z něj
  const yearBoundary = new YearBoundaryWatch(result);

  rows.forEach((row, rowIndex) => {
    const line = rowIndex + 2; // 1 = hlavička
    const action = map.get(row, 'Action');
    const time = map.getAny(row, TRADING212_TIME_COLUMNS);
    const date = time.slice(0, 10);
    yearBoundary.row(line, time);

    if (action === '' && row.every((cell) => cell.trim() === '')) return;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      result.errors.push({ line, message: `Neplatný čas "${time}" (očekáván formát YYYY-MM-DD HH:mm:ss)`, raw: action });
      return;
    }

    const classified = classifyAction(action);
    const rowId = (): string => {
      const explicit = map.get(row, 'ID');
      if (explicit !== '') {
        const id = `t212-${explicit}`;
        if (seenIds.has(id)) {
          result.warnings.push({
            line,
            message: `Řádek má stejné ID jako jiný řádek souboru (${action} ${time}) — deduplikace je sloučí v jednu transakci. Ověř, zda nejde o dvě skutečné transakce.`,
          });
        }
        seenIds.add(id);
        return id;
      }
      // identické legitimní řádky bez ID (dva stejné fill-y v téže sekundě) nesmí
      // tiše splynout — pořadový suffix drží klíče stabilní i napříč exporty
      const base = `t212-${fnv1a64([action, time, map.get(row, 'ISIN'), map.get(row, 'No. of shares'), map.get(row, 'Price / share'), map.get(row, 'Total')].join('|'))}`;
      if (seenNoIdBases.has(base)) {
        // nahlas: může jít o dva skutečné fill-y, ale i o omylem slepené exporty
        result.warnings.push({
          line,
          message: `Obsahově identický řádek bez ID (${action} ${time}) — importuje se jako další samostatná transakce. Pokud jde o omylem zdvojený export, smaž duplicitní řádky.`,
        });
      }
      seenNoIdBases.add(base);
      return uniqueId(base);
    };

    try {
      switch (classified.kind) {
        case 'BUY':
        case 'SELL': {
          const isin = map.get(row, 'ISIN');
          const sharesRaw = map.get(row, 'No. of shares');
          // B-3-12: „7,848“ přečteme jako 7848, ale u brokera, který prodává
          // zlomky akcií, to klidně může být 7,848 kusu — tisícinásobný rozdíl,
          // který se propíše do nabývací ceny, limitů i daně. Rozhodnout to
          // z jednoho pole nejde, takže o tom aspoň řekneme.
          if (isAmbiguousThousands(sharesRaw)) {
            result.warnings.push({ line, message: ambiguousSharesNote(sharesRaw) });
          }
          const shares = cleanNumber(sharesRaw);
          const price = cleanNumber(map.get(row, 'Price / share'));
          const currency = map.get(row, 'Currency (Price / share)');
          if (!isin || !shares || !price || !currency) {
            result.errors.push({
              line,
              message: `${action}: chybí ISIN, počet kusů, cena nebo měna — řádek nelze zpracovat.`,
              raw: row.join(','),
            });
            return;
          }
          const fee = collectFees(map, row, result, line);
          result.transactions.push(
            TransactionSchema.parse({
              type: classified.kind,
              id: rowId(),
              isin,
              ticker: map.get(row, 'Ticker') || undefined,
              name: map.get(row, 'Name') || undefined,
              quantity: shares,
              pricePerShare: price,
              currency,
              fee,
              tradeDate: date,
              note: map.get(row, 'Notes') || undefined,
            }),
          );
          return;
        }
        case 'DIVIDEND': {
          // L2a-05: záporná částka je oprava dříve vyplacené dividendy („Dividend
          // adjustment“), ne příjem. Chytá se podle znaménka Total a DŘÍV než
          // cokoli dalšího: brutto se níž počítá z kusů × ceny a znaménko Total
          // nečte, takže by z opravy vznikla druhá kladná dividenda, a bez kusů
          // by řádek spadl až na schématu se syrovým výpisem validace. Oprava
          // se nezapočítá (příjem zůstane vyšší — bezpečný směr), stejně jako
          // u Degira.
          const dividendTotal = cleanNumber(map.get(row, 'Total'));
          if (dividendTotal.startsWith('-')) {
            result.warnings.push({
              line,
              message: `${action}: záporná dividenda ${dividendTotal} ${map.get(row, 'Currency (Total)')} — vypadá jako korekce, nezaúčtováno; zkontroluj výpis.`,
            });
            return;
          }
          // R-07h: vratka kapitálu není podíl na zisku, ale vrácení části vkladu.
          // Označí se v modelu a zbytek řeší engine podle přepínače — parser
          // sám nerozhoduje, co je daňově správně.
          const returnOfCapital = action.toLowerCase().includes('return of capital');
          if (returnOfCapital) {
            result.warnings.push({
              line,
              message: `${action}: vratka kapitálu není podíl na zisku — věcně snižuje nabývací cenu držených kusů (daň až při prodeji). Ve výchozím nastavení ji daníme jako dividendu (§ 8) a čerpá limit 50 000 Kč, protože je to bezpečnější výklad; přepnout to jde v Nastavení u „Vratka kapitálu“ (R-07h).`,
            });
          }
          // B-3-10: náhrada za dividendu u zapůjčených akcií (T212 půjčuje kusy
          // na short). Formálně to není dividenda, ale platba od půjčovatele —
          // nárok na zápočet zahraniční srážky u ní není jistý. Danit ji jako
          // dividendu je bezpečný směr, mlčet o tom ne; IBKR na týž případ
          // upozorňuje („Payment In Lieu Of Dividends“).
          if (action.toLowerCase().includes('manufactured payment')) {
            result.warnings.push({
              line,
              message: `${action}: tohle není dividenda od firmy, ale náhrada za ni od toho, komu Trading 212 tvoje akcie půjčil. Daníme ji jako dividendu (§ 8), protože je to bezpečnější varianta — u zápočtu případné zahraniční srážkové daně je ale nárok sporný. Pokud jde o významnou částku, ověř si ji s poradcem.`,
            });
          }
          const isin = map.get(row, 'ISIN') || undefined;
          const sharesRaw = map.get(row, 'No. of shares');
          // B-3-12 platí i tady: z týchž kusů se počítá BRUTTO dividendy,
          // tedy základ § 8 i čerpání limitu — varování patřilo jen k obchodům.
          if (isAmbiguousThousands(sharesRaw)) {
            result.warnings.push({ line, message: ambiguousSharesNote(sharesRaw) });
          }
          const shares = cleanNumber(sharesRaw);
          const price = cleanNumber(map.get(row, 'Price / share'));
          const instrumentCurrency = map.get(row, 'Currency (Price / share)');
          let withholding = cleanNumber(map.get(row, 'Withholding tax')) || '0';
          const withholdingCurrency = map.get(row, 'Currency (Withholding tax)');

          let gross: string;
          let currency: string;
          // částka z výpisu PŘED přičtením srážky — podle ní se níž pozná
          // řádek, kterému v exportu chybí kusy nebo částka na kus
          let paid: string;
          // příznak modelu: brutto je složené z čisté částky a srážky (viz níž)
          let grossFromNet: true | undefined;
          if (shares && price && instrumentCurrency) {
            // R-07b, L14-01: „Price / share“ je u dividendy ČISTÁ částka na kus,
            // tedy vyhlášená dividenda už po zahraniční srážce (ověřeno na
            // reálných exportech: kusy × cena sedí na připsané Total, nikdy na
            // částku před srážkou). Do § 8 jde brutto, takže
            //   brutto = kusy × cena + Withholding tax,
            // obojí v měně instrumentu. Dokud se cena brala jako brutto, byl
            // příjem nižší o srážku a ta vycházela na 15/85 = 17,65 % místo 15 %.
            const net = new Decimal(shares).mul(price);
            paid = net.toString();
            gross = paid;
            currency = instrumentCurrency;
            if (withholdingCurrency && withholdingCurrency !== instrumentCurrency) {
              // číslo v cizí měně by se tiše přepočetlo špatným kurzem —
              // bezpečněji: zápočet nezapočíst (vyšší daň) a říct si o doplnění.
              // K brutto se taková srážka nepřičítá ze stejného důvodu.
              withholding = '0';
              result.warnings.push({
                line,
                message: `Dividenda: srážková daň v jiné měně (${withholdingCurrency}) než brutto (${instrumentCurrency}) — do zápočtu nebyla započtena, doplň ji ručně.`,
              });
            } else {
              // Srážka se přičítá jen k platné čisté částce: záporná cena nebo
              // záporná srážka mají spadnout na validaci modelu, ne se navzájem
              // vyrušit do kladného brutta.
              const tax = new Decimal(withholding);
              if (tax.gt(0) && !net.isNegative()) gross = net.plus(tax).toString();
              grossFromNet = true;
            }
          } else {
            // starší formát bez kusů/ceny: k dispozici jen čistá částka Total
            gross = cleanNumber(map.get(row, 'Total'));
            paid = gross;
            currency = map.get(row, 'Currency (Total)');
            if (!gross || !currency) {
              result.errors.push({ line, message: 'Dividenda bez částky — řádek nelze zpracovat.' });
              return;
            }
            result.warnings.push({
              line,
              message:
                'Dividenda: brutto odhadnuto z čisté připsané částky (export neobsahuje kusy × dividenda/kus) — základ § 8 může být podhodnocen o srážkovou daň.',
            });
          }
          // nulová částka s nenulovou srážkou = sražená daň bez příjmu; nulová
          // dividenda vůbec je podezřelá vždy (chybějící kusy/cena v exportu)
          if (new Decimal(paid).eq(0)) {
            const tax = new Decimal(withholding || '0');
            result.warnings.push({
              line,
              message: tax.gt(0)
                ? `${action}: dividenda vychází na nulu (kusy „${shares || '—'}“ × částka na kus „${price || '—'}“), ale sražená daň je ${tax.toString()} ${currency} — sražená daň bez vyplacené částky je podezřelá. Zkontroluj řádek ve výpisu brokera a částku případně doplň ručně.`
                : `${action}: dividenda s nulovou částkou — v exportu chybí počet kusů nebo dividenda na kus. Zkontroluj řádek ve výpisu brokera.`,
            });
          }
          result.transactions.push(
            TransactionSchema.parse({
              type: 'DIVIDEND',
              id: rowId(),
              isin,
              ticker: map.get(row, 'Ticker') || undefined,
              gross,
              currency,
              withholdingTax: withholding,
              returnOfCapital,
              ...(grossFromNet ? { grossFromNet } : {}),
              date,
            }),
          );
          return;
        }
        case 'INTEREST': {
          const amount = cleanNumber(map.get(row, 'Total'));
          const currency = map.get(row, 'Currency (Total)');
          if (!amount || !currency) {
            result.errors.push({ line, message: `${action}: chybí částka/měna úroku.` });
            return;
          }
          // Záporný úrok = naúčtovaný (ne připsaný) — nesmí se tiše otočit
          // do zdanitelného příjmu § 8; evidujeme ho jako poplatek účtu
          if (amount.startsWith('-')) {
            result.warnings.push({
              line,
              message: `${action}: záporná částka ${amount} ${currency} — jde o naúčtovaný úrok (náklad), ne příjem. Evidujeme jako poplatek účtu, do základu § 8 nevstupuje.`,
            });
            result.transactions.push(
              TransactionSchema.parse({
                type: 'FEE',
                id: rowId(),
                amount: amount.replace(/^-/, ''),
                currency,
                date,
              }),
            );
            return;
          }
          // R-07f: sloupec srážkové daně nese T212 na každém řádku (u úroků bývá
          // prázdný). Když vyplněný je, musí se přenést — jinak zápočet propadne
          // už v importu. V jiné měně než úrok ho radši nezapočítáme (stejně
          // jako u dividend: špatný kurz by zápočet nadhodnotil).
          let interestWithholding = cleanNumber(map.get(row, 'Withholding tax')) || '0';
          const interestWithholdingCurrency = map.get(row, 'Currency (Withholding tax)');
          if (
            new Decimal(interestWithholding).gt(0) &&
            interestWithholdingCurrency &&
            interestWithholdingCurrency !== currency
          ) {
            result.warnings.push({
              line,
              message: `${action}: srážková daň v jiné měně (${interestWithholdingCurrency}) než úrok (${currency}) — do zápočtu nebyla započtena, doplň ji ručně.`,
            });
            interestWithholding = '0';
          }
          result.transactions.push(
            TransactionSchema.parse({
              type: 'INTEREST',
              id: rowId(),
              amount,
              currency,
              withholdingTax: interestWithholding,
              date,
            }),
          );
          return;
        }
        case 'DEPOSIT':
        case 'WITHDRAWAL': {
          const amount = cleanNumber(map.get(row, 'Total'));
          const currency = map.get(row, 'Currency (Total)');
          if (!amount || !currency) {
            result.errors.push({ line, message: `${action}: chybí částka/měna.` });
            return;
          }
          result.transactions.push(
            TransactionSchema.parse({
              type: classified.kind,
              id: rowId(),
              amount: amount.replace(/^-/, ''),
              currency,
              date,
            }),
          );
          return;
        }
        case 'SPLIT_CLOSE':
        case 'SPLIT_OPEN': {
          const isin = map.get(row, 'ISIN');
          const shares = cleanNumber(map.get(row, 'No. of shares'));
          if (!isin || !shares) {
            result.errors.push({ line, message: `${action}: chybí ISIN nebo počet kusů.` });
            return;
          }
          const leg: SplitLeg = { isin, date, quantity: shares, line, id: rowId() };
          (classified.kind === 'SPLIT_CLOSE' ? splitCloses : splitOpens).push(leg);
          return;
        }
        case 'SPINOFF': {
          // T212 reportuje spin-off jako příjem nových kusů dceřiného ISIN s cenou 0
          // → BUY za 0 přesně odpovídá R-04f (nová lhůta testu, nabývací cena 0).
          const isin = map.get(row, 'ISIN');
          const shares = cleanNumber(map.get(row, 'No. of shares'));
          const currency = map.get(row, 'Currency (Price / share)') || 'USD';
          if (!isin || !shares) {
            result.errors.push({ line, message: 'Spin off: chybí ISIN nebo počet kusů.' });
            return;
          }
          result.transactions.push(
            TransactionSchema.parse({
              type: 'BUY',
              id: rowId(),
              isin,
              ticker: map.get(row, 'Ticker') || undefined,
              name: map.get(row, 'Name') || undefined,
              quantity: shares,
              pricePerShare: cleanNumber(map.get(row, 'Price / share')) || '0',
              currency,
              tradeDate: date,
              settlementDate: date,
              note: 'Spin-off (T212)',
            }),
          );
          result.warnings.push({
            line,
            message: `Spin-off ${isin}: nové kusy s nabývací cenou 0 a novou lhůtou časového testu (konzervativní postup); mateřská pozice beze změny.`,
          });
          return;
        }
        case 'SKIP': {
          result.skipped.push({ line, message: `${action}: ${classified.reason}` });
          return;
        }
        case 'SHARE_MOVEMENT': {
          // A04-R1-01: příznak říká importu, že tohle není „nepřečtený výpis“ —
          // jinak by soubor jen s převody dostal vedle rady „doplň si to
          // šablonou“ ještě panel „na zpracování pracujeme“
          result.errors.push({
            line,
            message: `${action}: ${classified.guidance}`,
            raw: row.join(','),
            knownUnsupported: true,
          });
          return;
        }
        case 'UNKNOWN': {
          result.errors.push({
            line,
            message: `Neznámý typ transakce "${action}" — nahlaš nám ho, doplníme podporu.`,
            raw: row.join(','),
          });
          return;
        }
      }
    } catch (err) {
      result.errors.push({
        line,
        message: `Řádek se nepodařilo zpracovat: ${describeRowError(err, classified.kind, (column) => map.get(row, column))}`,
        raw: row.join(','),
      });
    }
  });
  yearBoundary.flush();

  // Párování Stock split close/open (stejný ISIN a den) → CORPORATE_ACTION SPLIT.
  // Poměr = nové kusy / staré kusy celé pozice — ledger jím proporcionálně
  // transformuje všechny loty bez resetu data nabytí (R-04a).
  for (const open of splitOpens) {
    const closeIndex = splitCloses.findIndex((c) => c.isin === open.isin && c.date === open.date);
    if (closeIndex === -1) {
      result.errors.push({
        line: open.line,
        message: `Stock split open (${open.isin}) bez párového close řádku — split nelze sestavit.`,
      });
      continue;
    }
    const close = splitCloses.splice(closeIndex, 1)[0]!;
    result.transactions.push(
      TransactionSchema.parse({
        type: 'CORPORATE_ACTION',
        id: open.id,
        subtype: 'SPLIT',
        isin: open.isin,
        date: open.date,
        ratio: { from: close.quantity, to: open.quantity },
        note: 'Stock split (T212 close/open pár)',
      }),
    );
  }
  for (const close of splitCloses) {
    result.errors.push({
      line: close.line,
      message: `Stock split close (${close.isin}) bez párového open řádku — split nelze sestavit.`,
    });
  }

  return result;
}

/**
 * Pole modelu → sloupce exportu, ze kterých se plní (A04-R1-02). Podle druhu
 * řádku, protože totéž pole bere každý druh odjinud (`currency` je u obchodu
 * měna ceny, u úroku měna částky).
 *
 * Kde se pole skládá z víc sloupců (brutto dividendy = kusy × čistá částka na
 * kus + srážka, ve starším exportu Total), jsou tu všechny kromě srážky — ta
 * má vlastní pole a k brutto se přičítá, jen když je sama platná, takže vadné
 * brutto nezpůsobí. Hláška jmenuje ty vyplněné
 * a vadný je mezi nimi. Schválně se tu neopakuje podmínka, podle které si
 * parser mezi nimi vybírá: dvě kopie téhož rozhodnutí by se rozešly.
 */
const FEE_SOURCE_COLUMNS: Record<string, readonly string[]> = {
  'fee.amount': FEE_COLUMNS,
  'fee.currency': FEE_COLUMNS.map((column) => `Currency (${column})`),
};
const TRADE_SOURCE_COLUMNS: Record<string, readonly string[]> = {
  isin: ['ISIN'],
  quantity: ['No. of shares'],
  pricePerShare: ['Price / share'],
  currency: ['Currency (Price / share)'],
  ...FEE_SOURCE_COLUMNS,
};
const DIVIDEND_SOURCE_COLUMNS: Record<string, readonly string[]> = {
  isin: ['ISIN'],
  gross: ['No. of shares', 'Price / share', 'Total'],
  currency: ['Currency (Price / share)', 'Currency (Total)'],
  withholdingTax: ['Withholding tax'],
};
const CASH_SOURCE_COLUMNS: Record<string, readonly string[]> = {
  amount: ['Total'],
  currency: ['Currency (Total)'],
  withholdingTax: ['Withholding tax'],
};
const SOURCE_COLUMNS: Partial<Record<RowKind['kind'], Record<string, readonly string[]>>> = {
  BUY: TRADE_SOURCE_COLUMNS,
  SELL: TRADE_SOURCE_COLUMNS,
  SPINOFF: TRADE_SOURCE_COLUMNS,
  DIVIDEND: DIVIDEND_SOURCE_COLUMNS,
  INTEREST: CASH_SOURCE_COLUMNS,
  DEPOSIT: CASH_SOURCE_COLUMNS,
  WITHDRAWAL: CASH_SOURCE_COLUMNS,
};

/** Tvar nálezu validace modelu (Zod) — importéry na knihovně přímo nezávisí. */
interface ValidationIssue {
  code?: unknown;
  path?: unknown;
  message?: unknown;
}

/**
 * Text chyby řádku pro uživatele. Selhání validace modelu nese `message`
 * v podobě JSON pole se všemi nálezy (`[{ "code": …, "path": … }]`) a ten
 * šel beze změny až do přehledu importu (L2a-05).
 *
 * Z nálezu se bere věta a k ní sloupec exportu s hodnotou buňky (A04-R1-02):
 * řádek má 25 sloupců a samotné „Hodnota nesmí být záporná“ neřekne, který
 * z nich opravit. Česky píše model jen vlastní pravidla (kódy `custom`
 * a `invalid_format`); ostatní kódy mají anglický text knihovny, takže je
 * u známého sloupce nahradí obecná věta — stejně jako v univerzální šabloně.
 */
function describeRowError(
  err: unknown,
  kind: RowKind['kind'],
  cell: (column: string) => string,
): string {
  const issues = (err as { issues?: unknown } | null)?.issues;
  if (Array.isArray(issues)) {
    const parts = new Set<string>();
    for (const issue of issues as Array<ValidationIssue | null>) {
      const message = typeof issue?.message === 'string' ? issue.message : '';
      const field = Array.isArray(issue?.path) ? issue.path.map(String).join('.') : '';
      const filled = (SOURCE_COLUMNS[kind]?.[field] ?? [])
        .map((column) => ({ column, value: cell(column) }))
        .filter(({ value }) => value !== '');
      if (filled.length === 0) {
        // pole, ke kterému sloupec neznáme (nebo je prázdný): aspoň věta
        if (message !== '') parts.add(message);
        continue;
      }
      const sentence =
        issue?.code === 'custom' || issue?.code === 'invalid_format'
          ? message
          : 'hodnota není platná';
      const columns = filled.map(({ column, value }) => `„${column}“ („${value}“)`).join(', ');
      parts.add(`${filled.length === 1 ? 'sloupec' : 'sloupce'} ${columns}: ${sentence}`);
    }
    if (parts.size > 0) return [...parts].join('; ');
  }
  return err instanceof Error ? err.message : String(err);
}

/** Sečte poplatkové sloupce řádku; při míchání měn vezme první měnu a zbytek nahlásí.
 * Bezpečný směr: podezřelý poplatek (záporný = vratka, bez sloupce s měnou) se
 * NEzapočte a nahlásí — nezapočtený výdaj daň nesníží, tichá chyba by ji zkreslila. */
function collectFees(
  map: HeaderMap,
  row: string[],
  result: ImportResult,
  line: number,
): { amount: string; currency: string } | undefined {
  let total: Decimal | undefined;
  let currency: string | undefined;
  for (const column of FEE_COLUMNS) {
    const raw = cleanNumber(map.get(row, column));
    if (!raw) continue;
    if (raw.startsWith('-')) {
      result.warnings.push({
        line,
        message: `Poplatek "${column}" je záporný (${raw}) — vypadá jako vratka, do výdajů nebyl započten. Zkontroluj ručně.`,
      });
      continue;
    }
    const feeCurrency = map.get(row, `Currency (${column})`) || undefined;
    if (feeCurrency === undefined) {
      result.warnings.push({
        line,
        message: `Poplatek "${column}" nemá v exportu sloupec s měnou — do výdajů nebyl započten, doplň ručně.`,
      });
      continue;
    }
    if (currency !== undefined && feeCurrency !== currency) {
      result.warnings.push({
        line,
        message: `Poplatek "${column}" je v jiné měně (${feeCurrency}) než ostatní poplatky (${currency}) — nebyl započten, doplň ručně.`,
      });
      continue;
    }
    currency = currency ?? feeCurrency;
    total = (total ?? new Decimal(0)).plus(raw);
  }
  if (!total || total.lte(0) || currency === undefined) return undefined;
  return { amount: total.toString(), currency };
}

/**
 * Poznávací znamení přenosu přerušeného hned za hlavičkou: přišel neprázdný
 * soubor, ale ani jeden datový řádek. Prázdné období posílá T212 jako ÚPLNĚ
 * prázdný soubor (ověřeno provozem), takže tohle prázdný rok NENÍ — a kdyby
 * se za něj vydával, ukončil by předčasně stahování plné historie a chybějící
 * roky by se už nikdy nedotáhly. Kontrola nestojí na hlavičce Content-Length:
 * tu server poslat nemusí (chunked přenos) a u komprimované odpovědi neplatí
 * pro rozbalený text.
 *
 * Schválně se nedívá na názvy sloupců: řez může padnout i doprostřed hlavičky
 * a takový soubor by pak prošel jako „cizí formát“ = chybný import, po kterém
 * se rok považuje za stažený.
 *
 * **Řez uprostřed dat** (hlavička + část řádků) poznají dvě obsahové kontroly
 * na POSLEDNÍM řádku — hlavička ani ostatní řádky se nekontrolují, protože
 * kratší řádek uprostřed souboru je legitimní jev (T212 vynechává koncové
 * prázdné sloupce), kdežto na konci je to stopa po přerušeném přenosu:
 *
 * 1. poslední řádek má **míň polí než hlavička**,
 * 2. poslední řádek končí uvnitř **neuzavřené uvozovky**.
 *
 * Naměřeno na reálném exportu (179 446 B, 833 transakcí) a 4 000 místech řezu:
 * původní kontrola „ani jeden datový řádek“ chytila 9 řezů (0,2 %), parser
 * zhavaroval u 2 337 a **1 654 (41,3 %) skončilo úplně tiše** — řez na 8 207 B
 * dal 47 transakcí místo 833 s `errors=0, warnings=0`. Tyhle dvě kontroly
 * podíl tichých řezů srazí na **1,8 %** a falešný poplach nevyrobily ani na
 * jednom ze tří reálných exportů (395/1 583/1 369 řádků) — všechny mají
 * všechny řádky plné šířky (nález B-3-1).
 */
export function isTruncatedTrading212Export(text: string): boolean {
  if (text.trim() === '') return false;
  // jeden parse na celý soubor — u 20MB exportu není zadarmo
  const { headers, rows } = parseCsv(text);
  if (rows.every((row) => row.every((cell) => cell.trim() === ''))) return true;

  // Neuzavřená uvozovka: v celém souboru musí být uvozovek sudý počet (i
  // zdvojené `""` uvnitř pole se počítají po dvou). Lichý počet znamená, že
  // pole začalo a soubor skončil dřív, než se zavřelo.
  //
  // Počítá se přes CELÝ soubor, ne přes poslední fyzický řádek: pole s novým
  // řádkem uvnitř uvozovek (poznámka na dva řádky) končí poslední fyzický
  // řádek jedinou uvozovkou, a kompletní export tak byl odmítnut jako
  // „nedostažený“ — ručnímu uploadu i syncu, který kvůli tomu padal.
  //
  // Cena za to: osamocená neescapovaná uvozovka KDEKOLI v souboru ho odmítne
  // celý. Bereme to vědomě — takový soubor stejně parsuje špatně (uvozovka
  // spolkne zbytek pole) a mýlit se směrem „stáhni znovu“ je u daňových čísel
  // levnější než naimportovat půlku obchodů.
  if ((text.match(/"/g)?.length ?? 0) % 2 === 1) return true;

  // Ořezaný poslední řádek: míň polí, než má hlavička. Počítá se
  // z rozparsovaného CSV, ať se čárky uvnitř uvozovek nepletou do počtu.
  const lastRow = rows.at(-1);
  if (headers.length === 0 || !lastRow) return false;
  return lastRow.length < headers.length;
}
