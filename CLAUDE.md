# Danero — instrukce pro vývoj

Český SaaS hlídač daní z investic (konkurence Taxomatu). Uživatel „Jan" je OSVČ
v paušálním režimu, obchoduje přes Trading212 — je zároveň první testovací uživatel.

## Architektura (monorepo, pnpm + Turborepo, TypeScript)

- `packages/shared` — kanonický model transakcí (Zod v4), Decimal peníze, ISO datumy
- `packages/engine` — **čistý daňový engine bez I/O**; implementuje pravidla
  **R-01…R-11 z `docs/02-danova-pravidla.md`** (závazná specifikace! testy na ně odkazují)
- `packages/importers` — parsery brokerů → kanonický model, dedupe (FNV obsahu),
  T212 API klient, rekonciliace pozic
- `apps/web` — Next.js 16 App Router, Tailwind v4, Better Auth (+2FA), Drizzle;
  lokálně PGlite v `.data/` (migrace při startu), produkčně Postgres přes `DATABASE_URL`

Klíčový invariant: transakce v DB jsou zdroj pravdy, každý výpočet je čistá funkce
a jde reprodukovat od nuly. Engine nikdy nevidí formát brokera.

## Příkazy

```bash
pnpm dev                          # dev server :3000 (obsazený port: PORT=3001)
pnpm build && pnpm typecheck && pnpm test && pnpm lint   # musí být zelené před commitem
pnpm --filter @danero/web db:generate   # nová Drizzle migrace po změně schema.ts
```

Reálná anonymizovaná data Jana: `packages/importers/test/fixtures/real/*.csv`
(gitignored) — `real.test.ts` je automaticky testuje; používej je k verifikaci.

## Pravidla (závazná)

1. **Jazyk: česky mluvíme na uživatele, anglicky programujeme.**
   - **Česky:** všechno, co člověk čte — UI texty, chybové hlášky, e-maily,
     dokumentace, komentáře v kódu, popisy testů (`it('…')`), commit messages.
     A taky dvě věci, které vypadají jako kód, ale uživatel je vidí:
     **URL aplikačních stránek** (`/prihlaseni`, `/zapomenute-heslo`) a
     **`name` atributy formulářových polí** (`heslo`, `jmeno`, `kod`).
   - **Anglicky:** všechny identifikátory bez výjimky — proměnné, funkce, typy,
     sloupce v DB, klíče v JSON odpovědích, interní API routy (`/api/cron/*`),
     názvy souborů, podpříkazy skriptů, id jobů a vstupů v GitHub Actions.
   - **Když váháš:** přečte to uživatel → česky. Zpracovává to stroj → anglicky.
   - ⚠️ Ověřeno bolestí (5. 8. 2026): do kódu se vloudily identifikátory jako
     `hranice`, `smazane`, `akce`, `udrzba` a musely se plošně přepisovat.
     Zbytek repozitáře je důsledně anglický — drž to.
2. **Daňová logika jen podle docs/02** — každé pravidlo má ID R-xx; nové pravidlo
   nejdřív doplň do docs/02 (se zdrojem: paragraf, pokyn GFŘ), pak implementuj,
   testy odkazují na R-xx. Sporné výklady = konfigurační přepínač: **default bezpečný**,
   ale aplikace spočítá a ukáže, co by výhodnější výklad znamenal (+ poctivé riziko).
3. **Žádný daňový žargon v UI bez vysvětlení** jednou větou. Neptej se uživatele na
   nic, co jde zjistit z dat (např. W-8BEN detekujeme ze srážek).
4. **Nikdy nevyžaduj manuální kroky od Jana** během vývoje — všechno ověřuj
   automatizovaně (unit, E2E, curl na běžící instanci, reálné fixtury). Ptej se ho
   jen na produktová rozhodnutí nebo věci vyžadující jeho účty/klíče.
