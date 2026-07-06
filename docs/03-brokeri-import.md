# Importní vrstva: brokeři a kanonický model

Stav rešerše: červenec 2026. MVP = **Trading212**; architektura rozšiřitelná o další brokery (pořadí: IBKR → XTB → Degiro → Fio).

## Kanonický model transakcí

Každý importér (parser) převádí data brokera na jednotný kanonický model — engine nikdy nevidí formát brokera. Po vzoru Portfolio Performance a Export-To-Ghostfolio (Apache-2.0, TypeScript — referenční implementace converterů pro 26 brokerů).

Typy kanonických transakcí:

| Typ | Poznámka |
|---|---|
| `BUY` / `SELL` | množství, cena/ks, měna, poplatky, FX kurz brokera, trade date + **settlement date** (klíčové pro časový test — pokud broker neuvádí, dopočítat T+1 US od 5/2024, T+2 EU, konfigurovatelně) |
| `DIVIDEND` | brutto částka, měna, srážková daň, země zdroje (z ISIN) |
| `INTEREST` | úroky z hotovosti (§ 8) |
| `FEE` | samostatné poplatky (konektivita, výpisy…) |
| `FX_CONVERSION` | směna měn na účtu |
| `DEPOSIT` / `WITHDRAWAL` | pro úplnost a rekonciliaci |
| `CORPORATE_ACTION` | podtypy: `SPLIT`, `ISIN_CHANGE`, `MERGER`, `SPINOFF`, `DELISTING` — **první-třídní entita**, transformuje loty **bez resetu data nabytí** (dle pravidel R4 v docs/02) |

Zásady:
- **Mapování dle hlaviček, ne pozic sloupců** (T212 mění sadu sloupců podle zvolených kategorií exportu).
- **Deduplikace**: hash (broker, typ, čas, ISIN, množství, cena, měna) — exporty mají roční limity, uživatel nahrává překrývající se soubory; import je idempotentní.
- **Kompletní historie od prvního nákupu je povinná** — bez ní nelze FIFO ani časový test. Onboarding to musí vynutit a zvalidovat (viz rekonciliace).
- Uchovávat **surová data** importu (raw řádek) pro audit a re-parsování při opravě parseru.
- Import batch: stav, chyby per řádek, náhled před potvrzením.

## Trading212 (MVP)

**CSV export** (Menu → History → Export, web i mobil):
- Kategorie: Orders, Dividends, Transactions, Interest — sada sloupců se mění dle výběru.
- Známé sloupce: `Action`, `Time` (UTC), `ISIN`, `Ticker`, `Name`, `No. of shares`, `Price / share`, `Currency (Price / share)`, `Exchange rate`, `Result`, `Total`, `Withholding tax`.
- Limity: max 1 kalendářní rok na export → dedupe nutná; UTF-8; časy UTC.
- ⚠️ **Corporate actions v exportu zcela chybí** — viz rekonciliace níže.
- Referenční parsery: `pkpio/trading212-csv` (Python), converter v Export-To-Ghostfolio (TS).

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

## Další brokeři (post-MVP, priorita sestupně)

| Broker | Formát | Klíčové poznámky |
|---|---|---|
| **IBKR** | Flex Query **XML** + Flex Web Service (token + query ID, HTTPS) | Zlatý standard: sekce Trades, CashTransactions, **CorporateActions** (kódy `FS`/`RS` split, `IC` změna ISIN, `SO` spin-off, `TC` merger…), ISIN/conid. Max 365 dní/query, historie ~5 let. Referenční parser: `csingley/ibflex` (Python, MIT). |
| **XTB** | jen **XLSX** z xStation („Full report") | API pro klienty vypnuto 3/2025. Neexportuje měnu instrumentu ani hrubé dividendy v původní měně → nutná vlastní DB instrumentů. Hlavičky CZ/EN. Corporate actions bez explicitních záznamů. |
| **Degiro** | Account.csv + Transactions.csv | Středník, `dd-MM-yyyy`, desetinná čárka, **lokalizované popisy** (CZ/NL/FR slovníky). Corporate actions jako textové párové řádky (`WIJZIGING ISIN`, `FUSIE`) — parser je nesmí interpretovat jako zdanitelný prodej/nákup. Známý defekt: popis rozdělený do 2 řádků (Taxomat neumí → my ano). Dekódování typů: folioinsights.app/guides/degiro-csv-transaction-types. |
| **Fio e-Broker** | CSV **windows-1250**, CZ hlavičky | Sloupce: `Datum obchodu; Směr; Symbol; Cena; Počet; Měna; Objem v CZK; Poplatky v CZK; Objem v USD; …; Text FIO`. Max 1 rok/export. Žádné API pro obchody (Fio API = jen platební účty). Žádný existující open-source parser — mezera. |
| Revolut | PDF/XLSX statements | Bez API; parsery jedou z PDF (`bogdanghervan/revolut-statement`). Nízká priorita. |
| eToro | XLSX (Closed Positions, Account Activity, Dividends) | Max 1 rok/export. |
| Lightyear | CSV (`Date, Type, Ticker, ISIN, Quantity, Price, Currency, Total, Fee, FX Rate`) | Údajně vč. corporate actions — ověřit na vzorku. |
| Portu | PDF/CSV daňové podklady | Fondee generuje hotový daňový výpis → import zbytečný. |

**Fallback pro nepodporované brokery:** univerzální CSV/XLSX šablona (pattern Koinly/Taxomat) — dokumentovaný formát, který si uživatel vyplní sám.

## Tržní data

- **ČNB denní kurzy**: oficiální free API/TXT (`cnb.cz`), denní fixing — pro variantu „přesné kurzy". Cache v DB.
- **Jednotný kurz GFŘ**: statická tabulka per rok (pokyn D-66 za 2024, D-75 za 2025: EUR 24,66 / USD 21,84; nový pokyn každý leden — proces aktualizace v runbooku).
- **Aktuální ceny pozic**: MVP z T212 API (positions obsahují cenu). Nezávislý zdroj (EOD/Yahoo) až post-MVP.
