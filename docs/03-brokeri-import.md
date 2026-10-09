# Importní vrstva: brokeři a kanonický model

Stav rešerše: červenec 2026. MVP = **Trading212**; architektura rozšiřitelná o další brokery (pořadí: IBKR → XTB → Degiro → Fio).

> Dokument je **dobový snímek rešerše**, ne přehled toho, co aplikace umí dnes. Které platformy a jakým způsobem čteme, říká výhradně katalog `apps/web/lib/brokers-catalog.ts`. Postup, jak přidat nový formát, je v [CONTRIBUTING.md](../CONTRIBUTING.md#přidání-brokera) (oddíl „Přidání brokera“); zásady a chování importní vrstvy popisuje [docs/06](06-import.md). Oddíl o kanonickém modelu níže je s kódem srovnaný (říjen 2026), ale je to jen přehled — závazná definice modelu je `packages/shared/src/model.ts`.

## Kanonický model transakcí

Každý importér (parser) převádí data brokera na jednotný kanonický model — engine nikdy nevidí formát brokera. Po vzoru Portfolio Performance a Export-To-Ghostfolio (Apache-2.0, TypeScript — referenční implementace converterů pro 26 brokerů).

Typy kanonických transakcí (úplný výčet polí je v `packages/shared/src/model.ts`):

| Typ | Poznámka |
|---|---|
| `BUY` / `SELL` | množství, cena/ks, měna, poplatek, datum obchodu + volitelné **datum vypořádání** (klíčové pro časový test — když ho broker neuvádí, dopočítá ho engine: T+1 US od 28. 5. 2024 a Kanada od 27. 5. 2024, jinak T+2 v obchodních dnech burzy; krypto a deriváty mají vlastní pravidla). Kurz brokera se neukládá — na koruny se přepočítává jednotným kurzem GFŘ nebo denním kurzem ČNB (R-06 v docs/02). |
| `DIVIDEND` | brutto částka (před zahraniční srážkou, R-07b v docs/02), měna, srážková daň, země zdroje (z ISIN). Kde výpis uvádí jen čistou částku, složí brutto parser — viz Trading212 níže. |
| `INTEREST` | úroky z hotovosti (§ 8) |
| `FEE` | samostatné poplatky (konektivita, výpisy…) |
| `FX_CONVERSION` | směna měn na účtu |
| `DEPOSIT` / `WITHDRAWAL` | pro úplnost a rekonciliaci |
| `CORPORATE_ACTION` | podtypy: `SPLIT`, `ISIN_CHANGE`, `MERGER`, `SPINOFF`, `DELISTING` — **první-třídní entita**, transformuje loty; kdy zůstává datum nabytí, určují pravidla R-04 v docs/02 (split a změna ISIN ho zachovávají, nové kusy ze spin-offu ne) |
| `TRANSFER_IN` / `TRANSFER_OUT` | převod kusů mezi brokery — není to nákup ani prodej a časový test nepřerušuje (R-04i v docs/02). `TRANSFER_IN` může nést původní datum a cenu nabytí; bez nich má lot nulovou nabývací cenu a test běží až od převodu. |

Zásady:
- **Mapování dle hlaviček, ne pozic sloupců** (T212 mění sadu sloupců podle zvolených kategorií exportu).
- **Deduplikace**: klíč má tvar `<broker>|<otisk obsahu>|<pořadí>` (`packages/importers/src/dedupe.ts`). Otisk se počítá jen z polí, která popisují událost — u obchodu typ, ISIN, **den** obchodu, množství, cena za kus a měna — ne z času ani z id řádku; obsahově shodné události z jednoho výpisu odlišuje pořadí. Exporty mají roční limity, uživatel nahrává překrývající se soubory; import je idempotentní.
- **Kompletní historie od prvního nákupu je povinná** — bez ní nelze FIFO ani časový test. Prodej bez evidované pozice hlásí engine jako chybu `NEGATIVE_POSITION`, počty kusů proti brokerovi hlídá rekonciliace.
- **Surový řádek výpisu se neukládá** — v tabulce `transactions` je jen kanonická transakce (`payload`). Oprava parseru ani nové pole modelu se proto do už naimportovaných dat samy nedostanou: import je třeba vrátit zpět a výpis nahrát znovu. Originál si necháváme jen u výpisu, který se nepodařilo přečíst (`failed_imports`).
- **Dávka importu** (`import_batches`) drží počty přidaných a duplicitních transakcí a hlášení k řádkům (chyby, přeskočené, varování). Zapisuje se rovnou, bez náhledu a potvrzení; dávku jde vrátit zpět i s jejími transakcemi.

## Trading212 (MVP)

**CSV export** (Menu → History → Export, web i mobil):
- Kategorie: Orders, Dividends, Transactions, Interest — sada sloupců se mění dle výběru.
- Známé sloupce: `Action`, `Time` (UTC), `ISIN`, `Ticker`, `Name`, `No. of shares`, `Price / share`, `Currency (Price / share)`, `Exchange rate`, `Result`, `Total`, `Withholding tax`.
- ⚠️ **U dividendy je `Price / share` ČISTÁ částka na kus** — vyhlášená dividenda už po
  zahraniční srážce (ověřeno na reálných exportech 10/2026: kusy × cena sedí na připsané
  `Total`, na částku před srážkou ani jednou). Brutto pro § 8 (R-07b v docs/02) je proto
  **kusy × `Price / share` + `Withholding tax`**, obojí v měně instrumentu. Srážka v jiné
  měně se nezapočítá ani k brutto nepřičte a parser na ni upozorní; starší řádky bez kusů
  a ceny mají brutto odhadnuté z čisté `Total` s varováním. Takto složená dividenda nese
  v modelu značku `grossFromNet` — do dedupe klíče nevstupuje a slouží jen k rozlišení
  od dividend uložených dřív, kdy se cena brala jako brutto a příjem vycházel nižší o srážku.
- Limity: max 1 kalendářní rok na export → dedupe nutná; UTF-8; časy UTC.
- ✅ **Oprava (ověřeno na reálném exportu 7/2026):** korporátní akce v exportu JSOU —
  splity jako pár řádků `Stock split close`/`Stock split open`, spin-off jako řádek
  `Spin off` (příjem kusů s cenou 0). Změny ISIN/fúze nepozorovány → rekonciliace
  přes API zůstává jako pojistka. Původní rešerše (i praxe Taxomatu) tvrdila opak.
- Referenční parsery: `pkpio/trading212-csv` (Python), converter v Export-To-Ghostfolio (TS).
- Dedupe (původní omezení už neplatí): sloupec `ID` do klíče nevstupuje — klíč
  je otisk obsahu, viz zásady výše. Týž obchod ve starém exportu bez `ID`
  a v novém s `ID` se proto spáruje. Dva řádky se stejným `ID` a stejným obsahem
  splynou v jednu transakci, obsahově shodné řádky bez `ID` se importují každý
  zvlášť; na obojí parser upozorní.
- ⚠️ Plný sync končí po 2 po sobě prázdných letech (API nezná datum založení
  účtu) — účet s ≥2letou pauzou v obchodování si starší historii doplní ručním
  CSV; nesoulad odhalí rekonciliace pozic.

**API** ([docs.trading212.com/api](https://docs.trading212.com/api)):
- Klíč: Settings → API (Beta), API Key + Secret, granularitní **read-only** oprávnění, volitelné IP restrikce. Autentizace pravděpodobně HTTP Basic — **ověřit prakticky na vlastním účtu** (starší v0 posílalo klíč přímo v `Authorization`).
- Base URL `https://live.trading212.com/api/v0`; historické endpointy (orders, dividends, transactions) s cursor paginací; rate limity v response hlavičkách.
- Účty Invest + ISA (ne CFD). Umí i **aktuální pozice portfolia** → základ rekonciliace.
- Alternativně `POST /history/exports` → async vygenerování CSV → download link.

**Rekonciliace korporátních akcí (naše diferenciace):**
1. Engine spočítá očekávané pozice z transakcí.
2. Porovnání s reálnými pozicemi z T212 API.
3. Nesedí-li počet kusů → upozornění + průvodce ručním zadáním korporátní akce (split/ISIN change) s předvyplněným poměrem odhadnutým z rozdílu.
4. Volitelně později: externí databáze splitů (EOD API) pro automatický návrh.

## Další brokeři (historická rešerše z července 2026)

Tabulka zachycuje, co jsme o formátech věděli před implementací, a původní pořadí priorit. **Není to seznam podporovaných platforem** — parserů mezitím přibylo víc, než kolik jich tu je, a aktuální stav (platforma, způsob importu, návod ke stažení výpisu) vede jen katalog `apps/web/lib/brokers-catalog.ts`. Než začneš psát nový parser, podívej se do něj a do `packages/importers/src/`. Postup je v [CONTRIBUTING.md](../CONTRIBUTING.md#přidání-brokera) (oddíl „Přidání brokera“: parser, fixtura, registrace v autodetekci a v katalogu); zásady, které parser musí splnit, shrnuje [docs/06](06-import.md).

| Broker | Formát | Klíčové poznámky |
|---|---|---|
| **IBKR** | Flex Query **XML** + Flex Web Service (token + query ID, HTTPS) | Zlatý standard: sekce Trades, CashTransactions, **CorporateActions** (kódy `FS`/`RS` split, `IC` změna ISIN, `SO` spin-off, `TC` merger…), ISIN/conid. Max 365 dní/query, historie ~5 let. Referenční parser: `csingley/ibflex` (Python, MIT). |
| **XTB** | jen **XLSX** z xStation — starý „Full report" i nový report z tlačítka „Export (new)" | API pro klienty vypnuto 3/2025. Neexportuje měnu instrumentu ani hrubé dividendy v původní měně → nutná vlastní DB instrumentů. Hlavičky CZ/EN. Corporate actions bez explicitních záznamů. **Nový report (ověřeno na reálném souboru 10/2026) má jiné rozložení:** listy `Closed Positions` / `Cash Operations` / `Open Positions`, sloupec `Ticker` místo `Symbol`, typy `Stock purchase` / `Stock sell` / `SEC fee`, časy jako excelová data v UTC, pod tabulkou řádek `Total`. Měna účtu je jen v souhrnu na listu otevřených pozic (a v názvu souboru). Pozice, kterou XTB uzavřel sám (`Close Origin` = `Correction`, např. odpis bezcenného titulu s komentářem „… Worthless"), je pouze v `Closed Positions` a nemá peněžní operaci → parser na ni jen **upozorní** a nic neimportuje; daňové zacházení zatím docs/02 neřeší. Obchod ani dividenda titulu bez ISIN se neukládá, dokud ho uživatel nedoplní v číselníku (dividenda uložená bez ISIN se po jeho doplnění a novém nahrání zdvojila — ISIN je součást obsahového otisku). `Cash Operations` pokrývá jen zvolené období — nákupy starších lotů v něm nejsou, uživatel musí exportovat od založení účtu. Českou jazykovou verzi nového reportu jsme zatím neviděli. |
| **Degiro** | Account.csv + Transactions.csv | Středník, `dd-MM-yyyy`, desetinná čárka, **lokalizované popisy** (CZ/EN/NL/DE/FR slovníky). Corporate actions jako textové párové řádky (`WIJZIGING ISIN`, `FUSIE`, `AANDELENSPLITSING`, `STOCK SPLIT`, `Štěpení akcií`, `Aktiensplit`, `Division d'actions`, reverse split) — parser je nesmí interpretovat jako zdanitelný prodej/nákup. Split (i reverzní) = `SPLIT` s poměrem z počtů kusů v obou popisech; spin-off (`SPIN-OFF`, `Afsplitsing`, `Abspaltung`, `Scission`) skončí **chybou k ručnímu doplnění** — alokaci nabývací ceny výpis neuvádí. **Nerozpoznaný popis je vždy chyba, i když řádek nemá peněžní pohyb** (přesně tak Degiro reportuje korporátní akce — dřív takový řádek mizel beze stopy). Známý defekt: popis rozdělený do 2 řádků (Taxomat neumí → my ano). Dekódování typů: folioinsights.app/guides/degiro-csv-transaction-types. |
| **Fio e-Broker** | CSV **windows-1250**, CZ hlavičky | Sloupce: `Datum obchodu; Směr; Symbol; Cena; Počet; Měna; Objem v CZK; Poplatky v CZK; Objem v USD; …; Text FIO`. Max 1 rok/export. Žádné API pro obchody (Fio API = jen platební účty). Žádný existující open-source parser — mezera. |
| Revolut | „Account statement“ jako CSV nebo XLSX (akcie i krypto) | Bez API. Rešerše počítala s PDF (`bogdanghervan/revolut-statement`) a nízkou prioritou; **dnes je parser hotový** (`packages/importers/src/revolut/`) a čte CSV i sešit XLSX, PDF ne. |
| eToro | XLSX (Closed Positions, Account Activity, Dividends) | Max 1 rok/export. |
| Lightyear | CSV (`Date, Type, Ticker, ISIN, Quantity, Price, Currency, Total, Fee, FX Rate`) | Údajně vč. corporate actions — ověřit na vzorku. |
| Portu | CSV export transakcí | Rešerše import pokládala za zbytečný (počítala s hotovými daňovými podklady od platformy); **dnes je parser hotový** (`packages/importers/src/portu/`) a čte CSV export transakcí. |

**Fallback pro nepodporované brokery:** univerzální CSV šablona (pattern Koinly/Taxomat) — dokumentovaný formát, který si uživatel vyplní sám. Šablona je jen v CSV (`/api/sablona`, popis sloupců v [docs/06](06-import.md)); XLSX čteme pouze u reportů, které mají vlastní parser.

## Tržní data

- **ČNB denní kurzy**: oficiální free API/TXT (`cnb.cz`), denní fixing — pro variantu „přesné kurzy". Cache v DB.
- **Jednotný kurz GFŘ**: statická tabulka per rok (pokyn D-66 za 2024, D-75 za 2025: EUR 24,66 / USD 21,84; nový pokyn každý leden — proces aktualizace v runbooku).
- **Aktuální ceny pozic**: MVP z T212 API (positions obsahují cenu). Nezávislý zdroj (EOD/Yahoo) až post-MVP.
