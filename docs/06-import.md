# Import: formáty a chování (`@danero/importers`)

## Zásady (implementace docs/03)

- Parsery mapují **podle názvů sloupců**, nikdy podle pozic — brokeři mění sadu i pořadí.
- Výstupem je vždy `ImportResult`: kanonické transakce + `errors` (řádky k opravě),
  `skipped` (vědomě vynechané) a `warnings` (zpracováno s výhradou).
- **Deduplikace**: `dedupeKey(broker, tx)` je stabilní otisk obsahu (FNV-1a 64).
  Překrývající se roční exporty tak lze nahrávat opakovaně — import je idempotentní.
  Identické legitimní řádky bez ID (dva stejné fill-y v téže sekundě) dostávají
  pořadový suffix (`uniqueIdFactory`) a NEsplynou; duplicitní explicitní ID parser
  ohlásí varováním a dedupe je sloučí. Limita: tentýž obchod v souboru s ID
  a bez ID se nesloučí.
  Dividenda uložená bez ISIN (Fio, Schwab, Tastytrade a Revolut ho neexportují
  a číselník ještě nebyl vyplněný) se po doplnění číselníku a novém nahrání pozná
  podle shodného dne, brutta, srážky, měny **a tickeru**: neuloží se podruhé
  a uloženému řádku se ISIN doplní (`promoted` v `dedupeTransactions`, zápis
  v `importParsed`). Ticker je podmínka — shodnou částku ve společný výplatní den
  mívají i dva různé tituly a jejich sloučení by jednu výplatu potichu smazalo.
  Kde titul porovnat nejde (ticker chybí uložené nebo příchozí dividendě, typicky
  u univerzální šablony), nebo kde řádek téhož titulu leží pod pořadím, které si
  v tomtéž výpisu vzala shodná dividenda jiného titulu bez ISIN, se nepáruje:
  dividenda se uloží jako nová a uživatel dostane varování, že ji možná má
  dvakrát (`ambiguous`). Zdvojená dividenda je vidět a jde vrátit, ztracená ne.
- Datum obchodu = datum z exportu (UTC); datum vypořádání engine dopočítává
  (T+1 US od 28. 5. 2024 a Kanada od 27. 5. 2024, jinak T+2, pracovní dny bez
  svátků), pokud ho export neuvádí.

## Trading212 (`parseTrading212Csv`)

Zdroj: History → Export (web/mobil), kategorie Orders / Dividends / Transactions /
Interest, **max. 1 kalendářní rok na soubor** — nahraj soubor za každý rok od prvního
nákupu. Tentýž formát generuje i API (`POST /history/exports`) — automatická
synchronizace jde stejným parserem.

Mapování `Action` → kanonický typ:

| Action (obsahuje) | Typ | Poznámky |
|---|---|---|
| `…buy` / `…sell` | BUY / SELL | množství, cena, měna instrumentu; poplatky ze sloupců Currency conversion fee, Stamp duty, French transaction tax, Finra/SEC fee… sečtené v jedné měně |
| `Dividend…` | DIVIDEND | brutto = kusy × dividenda/kus v měně instrumentu + Withholding tax; starší řádky bez kusů → brutto ≈ čistá částka s varováním |
| `…interest…` | INTEREST | Total + měna (vč. `Lending interest` — úrok z půjčování akcií) |
| `Deposit` / `Withdrawal` | DEPOSIT / WITHDRAWAL | evidence, engine je ignoruje |
| `Stock split close` + `Stock split open` | CORPORATE_ACTION SPLIT | párové řádky (stejný ISIN a den); poměr = nové kusy / staré kusy → zachování data nabytí (R-04a). Nespárovaný řádek → error |
| `Spin off` | BUY s cenou 0 | příjem nových kusů dceřiného ISIN; nabývací cena 0 a nová lhůta testu (R-04f, konzervativně) + varování |
| `Card debit` / `Card credit` / `Spending cashback` | přeskočeno | platby kartou T212 — mimo daňový výpočet CP |
| `Currency conversion` | přeskočeno | pro výpočet není potřeba |
| jiné | error řádek | nahlásit, doplníme podporu |