5. **Workflow každého uzavřeného celku**: implementace → testy (unit + E2E kde dává
   smysl) → ověření na běžící lokální instanci → `/code-review` a oprava nálezů →
   případný refaktoring → zelená pipeline → commit na main (česky, věcně).
6. Peníze **výhradně Decimal** (nikdy number), DB `numeric`/string. Datumy ISO stringy.
7. Bezpečnost: broker klíče jen read-only + AES-256-GCM (lib/crypto.ts), žádné
   secrety v kódu (produkce = env, dev = vygenerované v `.data/`), tenancy přes
   userId v každém dotazu.
8. **Identifikace provozovatele NIKDY do kódu** — jméno, IČO, adresa, e-mail
   i telefon jdou z `DANERO_OPERATOR_*` / `DANERO_CONTACT_*` (`lib/contact.ts`).
   Repozitář je veřejný a pod AGPL: cizí self-hoster nemá vozit Janovu
   identitu a hlavně **jednou commitnutá adresa z historie nezmizí** ani po
   přestěhování. Kvůli tomu se 10. 8. 2026 přepisovala historie (148 commitů,
   force push) — podruhé už to nepůjde levně, až budou forky. Hlídá to strážný
   test v `test/email-legal.test.ts` a `/api/health` (`operatorContact`).

## Známé zrady (ověřeno provozem — neobjevuj znovu)

