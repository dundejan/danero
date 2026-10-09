# Provoz a nasazení

## Lokální vývoj

```bash
pnpm install && pnpm dev   # → http://localhost:3000
```

Bez konfigurace: DB je PGlite v `apps/web/.data/` (migrace při startu), auth secret
a šifrovací klíč se vygenerují do `.data/` (gitignored). Reset = smazat `.data/`.

## Produkce (Vercel + Neon)

1. **Neon**: projekt v regionu EU (Frankfurt) → `DATABASE_URL`. Aplikace jede přes
   **pooled** řetězec (proto `prepare: false`), migrace přes **přímý** —
   transakční pooler si s DDL nerozumí.
2. **Vercel**: projekt s root directory `apps/web` (monorepo, pnpm). Funkce region `fra1`.
3. **Env proměnné** (viz `.env.example`). Povinné: `DATABASE_URL`,
   `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (produkční URL),
   `DANERO_ENCRYPTION_KEY`, `CRON_SECRET`. Každá ale chybí jinak hlasitě:

   - bez `BETTER_AUTH_SECRET` nebo `BETTER_AUTH_URL` aplikace naběhne
     a `/api/health` je zelený, ale přihlášení, registrace i každá stránka za
     přihlášením končí chybou, která proměnnou jmenuje (`lib/auth.ts`) —
     ozve se to tedy hned při prvním pokusu o přihlášení,
   - bez `DANERO_ENCRYPTION_KEY` aplikace běží a `/api/health` je zelený.
     Chyba, která proměnnou jmenuje (`lib/crypto.ts`), přijde až ve chvíli,
     kdy se ukládá nebo čte klíč brokera — typicky když první uživatel
     napojuje účet; ten uvidí jen obecnou chybu, jméno proměnné je v logu
     serveru. Běžící aplikace a zelený health tedy nejsou důkaz, že klíč
     nastavený je,
   - bez `CRON_SECRET` aplikace běží a `/api/health` je zelený, jenže všechny
     `/api/cron/*` vracejí 401 — nejede tedy sync, kurzy, hlídací e-maily ani
     úklid, a poznat je to jen z logu podle `cron.<job>.unauthorized`,
   - bez `DATABASE_URL` aplikace nespadne, ale sáhne po lokálním PGlite — to
     je vývojový režim, ne produkce.

   Volitelně `RESEND_API_KEY`, `RESEND_FROM`,
   `DANERO_TRUSTED_PROXIES` (viz níž) a `DANERO_SUPPORT_IBAN` /
   `DANERO_SUPPORT_URL` pro dobrovolný příspěvek na `/cenik` — bez nich se
   sekce o příspěvku nevykreslí, s překlepem to ohlásí `/api/health`
   (`support: "invalid"`).

   Platby aplikace **nemá** — od 8. 10. 2026 je Danero celé zdarma. Proměnné
   `DANERO_BILLING` a `STRIPE_*` už nic nedělají a z prostředí je smaž; poslední
   stav s platbami je pod značkou `placene-tarify`.
4. **Cron**: `apps/web/vercel.json` definuje **v UTC** (Vercel Cron jiné pásmo
   neumí — v létě je to +2 h, v zimě +1 h pražského času):

   | UTC | Routa | Co dělá |
   |---|---|---|
   | 1:00 denně | `/api/cron/maintenance` | úklid dat po retenční lhůtě |
   | 2:00 denně | `/api/cron/fx` | denní kurzy ČNB |
   | 3:00 denně | `/api/cron/sync-brokers` | sync všech napojených brokerů |
   | 5:00 denně | `/api/cron/notify` | přepočet limitů + upozornění |
   | 13:00 denně | `/api/cron/jobs` | záchranná síť background jobů (denní pojistka) |

   `Authorization: Bearer $CRON_SECRET` posílá Vercel sám.

   **Proč celé hodiny a všechno jen denně:** hostovaná instance běží na
   **Vercel Hobby**. Ten dovolí cron nejvýš jednou za den (častější výraz
   shodí celé nasazení) a spouští ho **kdykoli během zadané hodiny**
   (`0 3 * * *` = někdy mezi 3:00 a 3:59). Pořadí kurzy → sync → upozornění
   proto drží jen rozestup celých hodin. Hlídá to `test/hosting-limits.test.ts`.

   Záchranný cron jobů chceme častěji než denně — volá ho proto **každou
   hodinu GitHub Actions** (`.github/workflows/jobs-rescue.yml`; potřebuje
   v repozitáři tajemství `CRON_SECRET` a proměnnou `PRODUCTION_URL`). Když
   workflow neběží, aplikace funguje dál, jen se zaseknutý job dorovná až
   s denní pojistkou. Pozor: GitHub plánovaná workflow ve veřejném repozitáři
   po 60 dnech bez commitu sám vypne a pošle o tom e-mail.

   Notifikační běh je dávkovaný (25 uživatelů na invokaci) a zbytek fronty si
   předává sám dál přes `?offset=` — timeout u 50. uživatele proto neznamená,
   že zbytek ten den nedostane nic.
5. **Za jakou proxy to běží**: rate limit přihlašování se klíčuje podle IP
   klienta z `X-Forwarded-For`. Na Vercelu hlavičku přepisuje edge a cizí IP
   nepropouští, takže výchozí nastavení stačí. Za vlastní proxí (CDN s veřejnými
   adresami) vyjmenuj její rozsahy v `DANERO_TRUSTED_PROXIES` — jinak by se
   klíčovalo podle adresy proxy a všichni by sdíleli jeden kbelík.

## Migrace databáze

**Nespouštějí se ručně.** Řídí je `.github/workflows/migrate.yml`:

- **samy** při pushi do `main`, který mění `apps/web/db/migrations/**`,
- **na vyžádání**: `gh workflow run migrate.yml` (nebo tlačítko „Run workflow";
  volba `status` jen vypíše počty, nic nemění).

Připojovací řetězec je v secretu `PRODUCTION_DATABASE_URL` (přímý, nepoolovaný).
Do logu se nedostane a nikdo ho nemusí mít v terminálu. Workflow běží pod
`concurrency`, takže dvě migrace nad jednou databází nemůžou jet naráz, má
`permissions: contents: read` a **pouští se jen z větve `main`** — `gh workflow
run migrate.yml --ref moje-vetev` skončí hned na prvním kroku.

Před produkcí si workflow tytéž migrace pustí **nanečisto proti prázdné
zkušební databázi** v témže běhu (krok „Zkouška nanečisto“; Postgres
předinstalovaný na runneru, žádný stahovaný obraz). Když migrace do ní
neprojdou, produkce se nedotkne. Chytí to chybu syntaxe, chybějící oddělovač
příkazů a rozbité pořadí; chybu, která závisí na produkčních datech, ne — tu
hlídá jen test datové migrace nad daty z předchozího běhu. Když se zkušební
databázi nepodaří připravit, krok jen varuje a migrace pokračuje: zkouška
nesmí zdržet produkční migraci kvůli něčemu, co s migracemi nesouvisí.

Migruje `apps/web/db/migrate.mjs` (ne `drizzle-kit migrate`): při selhání vypíše
celou chybu včetně SQLSTATE, hlášky a dotazu, na kterém to spadlo. `drizzle-kit`
po sobě nechával ~250 B logu bez jediného vodítka.

⚠️ **Pořadí migrací hlídá `db/check-journal.mjs`** (běží v CI i před migrací).
Drizzle porovnává jen timestamp nejnovější aplikované migrace, nikdy hash —
migrace se starším `when` (dva PR vygenerované paralelně, ten dřívější mergnutý
později) by se na produkci **tiše přeskočila navždy**, ačkoli na čerstvé
databázi v CI projde a `drizzle-kit check` řekne „Everything's fine". Když
kontrola padne: migraci vygeneruj znovu (nebo jí v `_journal.json` zvedni `when`
nad předchozí) a přečísluj soubor.

⚠️ **Migrace jede paralelně s buildem na Vercelu a pořadí nikdo negarantuje**
(M-5). Když deploy vyhraje, nový kód se ptá na neexistující sloupec a stránky
vrací 500; když vyhraje migrace, starý kód běží nad novým schématem (to je
skoro vždy v pořádku). Drž se proto pravidla: **schéma se mění ve dvou krocích**
— nejdřív migrace zpětně kompatibilní se starým kódem (přidat sloupec, ne
přejmenovat), teprve pak kód. Migraci, na kterou nový kód spoléhá (typicky
doplnění dat — třeba 0021), pusť **před** nasazením: `gh workflow run
migrate.yml`, počkat na doběhnutí, teprve pak push kódu.

Ruční zásahy a zálohy: `scripts/db.sh [status|migrate|backup|prune|restore SOUBOR]`. Bere řetězec
z `~/.danero/produkce.env` (řádek `DATABASE_URL_DIRECT=…`, mimo repozitář,
`chmod 600`) a nikdy ho nevypisuje. `prune` databázi nepotřebuje — maže jen staré
soubory záloh.

## Roční runbook

Jediný seznam kroků přelomu roku i s termíny je v docs/02, sekce „Roční údržba
(runbook)“: lednový pokyn o jednotných kurzech, XML pro nový rok, říjnový registr,
listopadové kurzy a svátky, celoroční kontrola novel. Tady se neopakuje — dvě kopie
se už jednou rozešly (tahle znala jen leden).

Kroky s pevným termínem hlídají runbook testy (`apps/web/test/runbook.test.ts`
a `packages/engine/test/runbook.test.ts`): po termínu začnou padat, takže zapomenutou
údržbu ohlásí CI dřív než uživatel.

## Kontroly v CI nad rámec testů

Vedle buildu, typů, lintu a testů hlídá pipeline pár věcí, které test nenapíšeš.
Všechny jdou pustit lokálně stejným příkazem, jaký stojí ve workflow.

- **Job `guards` v `ci.yml`** (bez buildu, jednotky minut, žádná tajemství — běží
  i nad pull requestem z forku):
  - **gitleaks** nad celou historií včetně značek. Doložené falešné poplachy jsou
    v `.gitleaks.toml` (obecné pravidlo v testech) a `.gitleaksignore` (jednotlivé
    otisky). Identitu provozovatele nehledá — tu hlídá `test/email-legal.test.ts`.
  - **actionlint** a **zizmor** nad `.github/workflows/` (zápis workflow, práva
    tokenu, nepřipnuté akce). Obrazy nástrojů jsou připnuté na digest.
  - **knip** (`pnpm knip`, nastavení v `knip.json`): nepoužité soubory
    a závislosti, nevyřešené importy. Nepoužité exporty zatím nehlídá — plná
    kontrola dnes hlásí desítky exportů, které stačí zbavit slova `export`.
- **Fuzz importu** (`packages/importers/test/fuzz.test.ts`, součást `pnpm test`):
  2 000 poškozených variant fixtur s pevným seedem do `decodeUpload`, snifferů
  a všech parserů. Padá na neošetřené výjimce a na volání delším než 2 s
  procesoru. Hlášený případ pustíš znovu přes `FUZZ_ONLY_CASE=<číslo>`, širší
  průzkum přes `FUZZ_CASES=30000` (asi minuta).
- **Práh pokrytí enginu** (`packages/engine/vitest.config.ts`): `pnpm test`
  v enginu měří pokrytí a spadne, když klesne pod práh nastavený o 1–2 body pod
  skutečným stavem. Ostatní balíčky práh nemají.
- **CodeQL** (`codeql.yml`): pull request, push do `main` a týdně. Nálezy se
  objeví na kartě Security → Code scanning; kontrola pull requestu hlásí jen nové.
  Vyžaduje, aby v nastavení repozitáře nebyl zapnutý CodeQL „default setup“ —
  jinak nahrání výsledků z vlastního workflow selže.
- **Mutační testy** (`mutation.yml`, lokálně `pnpm test:mutation`): Stryker nad
  `packages/engine` a `packages/shared`, týdně a ručně. Nic neblokuje, report je
  v artefaktu běhu; běh trvá desítky minut.

- **Známé zranitelnosti** (`pnpm audit --prod` v jobu `guards`): padne, když
  má některá produkční závislost hlášení v databázi GitHubu. Opravuje se
  povýšením balíčku, u nepřímé závislosti přepisem v `pnpm.overrides`
  v kořenovém `package.json`.
  ⚠️ Tři hlášení (audit je vypíše jako čtyři nálezy — jedno zasahuje dva
  balíčky) jsou tam **vědomě ignorovaná** (`pnpm.auditConfig.ignoreGhsas`):
  týkají se Vitestu 3 a jeho `tinypool`, tedy testovacího nástroje, který se do
  nasazené aplikace nedostane. Audit je do „produkčních“ počítá jen proto, že
  si Better Auth Vitest deklaruje jako volitelnou partnerskou závislost.
  Zmizí povýšením na Vitest 4 — to je vlastní práce (jiná hlavní verze pod
  2 400 testy, pokrytím a mutačními testy) a seznam se pak má vyprázdnit.
  Jiné hlášení do něj nepřidávej bez stejného zdůvodnění.

## Zálohy a monitoring (stav)

- Neon: obnova do bodu v čase je součástí, ale sahá jen 6 hodin zpět — na
  cokoli staršího je ruční dump (runbook níž).
- Sentry (`SENTRY_DSN`) — nezapojeno; chyby jsou ve strukturovaných lozích
  a stav hlídá `/api/health` (sekce „Monitoring“ níž).
- E-maily (Resend, `RESEND_API_KEY`) — zapojeno (`apps/web/lib/email.ts`):
  hlídací upozornění, ověření adresy i obnova hesla. V produkci bez klíče
  odeslání skončí chybou, jen ve vývoji se zpráva vypíše do konzole.
  Nastavení domény je v sekci o DNS níž.

## Zálohy a obnova (runbook, G10c)

**Zdroj pravdy jsou transakce** — každý výpočet jde reprodukovat od nuly
(docs/04). Ztráta odvozených dat (notifikace, ceny) je nepříjemnost, ne katastrofa.

### Produkce (Neon)

- **PITR**: Neon drží historii pro obnovu do bodu v čase **jen 6 hodin** —
  v tarifu, na kterém hostovaná instance běží; totéž říká `/soukromi`, měň
  obojí naráz. Po šesti hodinách zbývá jen dump níž, takže o obnově z historie
  se rozhoduje hned, ne druhý den. (Na vlastní instanci platí okno tvého
  tarifu — ověř si ho v Neon Console.) Obnova:
  Neon Console → Branches → „Restore from history" → nový branch k času T →
  přepnout `DATABASE_URL` (nebo `neon branches create --parent main@<timestamp>`).
- **Týdenní logický dump navíc** (nezávislý na Neonu): `scripts/db.sh backup`
  → `zalohy/danero-RRRR-MM-DD.dump` (gitignorováno). Obnova:
  **`scripts/db.sh restore zalohy/danero-RRRR-MM-DD.dump`** (ptá se na
  potvrzení a vypíše stav před i po).

  ⚠️ Do 9. 8. 2026 tu stálo `pg_restore -d "$NEW_URL" --clean danero-X.dump`.
  Na produkčním dumpu to dá **105 chyb a přesto exit 0** — všechny neškodné
  (`role "neondb_owner" does not exist`, vlastnictví z Neonu), jenže právě
  proto by se v nich skutečná chyba ztratila. A `--clean` bez `--if-exists`
  nechá v cíli objekty, které v záloze nejsou: obnova do neprázdné databáze
  skončila míchanicí 1 původního a 16 obnovených uživatelů (nálezy M-3-03,
  F-3-6). Skript používá ověřenou sadu přepínačů:

  ```
  pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error
  ```

  Ověřeno naostro obnovou produkční zálohy do kontejneru s Postgresem 18:
  0 chyb, exit 0, 22 tabulek, 32 migrací, 0 účtů. Chybí-li lokální
  `pg_restore` nebo je starší než server, půjčí si ho skript z obrazu
  `postgres:<verze>-alpine` — stejně jako u zálohy.
- **Retence 8 týdnů běží ve skriptu**, ne v hlavě: po každé úspěšné záloze se
  dumpy starší než `DANERO_BACKUP_RETENTION_DAYS` (výchozích 56) smažou, totéž
  udělá `scripts/db.sh prune` samostatně. `/soukromi` slibuje uživateli, že
  smazaná data zmizí i ze záloh — do 7. 8. 2026 za tím slibem nestál žádný
  mechanismus (nález E-32).
  ⚠️ **Kopie uložené jinam skript neuklidí.** Dump zkopírovaný na S3/Backblaze
  nebo na externí disk smaž po stejné době ručně (nebo lifecycle pravidlem
  v úložišti), jinak slib na `/soukromi` přestane platit tam, kde ho nikdo nevidí.

  ⚠️ **Zálohy nikdy nedělej přes GitHub Actions.** Repozitář je veřejný a
  artefakty veřejného repozitáře si může stáhnout kdokoli — byl by to únik dat
  všech uživatelů. Dump patří na tvůj stroj nebo do privátního úložiště.
- **Ověření obnovy**: po restore spustit `/api/health`, přihlásit se, na
  /prehled zkontrolovat počty transakcí; případné mezery řeší re-sync brokerů
  (idempotentní dedupe) nebo opakovaný import výpisů.

### Lokální vývoj (PGlite)

Data žijí v `apps/web/.data/` — záloha = kopie adresáře (při zastaveném dev
serveru, PGlite drží zámek). Reset = smazat `.data/`.

### Co se NEzálohuje a proč

Šifrované broker klíče v dumpu jsou bez `DANERO_ENCRYPTION_KEY` bezcenné —
klíč drž v password manageru odděleně od záloh (jinak záloha = plaintext klíče).

## Monitoring

- `/api/health` — 200/503. Ověřuje **dostupnost DB i počet aplikovaných migrací**
  (nezmigrovaná databáze na `SELECT 1` odpoví, ale aplikace všude padá → health
  proto vrací 503 s `migrations: { applied, expected }`). Má vlastní timeout,
  takže i při nedostupné databázi odpoví do pár sekund (`db: "timeout"`).
  Zapoj do uptime monitoringu.
- Strukturované logy: jeden JSON řádek na událost (`lib/log.ts`) — joby
  (`job.started`/`job.finished` s trváním), cron běhy, health selhání.
  Ve Vercelu filtruj podle `event`.
- Cron běhy logují `cron.<jméno>.run`, `cron.<jméno>.finished` (s trváním
  a počty zpracovaných položek) a `cron.<jméno>.failed`. **Chybějící `finished`
  nebo nulové počty = cron tiše nic neudělal** — přesně to se dělo, když ČNB
  vrátila HTTP 200 s HTML chybovou stránkou.

## Limity Vercel funkcí (synchronizace po částech)

Funkce smí na Vercel Hobby běžet nejvýš **300 s** — všechny routy a stránky
proto mají `maxDuration = 300` (víc shodí nasazení; hlídá to
`test/hosting-limits.test.ts`). Plná historie Trading 212 se do toho nevejde:
export jde vyžádat ~1× za minutu a každý rok je jeden export.

Synchronizace se proto **stahuje po částech**:

- Jeden běh jobů má rozpočet 225 s (`DEFAULT_JOB_BUDGET_MS` v `lib/jobs.ts`),
  zbytek do 300 s je rezerva na dotažení roku, rekonciliaci a zápis.
- Když by se další rok do termínu nestihl, sync se sám přeruší (`SyncPaused`),
  job se vrátí do fronty jako `pending` **i s průběhem** a navazující invokace
  `/api/cron/jobs?hop=N` pokračuje tam, kde předchozí skončila. V logu je to
  `job.paused` a `cron.jobs.handoff`.
- Stejně se dojíždí fronta denního syncu, na kterou se v jednom běhu nedostalo
  (`deferred` v odpovědi cronu).
- Řetěz končí sám — každá část stáhne aspoň jeden rok — a má strop 40 invokací.
  Když předání selže (`cron.jobs.handoff_failed`), zbytek dojede s hodinovým
  během z GitHub Actions, nejpozději s denní pojistkou.

V praxi: historie o osmi letech se stáhne na tři až čtyři části, tedy zhruba
za stejnou dobu jako dřív v jednom běhu. Uživatel na `/import` vidí průběh po
letech celou dobu, mezi částmi hlášku „Navazuji další částí historie…".

Co se **nestihne ani tak**: export jednoho roku, který se u brokera generuje
déle než ~3 minuty (tři dotazy po 65 s). Takový běh skončí chybou a jde pustit
znovu; hotové roky se nestahují podruhé. Záloha je ruční nahrání CSV exportu.

**Kolik účtů se dá takhle obsloužit:** jeden účet T212 stojí denně ~65 s
čekání, řetěz tedy zvládne desítky účtů za hodinu. Čekání na síť se do limitu
aktivního CPU na Hobby nepočítá, počítá se ale vyhrazená paměť — při stovkách
napojených účtů je čas vrátit se k placenému tarifu nebo sync rozložit do dne.

## Přenos projektu mezi týmy Vercelu

Přenos (dashboard → Settings → Transfer, nebo API `POST
/v9/projects/<projekt>/transfer-request` na zdrojovém týmu a `PUT
/v9/projects/transfer-request/<kód>` na cílovém) proběhne bez výpadku a vezme
s sebou proměnné prostředí, nasazení i napojení na Git. Dvě věci ale samy
nepřejdou — ověřeno 8. 10. 2026 při stěhování z placeného týmu na Hobby:

- **Crony se zaregistrují až dalším produkčním nasazením.** Hned po přenosu
  je jejich seznam u projektu prázdný; dokud neproběhne nový deploy, neběží
  denní sync, kurzy ani upozornění.
- **Záznam kořenové domény zůstane ve zdrojovém týmu.** Projekt ji dál
  obsluhuje, takže to není vidět — až do chvíle, kdy starý tým zrušíš. Přesuň
  ji předem: `PATCH /v3/domains/<doména>` s `{"op":"move-out","destination":"<id
  cílového týmu>"}` na zdrojovém týmu, a zkontroluj, že je v seznamu domén
  cílového.

Po přenosu vždy: nové produkční nasazení, `/api/health`, seznam cronů
u projektu a jeden běžný push, ať je jisté, že Git nasazuje i na novém místě.

## Region funkcí

`apps/web/vercel.json` má `"regions": ["fra1"]` (Frankfurt). Dva důvody:

- `/soukromi` i `/bezpecnost` tvrdí, že data leží v EU — dokud byl region jen
  v dashboardu, nebylo to v repu ničím podepřené a jedno omylem přepnuté
  nastavení by z toho udělalo nepravdivé tvrzení.
- Je to region databáze (Neon `eu-central-1`). Když funkce běžely v `iad1`,
  stál každý dotaz do DB 93 ms; po přepnutí na `fra1` 2–3 ms (docs/17).

⚠️ `vercel.json` nesnese vlastní klíče — schéma odmítne i `"//"` jako komentář
a **deploy spadne** (ověřeno bolestí 7. 8. 2026: dva commity se nenasadily,
protože jsem si do něj přidal vysvětlující poznámku). Komentáře patří sem.

## DNS pro odesílání e-mailů (SPF, DKIM, DMARC, MX)

Ověřeno v auditu 7. 8. 2026 skutečným odesláním přes produkční Resend a rozborem
doručených hlaviček. **SPF a DKIM jsou nastavené správně** — zpráva nese dvě
platné DKIM signatury (Resend + SES) s doménou `danero.cz`, takže se shodují
s hlavičkou `From` a DMARC by prošel oběma mechanismy:

| Záznam | Host | Hodnota | Stav |
|---|---|---|---|
| TXT (SPF) | `send.danero.cz` | `v=spf1 include:amazonses.com ~all` | ✅ |
| MX | `send.danero.cz` | `10 feedback-smtp.eu-west-1.amazonses.com` | ✅ |
| TXT (DKIM) | `resend._domainkey.danero.cz` | veřejný klíč od Resendu | ✅ |

**Chybí dva záznamy** (nálezy M-2 a M-3). Oba se přidávají tam, kde je hostovaný
DNS domény, a nic nerozbijí — DKIM i SPF už sedí, takže zpřísnění DMARC nemá
co shodit:

| Záznam | Host | Hodnota | Proč |
|---|---|---|---|
| TXT | `_dmarc.danero.cz` | `v=DMARC1; p=quarantine; rua=mailto:dunder.jan@gmail.com; adkim=r; aspf=r; pct=100` | Dnes je tam `p=none;` **bez `rua=`** — tedy ani ochrana, ani zprávy. Kdokoli může poslat e-mail s `From: podpora@danero.cz` („ověřte si účet") a příjemce ho nezkarantenuje. U služby, která rozesílá odkazy na obnovu hesla, je to připravený phishing; bez `rua=` se o něm navíc nikdy nedozvíš. |
| MX | `danero.cz` (kořen) | libovolný funkční příjem pošty | Kořenová doména **nemá MX**, takže odpověď na `notifikace@danero.cz` se nikam nedoručí. „Odpovědět" je přitom první, co uživatel udělá, když chce zrušit předplatné. Kód mezitím posílá `Reply-To` na kontaktní adresu, takže to není tichá ztráta — ale doména bez MX vypadá pro některé příjemce hůř. |

Opatrnější postup u DMARC: nasadit nejdřív `p=none; rua=…`, počkat týden na
zprávy, a teprve pak zvednout na `p=quarantine`. Vzhledem k tomu, že veškerá
odchozí pošta jde jedinou cestou (Resend) a alignment sedí, je skok rovnou na
`quarantine` bezpečný.

Ověření po změně:

```bash
dig +short TXT _dmarc.danero.cz
dig +short MX danero.cz
```
