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
3. **Env proměnné** (viz `.env.example`). Povinné — aplikace bez nich spadne při
   startu: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (produkční
   URL), `DANERO_ENCRYPTION_KEY`, `CRON_SECRET`. Pro platby navíc:
   `DANERO_BILLING=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_REPORT`,
   `STRIPE_PRICE_SUBSCRIPTION`, `STRIPE_WEBHOOK_SECRET` — nastavený Stripe klíč
   bez `DANERO_BILLING=stripe` v produkci shodí start (jinak by paywall tiše
   rozdal všechno zdarma). Volitelně `RESEND_API_KEY`, `RESEND_FROM`,
   `DANERO_TRUSTED_PROXIES` (viz níž).
4. **Cron**: `apps/web/vercel.json` definuje **v UTC** (Vercel Cron jiné pásmo
   neumí — v létě je to +2 h, v zimě +1 h pražského času):

   | UTC | Routa | Co dělá |
   |---|---|---|
   | 3:40 denně | `/api/cron/billing-reconcile` | srovnání předplatných proti Stripu |
   | 4:15 denně | `/api/cron/maintenance` | úklid dat po retenční lhůtě |
   | 4:45 denně | `/api/cron/fx` | denní kurzy ČNB |
   | 5:00 denně | `/api/cron/sync-brokers` | sync všech napojených brokerů |
   | 5:30 denně | `/api/cron/notify` | přepočet limitů + upozornění |
   | každou hodinu | `/api/cron/jobs` | záchranná síť background jobů |

   `Authorization: Bearer $CRON_SECRET` posílá Vercel sám. Pozor: hodinový cron
   vyžaduje placený plán (Hobby umí jen denní); k dlouhému prvnímu syncu viz
   „Limity Vercel funkcí" níže.

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

Ruční zásahy a zálohy: `scripts/db.sh [status|migrate|backup]`. Bere řetězec
z `~/.danero/produkce.env` (řádek `DATABASE_URL_DIRECT=…`, mimo repozitář,
`chmod 600`) a nikdy ho nevypisuje.

## Roční runbook (leden)

Viz docs/02 (sekce Roční údržba): nový jednotný kurz (pokyn řady D) →
`apps/web/lib/tax-config.ts` + `packages/engine/src/config/taxYear.ts`; hranice 23 %
sazby; výše paušálních záloh; kontrola novel ZDP.

⚠️ Historické jednotné kurzy v `lib/tax-config.ts` jsou zatím ORIENTAČNÍ — před
generováním podkladů k přiznání doplnit přesné hodnoty z pokynů GFŘ řady D.

## Zálohy a monitoring (TODO před veřejným provozem)

- Neon: point-in-time restore je součástí; otestovat obnovu.
- Sentry (`SENTRY_DSN`) — zatím nezapojeno.
- E-mail notifikace (Resend, `RESEND_API_KEY`) — zatím nezapojeno.

## Zálohy a obnova (runbook, G10c)

**Zdroj pravdy jsou transakce** — každý výpočet jde reprodukovat od nuly
(docs/04). Ztráta odvozených dat (notifikace, ceny) je nepříjemnost, ne katastrofa.

### Produkce (Neon)

- **PITR**: Neon drží point-in-time recovery (dle plánu 7–30 dní). Obnova:
  Neon Console → Branches → „Restore from history" → nový branch k času T →
  přepnout `DATABASE_URL` (nebo `neon branches create --parent main@<timestamp>`).
- **Týdenní logický dump navíc** (nezávislý na Neonu): `scripts/db.sh backup`
  → `zalohy/danero-RRRR-MM-DD.dump` (gitignorováno). Uchovávat **nejvýš 8 týdnů**
  mimo Neon (S3/Backblaze) — `/soukromi` slibuje, že smazaná data zmizí ze záloh
  do 60 dnů, delší držení by z toho udělalo lež. Obnova: `pg_restore -d "$NEW_URL" --clean danero-X.dump`.

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

## Limity Vercel funkcí (první plný sync)

Plná T212 historie trvá minuty až ~10 min (rate limit exportů ~1/min). Cron routy
`/api/cron/sync-brokers` a `/api/cron/jobs` mají `maxDuration = 800` — to vyžaduje
**Vercel Pro** (hobby plán má strop 300 s). Na hobby plánu první plný sync
pravděpodobně spadne uprostřed; záchranný hodinový cron ho dorovná na chybu
a další pokus jede znovu — pro produkci proto počítej s Pro plánem, nebo první
historickou synchronizaci proveď ručním nahráním CSV/XML exportů (idempotentní).

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