- **PGlite je tolerantnější než produkční Postgres.** `Date` v syrovém `sql`
  fragmentu PGlite spolkne, ale postgres.js ho odmítne („Received an instance of
  Date") — takhle se 6. 8. 2026 dostal do produkce rozbitý import výpisů
  i hodinová záchrana jobů, protože všechny testy jedou na PGlite. Do syrového
  SQL dávej data přes `ts()` z `lib/sql.ts`. Testy citlivé na driver patří do
  `test/postgres-compat.test.ts`, který v CI běží proti opravdovému Postgresu
  (`TEST_DATABASE_URL`; lokálně stačí docker kontejner).
- **Datovou migraci pusť dvakrát, než ji commitneš.** Migrace 0032 přečíslovala
  `dedupe_key` na `<broker>|<otisk>|<pořadí>` a při druhém běhu padala na
  primárním klíči: `ORDER BY dedupe_key` je TEXTOVÉ, takže pořadí 10 leží mezi
  1 a 2 a řádku s desítkou se přidělila dvojka, kterou už měl někdo jiný.
  Chytil to až test proti opravdovému Postgresu s daty z předchozího běhu —
  na PGlite s čerstvou fixturou se to neprojeví. Druhý běh není teorie: obnova
  ze zálohy, ruční spuštění, přesun databáze. Řešení bylo omezit UPDATE jen na
  řádky se starým tvarem klíče (`NOT LIKE '%|%|%'`).
- **PL/pgSQL port `fnv1a64` XORuje CELOU UTF-16 jednotku, ne jen spodní bajt.**
  Osmibitová varianta z migrace 0031 („obsah je stejně ASCII") se u instrumentu
  s diakritikou rozešla s TypeScriptem (`ČEZ`: SQL fd99…, TS 289d…) — a `isin`
  je v modelu obyčejný string, takže si ho uživatel přes univerzální šablonu
  zapíše, jak chce.
- **Ostrý Postgres: docker na tomhle stroji JE** (ověřeno 23. 8. 2026 — `docker ps`
  i `docker images` běží; dřívější poznámka „docker tu není" byla zastaralá
  a `scripts/db.sh backup` si bez něj kontejner s `pg_dump` nepůjčí).
  Když se přesto hodí instance bez Dockeru, jsou nainstalované i klastry
  (`/usr/lib/postgresql/16/bin`): `initdb -D <dir> -U postgres --auth=trust`
  a `pg_ctl -D <dir> -o "-p 55433 -k /tmp/nejaky-kratky-adresar"` (socket delší
  než 107 znaků server odmítne, takže scratchpad na `-k` nestačí).
- **Migrace s víc příkazy se musí dělit `--> statement-breakpoint`.** Bez toho
  je drizzle pošle jako jeden prepared statement a driver odmítne
  (`cannot insert multiple commands into a prepared statement`) — spadne
  **každý test, který si zakládá databázi** (naposledy 154 najednou), takže to
  vypadá jako rozbitý svět, a přitom chybí jeden komentář. Datovou migraci,
  která přepisuje `isin` nebo jiné pole vstupující do dedupe klíče, musí
  doprovodit **přepočet `dedupe_key`** — jinak se tytéž řádky při dalším importu
  téhož výpisu uloží podruhé (vzor: `0031_etoro_derivative_isin.sql`).
- **PGlite**: jediné připojení (zámek!) — proto je auth/DB **líně inicializované**
  a `next build` se DB nesmí dotknout; `serverExternalPackages: ['@electric-sql/pglite','postgres']`
  nutné; testy s PGlite potřebují `{ timeout: 30_000 }`.
- **T212 API**: exporty mají limit ~1 dotaz/min (poll 65 s, trpělivé retry);
  prázdný rok = úplně prázdný soubor; dnešní obchody se do exportu propisují se
  zpožděním (rekonciliace může krátkodobě nesedět); klíč = pár „ID + tajný klíč",
  autentizaci (Basic vs. raw) si `resolveClient` zjišťuje sám; T212 posílá uživateli
  push notifikace o vygenerovaných dokumentech (v UI vysvětleno).
- **T212 CSV**: sloupce mapovat VÝHRADNĚ podle názvů (sada se mění); splity = pár
  řádků `Stock split close/open`; spin-off = příjem kusů s cenou 0; GBX = pence → GBP/100.
- **Broker přejmenuje sloupec a rozbije import ÚPLNĚ — a testy o tom mlčí.**
  9. 8. 2026 udělal T212 z `Time` sloupec `Time (UTC)`. Autodetekce v
  `import-service.ts` měla VLASTNÍ kopii podmínky (`headers.includes('Time')`),
  takže soubor propadl přes všechny sniffery až na univerzální šablonu a Jan
  naostro četl „Chybí povinný sloupec type“ — hlášku parseru, se kterým jeho
  soubor nemá nic společného. Platilo to pro ruční nahrání i API sync (jedna
  autodetekce). Celá sada byla přitom zelená, protože fixtury měly starý název.
  Odtud tři pravidla: (1) každý broker má **jediný sniffer** sdílený detekcí
  i parserem (`sniffTrading212Csv`, `sniffFioCsv`) — žádnou podmínku
  nekopíruj do `import-service.ts`; (2) alternativní názvy téhož sloupce patří
  do konstanty (`TRADING212_TIME_COLUMNS`) a čtou se přes `HeaderMap.getAny`;
  (3) nepoznaný soubor musí vypsat, **co v hlavičce našel**, ne hlášku cizího
  parseru — jinak je příčina z chyby neuhodnutelná. Fixtura pro nový formát
  patří i do `test/import-detect.test.ts` (routing) a do E2E uploadu.
- **Placenou hranici musí být vidět DŘÍV, než do ní uživatel investuje práci.**
  Formulář pro napojení brokera se do 9. 8. 2026 zobrazoval i bez předplatného
  a odmítnutí přišlo až po odeslání — uživatel si mezitím u brokera vygeneroval
  klíč. Nastavení hlídacích e-mailů bylo horší: přepínače fungovaly, ale
  rozesílku dělá `api/cron/notify` jen platícím, takže e-mail prostě nikdy
  nepřišel a nikde nebylo proč. Stránka si proto musí `resolveEntitlements`
  načíst sama; server action zůstává jako backstop, ne jako jediná obrana.
  Hlídá to `pnpm --filter @danero/web test:e2e:paywall` (vlastní konfigurace,
  protože `DANERO_BILLING=stripe` by zbytku E2E zamkl funkce).
- **Zod v4**: `.default()` bere OUTPUT hodnotu (u Decimal polí `.default(ZERO)`).
- **Better Auth**: drizzle schéma musí přesně sedět na plugin (twoFactor vyžaduje
  i `verified`, `failedVerificationCount`, `lockedUntil` — při přidávání pluginů
  čti `node_modules/better-auth/dist/plugins/*/schema.mjs`).
- **Better Auth `callbackURL`**: patří JEN k registraci (určuje, kam vede odkaz
  z ověřovacího e-mailu; bez něj vede na `/`). U přihlášení ho neposílat —
  klient na něj skočí i po ÚSPĚŠNÉM loginu a přihlášení skončí jinde, než má.
  `sendOnSignIn` z téhož důvodu nepoužíváme (cíl odkazu mu nejde předat) —
  nový odkaz posílá UI přes `sendVerificationEmail`. Nepotvrzený účet poznávej
  podle kódu `EMAIL_NOT_VERIFIED`, ne podle stavu 403: na 403 končí i neshoda
  originu (`BETTER_AUTH_URL` vs. doména) a ta by se pod tou hláškou schovala.
- **E2E e-maily**: `DANERO_EMAIL_LOG=cesta` přesměruje odesílání do souboru
  (nastavuje jen Playwright) — testy pak klikají na skutečný odkaz z e-mailu
  místo obcházení ověření. Stejný mechanismus mají unit testy (`test/auth-helpers.ts`).
- **Kurzy**: jednotné kurzy v `apps/web/lib/tax-config.ts` jsou zatím ORIENTAČNÍ
  (přesný jen 2025 dle D-75) — výdaj se přepočítává kurzem roku nákupu!
- `pkill` nezabije `next start` — použij `fuser -k PORT/tcp`.
- Next 16 odmítne druhý `next dev` nad stejným adresářem (zámek v `distDir/dev/lock`,
  i na jiném portu) — když už dev server běží (třeba jiná session), E2E pusť
  s odděleným distDir: `NEXT_DIST_DIR=.next-e2e pnpm test:e2e`. Alternativa
  `pnpm test:e2e:prod` (build + `next start`) funguje, ale server actions v ní
  mají občasné mnohasekundové latence (lokální kuriozita `next start` + PGlite;
  produkce běží na Postgres) — sada pak flakuje na 15s expect timeoutech.
- E2E timeouty jsou těsné (15 s) — na vytíženém stroji (souběžná session, load > 5)
  sada náhodně padá; spouštěj při klidu, pády ověř rerunnem konkrétního specu.
  Totéž platí pro **unit testy webu**: při load > 10 padalo i 60 nesouvisejících
  testů (PGlite zámek), a přitom každý soubor sám prošel. Řešení není rerun
  dokola, ale `pnpm --filter @danero/web exec vitest run --no-file-parallelism`.
- Po neúspěšném syncu se nesmí nastavit `lastSyncedAt` (jinak se plná historie už nestáhne).
- **Lokalizaci čísel řeš přes `detectDecimalSeparator` nad CELÝM souborem**
  (`packages/importers/src/csv.ts`), nikdy větvením per hodnota. `1.000` je
  v holandském exportu Degira tisíc kusů a v anglickém jedna celá nula; Degiro,
  Revolut i Saxo si to každý hádaly po svém a mlčky — tisícinásobek se propsal
  do nabývací ceny i do limitů. Když soubor důkaz nedá, **řekni to varováním**,
  nehádej potichu.
- **Sniffer musí být PODMNOŽINA toho, co vyžaduje jeho parser.** Přísnější
  sniffer znamená, že soubor, který umíme přečíst, propadne na univerzální
  šablonu a uživatel čte hlášku cizího parseru. Našlo se to šestkrát naráz
  (Anycoin, Coinbase, Portu, Revolut ×2, Tastytrade) — ideálně ať obojí volá
  tutéž funkci (`findCoinbaseHeaderLine`, `detectLanguage` u Saxa).
- **Formát souboru poznávej z obsahu, ne z přípony** (`src/formats.ts`):
  tlačítko v portálu se jmenuje „XLS" a doručí XLSX, Kraken i XTB posílají ZIP,
  uživatel nahraje PDF. Prázdný soubor kontroluj po dekódování — samotné BOM
  nebo nový řádek projde kontrolou na nulovou délku a skončí jako
  „0 transakcí, 0 chyb".
- **Nové pole v modelu transakce se do UŽ NAIMPORTOVANÝCH dat nedostane.**
  Dedupe je obsahový (B-3-2), takže opakované nahrání téhož výpisu je duplicita
  a payload zůstane starý. Vždy to napiš do nápovědy („vrať import zpět a nahraj
  znovu") — tak to má R-07h i R-13. Do 13. 8. 2026 tam stálo „dávku smaž",
  jenže tlačítko v historii maže jen ZÁZNAM o importu a transakce nechává
  (smazat je nešlo vůbec nijak) — rada tedy nefungovala. Dnes `undoImportAction`
  smaže dávku i s jejími transakcemi.
- **Výpis, který nepřečteme, si necháváme** (`lib/failed-imports.ts`, tabulka
  `failed_imports`): originál je jediný způsob, jak formát doplnit, a bez něj
  se informace ztratí — nepoznaná hlavička není výjimka, takže o ní neví ani
  log. **Obsah souboru se ukládá celý** (base64 v `content`) — do e-mailu jde
  jen hlavička a chybová hláška (ta smí citovat jednu buňku; /soukromi to tak
  říká, měň obojí naráz). Provozovateli chodí upozornění na
  `DANERO_ALERT_EMAIL`, a když není nastavená, na `DANERO_CONTACT_EMAIL`
  (běžný stav); uživatel v `/import` vidí, že se na to koukneme, a může doplnit
  platformu. Rozbor a doimport dělá `pnpm --filter @danero/web failed-imports`
  (`list`/`dump`/`retry`/`reject`). Schovává se jen selhání, kde může být vada
  naše: nepoznaný formát **a nově i parser, který se rozeběhl a nevydal jedinou
  transakci** (přesně tak vypadal přejmenovaný sloupec T212 z 9. 8. 2026).
  Prázdný soubor, PDF ani useknutý přenos ne — to je `unrecognized: false`.
- **Id od brokera není univerzální identifikátor události.** Jako druhá síť pod
  obsahovým dedupe (eToro a MT tutéž událost popisují dvakrát s jinak
  zaokrouhlenou cenou) se smí použít jen tam, kde je doloženě per transakce —
  seznam je v `dedupe.ts`. Degiro tam dává číslo OBJEDNÁVKY a ta se plní i pár
  dní: druhé plnění v pozdějším exportu by se zahodilo jako „už uložené".
- **Český text nepiš přes shell heredoc.** `node - <<'EOF'` (a `cat` s českým
  obsahem) uloží diakritiku jako literální `č` escapy — v komentářích je to
  nečitelné, v šablonových řetězcích to projde testy a nikdo si toho nevšimne.
  Na české texty používej editační nástroj.

## Stav a plán

Aplikace je funkčně kompletní (fáze F, G i H), ověřená na reálném účtu.
Od 3. 8. 2026 je kód open source (AGPL-3.0) a hostovaná služba běží na danero.cz
— pravidla přispívání v `CONTRIBUTING.md`, hranice zdarma/placené a harmonogram
spuštění v interním repozitáři `danero-interni` (`docs/15-open-source.md`).

**Plány, marketing, audity a deník žijí v privátním repozitáři `danero-interni`**
— průběh a poznámky zapisuj tam, ne sem. Rozcestník je jeho `README.md`;
prakticky potřebuješ `docs/27-zbyva-opravit.md` (akční backlog) a `docs/DENIK.md`.
Dokončená práce (staré plány, audity 1 a 2) je v `docs/archiv/`.