✅ **Oprava původní rešerše (ověřeno na reálných datech 7/2026): T212 export korporátní
akce OBSAHUJE** — splity jako pár close/open řádků, spin-offy jako příjem kusů s cenou 0.
Změny ISIN/fúze zatím nepozorovány — pro ně (a jako pojistka) slouží rekonciliace níže.
Měny: pozor na **GBX** (pence, LSE) — engine normalizuje na GBP/100.

## Trading212 API (`Trading212Client` + `syncTrading212`)

**Vytvoření klíče (Settings → API (Beta) → Generate key):**

| Pole | Hodnota | Proč |
|---|---|---|
| Name | libovolné (např. „Danero") | jen popisek |
| IP restrictions | Neomezené | server Danera nemá stálou IP |
| ✅ Account data | ano | `getCash()` — ověření klíče |
| ✅ History + History-dividends/orders/transactions | ano | `POST/GET /history/exports` — stažení historie |
| ✅ Metadata | ano | `getInstruments()` — mapování ticker→ISIN |
| ✅ Portfolio | ano | `getPositions()` — rekonciliace |
| ❌ Orders (execute i read), Pies (read i write) | NE | Danero nesmí mít právo obchodovat ani nic měnit |

Po vygenerování T212 zobrazí **dvě hodnoty: „ID klíče API" a „Tajný klíč"** (tajný
klíč jen jednou!) — do Danera se vkládají obě. Kterou variantou se API autentizuje
(HTTP Basic z páru vs. samotný tajný klíč) si `syncTrading212` ověří samo levným
`getCash()` — Basic, na 401 fallback na samotný secret.

Klient: `getCash()` (ověření klíče),
`getPositions()` + `getInstruments()` (rekonciliace, ticker→ISIN),
`requestExport()`/`fetchHistoryCsv()` (vygenerování CSV historie → stejný parser).
Autentizace: klíč v hlavičce `Authorization`; s `apiSecret` HTTP Basic — ověřit na účtu.
429 se opakuje dle Retry-After (3 pokusy).

**Synchronizace v aplikaci (`apps/web/lib/t212-sync.ts`): stačí API klíč.** První
běh projde smyčkou všechny roky od běžného zpět (konec po dvou po sobě prázdných
letech — účet ještě neexistoval; prázdné roky nezakládají dávky), další běhy stahují
jen běžný rok. Deduplikace dělá opakované běhy idempotentní. **Ruční CSV upload je
záložní varianta.**

## Rekonciliace (`reconcilePositions`)

Porovná vypočtené pozice (engine `positionsAt`) s pozicemi z API per ISIN:

- `QUANTITY_MISMATCH` + návrh poměru splitu (nejmenší p:q ≤ 20, `remaining × to/from`),
  ze kterého UI předvyplní `CORPORATE_ACTION SPLIT`;
- `MISSING_LOCALLY` (broker má, my ne → chybí historie nebo změna ISIN);
- `MISSING_AT_BROKER` (my máme, broker ne → chybí prodej/převod nebo změna ISIN).

⚠️ Rekonciliace vidí **jen otevřené pozice** — chybí-li ve výpisech nákup i prodej
téhož titulu, zůstatek vyjde a „pozice sedí“ by stálo nad neúplnými daty. Proto
`reconcileBrokerPositions` (apps/web) přidává **rozsah dat** (`coverage`): od kterého
roku transakce máme, které roky se u brokera skutečně stáhly, které roky v rozsahu
chybí a jestli engine hlásil prodej nad evidovanou pozici (`NEGATIVE_POSITION` =
historie nesahá k prvnímu nákupu). Kterákoli z těch dvou vad shodí `ok` na `false`
a stav řekne důvod česky — zelené „pozice sedí“ smí zůstat jen nad ověřenými daty.
Ověřené roky se kumulují napříč běhy (uložená rekonciliace), takže inkrementální
sync nezahodí, co plný sync poctivě ověřil jako prázdné.

Prázdný export **není** totéž co prázdný rok: plný sync, který nepřinesl ani jednu
transakci a zároveň nemá potvrzeno, že pozice sedí, se **neuzavírá** — `lastSyncedAt`
zůstane prázdný a další běh je zase plný (jinak by výpadek generování výpisů na
straně brokera trvale uřízl historii).

## Univerzální šablona (`parseUniversalCsv`)

Fallback pro nepodporované brokery. Hlavičky (malými písmeny, pořadí libovolné);
předvyplněná šablona s ukázkovými řádky ke stažení: `/api/sablona`. Zdrojem je
čárková `UNIVERSAL_TEMPLATE_CSV`; ke stažení jde tatáž data ve tvaru pro český
Excel (`UNIVERSAL_TEMPLATE_EXCEL_CSV`: BOM, středník, desetinná čárka), protože
čárkové CSV bez BOM se po dvojkliku nasype do jediného sloupce s rozbitou
diakritikou. Parser čte oba tvary stejně. Úplná sada sloupců:

```csv
type,date,settlement_date,isin,ticker,name,asset_class,settlement_style,position_effect,quantity,price,currency,fee,fee_currency,amount,withholding_tax,source_country,return_of_capital,subtype,ratio_from,ratio_to,new_isin,acquisition_date,acquisition_price,acquisition_currency,note
```

- `type`: BUY, SELL, DIVIDEND, INTEREST, FEE, DEPOSIT, WITHDRAWAL,
  CORPORATE_ACTION, TRANSFER_IN, TRANSFER_OUT
- BUY/SELL: povinné `isin, quantity, price, currency`; `settlement_date` důrazně
  doporučeno (přesnost časového testu)
- `ticker`, `name`, `note`: volitelné popisky (zkratka, název titulu, vlastní
  poznámka) — do výpočtu nevstupují, jen se podle nich řádky v přehledech
  líp hledají
- `fee` + `fee_currency`: poplatek za obchod; když `fee_currency` chybí, bere
  se měna obchodu (`currency`)
- `currency`, `fee_currency`, `acquisition_currency`: třípísmenný kód měny
  (`CZK`, `USD`, `EUR`), na velikosti písmen nezáleží; značku (`Kč`, `$`)
  parser odmítne chybou řádku se jménem sloupce
- `asset_class`: STOCK (default), ETF, BOND, CRYPTO, DERIVATIVE, OTHER —
  u kryptoaktiv a derivátů povinně vyplnit (určuje druh příjmu § 10)
- `settlement_style` (jen deriváty; case-insensitive): `premium` = cena obchodu
  je skutečný cash tok (opce; default), `margin` = daní se až **rozdíl cen při
  uzavření** pozice, nominál není příjem (futures, CFD — R-12f). Derivát bez
  vyplněného stylu se počítá premium stylem a parser přidá varování (jednou
  per instrument); jiná hodnota než premium/margin je chyba řádku
- `position_effect` (jen BUY/SELL; case-insensitive): značka **prodeje
  nakrátko** podle R-13. `open` u SELL = otevření krátké pozice, `close` u BUY
  = zpětný nákup, kterým se zavírá. Bez značky je prodej bez pozice
  k nerozeznání od neúplné historie (`NEGATIVE_POSITION`). U běžného obchodu
  (BUY + `open`, SELL + `close`) se značka ignoruje s varováním; jiná hodnota
  než open/close je chyba řádku
- DIVIDEND: `amount` = **brutto**, `withholding_tax` v téže měně, `source_country`
  (jinak se odvodí z ISIN)
- `return_of_capital` (jen DIVIDEND): `ano` (i `yes`, `true`, `1`) označí
  výplatu jako **vratku kapitálu** podle R-07h — fondy a REITy jí vracejí část
  vloženého kapitálu. Prázdné pole nebo `ne` = běžná dividenda; jiná hodnota je
  chyba řádku, ne tiché „ne“. Samotný příznak daň nemění: vratka se daní jako
  dividenda, dokud si uživatel v nastavení nezapne mírnější výklad
  (`returnOfCapitalReducesBasis`, výchozí `false`)
- INTEREST: `amount` + `currency`; volitelně `source_country` (`CZ` = srážka
  u zdroje, do § 8 nevstupuje) a `withholding_tax` v téže měně — daň sraženou
  v zahraničí bez ní nelze započíst (R-07f; strop dle čl. 11 smlouvy, u většiny
  států 0 %)
- FEE/DEPOSIT/WITHDRAWAL: `amount` + `currency`
- CORPORATE_ACTION: `subtype` (SPLIT — s `ratio_from`/`ratio_to`; ISIN_CHANGE /
  MERGER — s `new_isin`; SPINOFF; DELISTING)
- TRANSFER_IN: `acquisition_date`, `acquisition_price`, `acquisition_currency`
  = PŮVODNÍ nabytí (bez nich cena 0 a časový test od převodu — parser varuje)
- Desetinná tečka; datum `YYYY-MM-DD`; kódování UTF-8
- **Datum po česku**: ve sloupcích `date`, `settlement_date`
  a `acquisition_date` projde vedle `YYYY-MM-DD` i zápis s tečkami
  (`10.06.2024`, `1.2.2026`, `1. 2. 2026`) — český Excel tak datum uloží,
  i když ho uživatel napíše v ISO tvaru. Do modelu jde vždy ISO. Lomítka
  (`1/2/2026`) se **odmítají**: den/měsíc a měsíc/den z jedné buňky nerozlišíš
  a špatné datum nabytí by tiše posunulo časový test. Neexistující den
  (`30.02.2026`) je chyba řádku
- **Čísla s čárkou**: čárka se bere jako desetinná (`1,25` = 1.25, `0,001`
  = 0.001 — celá část s vedoucí nulou tisíce být nemůže). Zápis „jedna až tři
  číslice bez vedoucí nuly + čárka + přesně tři číslice“ (`1,500`, `185,125`)
  je ale nejednoznačný — může jít o 1.5 i o 1500 — a parser ho **odmítne
  chybou** s výzvou napsat desetinnou tečku. Jednoznačné tvary projdou:
  `1,234.56` i `1.234,56` = 1234.56, `1,234,567` = 1234567. Rozhoduje sdílená
  `isAmbiguousThousandGroup`.
  (Dřív se čárka vždy brala jako oddělovač tisíců, takže `0,001` BTC se tiše
  naimportovalo jako 1 kus — tisícinásobek.)
- **Tečka je vždy desetinná** (`1.500` = 1.5) a ten výklad se podle zbytku
  souboru nemění — kdo po chybě na `1,500` opraví jedinou buňku na `1.500`,
  musí dostat 1,5. Když ale ostatní čísla v souboru prokazatelně píšou
  desetinnou čárku (`detectDecimalSeparator` nad číselnými sloupci), dostane
  taková buňka **varování**, že mohlo jít o oddělovač tisíců
- **Text místo čísla** (`1 250 Kč`, `$185.50`) je chyba řádku s českou větou,
  jménem sloupce a hodnotou. Chyby validace modelu se vypisují stejně: sloupec
  šablony a zpráva, u prázdných povinných polí seznam chybějících sloupců

## Ověření na reálných datech (akceptace F2)

Vlož své reálné exporty do `packages/importers/test/fixtures/real/` (gitignored)
a spusť `pnpm --filter @danero/importers test` — test `real.test.ts` je zpracuje,
vypíše souhrn (transakce/chyby/varování, výsledek enginu za rok 2025) a selže,
pokud jakýkoli řádek skončí chybou.
