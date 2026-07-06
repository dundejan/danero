# Import: formáty a chování (`@danero/importers`)

## Zásady (implementace docs/03)

- Parsery mapují **podle názvů sloupců**, nikdy podle pozic — brokeři mění sadu i pořadí.
- Výstupem je vždy `ImportResult`: kanonické transakce + `errors` (řádky k opravě),
  `skipped` (vědomě vynechané) a `warnings` (zpracováno s výhradou).
- **Deduplikace**: `dedupeKey(broker, tx)` je stabilní otisk obsahu (FNV-1a 64).
  Překrývající se roční exporty tak lze nahrávat opakovaně — import je idempotentní.
  Limity: dvě fyzicky identické transakce v souboru bez ID sloupce se sloučí (parser
  na to upozorní varováním); tentýž obchod v souboru s ID a bez ID se nesloučí.
- Datum obchodu = datum z exportu (UTC); datum vypořádání engine dopočítává
  (T+1 US od 28. 5. 2024, jinak T+2, pracovní dny bez svátků), pokud ho export neuvádí.

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
| `…interest…` | INTEREST | Total + měna |
| `Deposit` / `Withdrawal` | DEPOSIT / WITHDRAWAL | evidence, engine je ignoruje |
| `Currency conversion` | přeskočeno | pro výpočet není potřeba |
| jiné | error řádek | nahlásit, doplníme podporu |

⚠️ **Export neobsahuje korporátní akce** (splity, změny ISIN) — řeší rekonciliace níže.

## Trading212 API (`Trading212Client`)

Read-only klíč: Settings → API (Beta). Klient: `getCash()` (ověření klíče),
`getPositions()` + `getInstruments()` (rekonciliace, ticker→ISIN),
`requestExport()`/`fetchHistoryCsv()` (vygenerování CSV historie → stejný parser).
Autentizace: klíč v hlavičce `Authorization`; s `apiSecret` HTTP Basic — ověřit na účtu.
429 se opakuje dle Retry-After (3 pokusy).

## Rekonciliace (`reconcilePositions`)

Porovná vypočtené pozice (engine `positionsAt`) s pozicemi z API per ISIN:

- `QUANTITY_MISMATCH` + návrh poměru splitu (nejmenší p:q ≤ 20, `remaining × to/from`),
  ze kterého UI předvyplní `CORPORATE_ACTION SPLIT`;
- `MISSING_LOCALLY` (broker má, my ne → chybí historie nebo změna ISIN);
- `MISSING_AT_BROKER` (my máme, broker ne → chybí prodej/převod nebo změna ISIN).

## Univerzální šablona (`parseUniversalCsv`)

Fallback pro nepodporované brokery. Hlavičky (malými písmeny, pořadí libovolné):

```csv
type,date,settlement_date,isin,ticker,name,quantity,price,currency,fee,fee_currency,amount,withholding_tax,source_country,note
BUY,2024-01-10,2024-01-12,US0378331005,AAPL,Apple Inc,10,185.50,USD,2.10,CZK,,,,
SELL,2025-03-05,,US0378331005,AAPL,Apple Inc,10,210.00,USD,3.00,CZK,,,,
DIVIDEND,2025-04-01,,US0378331005,AAPL,,,,USD,,,2.50,0.38,US,
INTEREST,2025-05-01,,,,,,,CZK,,,12.34,,GB,úrok na hotovosti
DEPOSIT,2024-01-05,,,,,,,CZK,,,10000,,,
```

- `type`: BUY, SELL, DIVIDEND, INTEREST, FEE, DEPOSIT, WITHDRAWAL
- BUY/SELL: povinné `isin, quantity, price, currency`; `settlement_date` důrazně
  doporučeno (přesnost časového testu)
- DIVIDEND: `amount` = **brutto**, `withholding_tax` v téže měně, `source_country`
  (jinak se odvodí z ISIN)
- INTEREST/FEE/DEPOSIT/WITHDRAWAL: `amount` + `currency`
- Desetinná tečka; datum `YYYY-MM-DD`; kódování UTF-8

## Ověření na reálných datech (akceptace F2)

Vlož své reálné exporty do `packages/importers/test/fixtures/real/` (gitignored)
a spusť `pnpm --filter @danero/importers test` — test `real.test.ts` je zpracuje,
vypíše souhrn (transakce/chyby/varování, výsledek enginu za rok 2025) a selže,
pokud jakýkoli řádek skončí chybou.
