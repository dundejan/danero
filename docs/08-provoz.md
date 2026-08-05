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
3. **Env proměnné** (všechny povinné — aplikace bez nich spadne při startu, viz
   `.env.example`): `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
   (produkční URL), `DANERO_ENCRYPTION_KEY`, `CRON_SECRET`.
4. **Cron**: `apps/web/vercel.json` definuje denní sync všech brokerů v 5:00 UTC
   (`/api/cron/sync-brokers`), notifikace v 5:30 (`/api/cron/notify`) a hodinovou
   záchrannou síť background jobů (`/api/cron/jobs`); Vercel posílá
   `Authorization: Bearer $CRON_SECRET` sám. Pozor: hodinový cron vyžaduje placený
   plán (Hobby umí jen denní); k dlouhému prvnímu syncu viz „Limity Vercel funkcí"
   níže.

## Migrace databáze

**Nespouštějí se ručně.** Řídí je `.github/workflows/migrace.yml`:

- **samy** při pushi do `main`, který mění `apps/web/db/migrations/**`,
- **na vyžádání**: `gh workflow run migrace.yml` (nebo tlačítko „Run workflow";
  volba `stav` jen vypíše počty, nic nemění).

Připojovací řetězec je v secretu `PRODUCTION_DATABASE_URL` (přímý, nepoolovaný).
Do logu se nedostane a nikdo ho nemusí mít v terminálu. Workflow běží pod
`concurrency`, takže dvě migrace nad jednou databází nemůžou jet naráz.

⚠️ **Migrace, která musí předcházet kódu** (typicky doplnění dat, na které nový
kód spoléhá — třeba 0021), se pouští **před** nasazením: `gh workflow run
migrace.yml`, počkat na doběhnutí, teprve pak push kódu. Automatický běh na
pushi jede paralelně s buildem na Vercelu a pořadí negarantuje.

Ruční zásahy a zálohy: `scripts/db.sh [stav|migrace|zaloha]`. Bere řetězec
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
- **Týdenní logický dump navíc** (nezávislý na Neonu): `scripts/db.sh zaloha`
  → `zalohy/danero-RRRR-MM-DD.dump` (gitignorováno). Uchovávat 8 týdnů mimo
  Neon (S3/Backblaze). Obnova: `pg_restore -d "$NEW_URL" --clean danero-X.dump`.

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

- `/api/health` — DB ping + latence (200/503); zapoj do uptime monitoringu.
- Strukturované logy: jeden JSON řádek na událost (`lib/log.ts`) — joby
  (`job.started`/`job.finished` s trváním), cron běhy, health selhání.
  Ve Vercelu filtruj podle `event`.

## Limity Vercel funkcí (první plný sync)

Plná T212 historie trvá minuty až ~10 min (rate limit exportů ~1/min). Cron routy
`/api/cron/sync-brokers` a `/api/cron/jobs` mají `maxDuration = 800` — to vyžaduje
**Vercel Pro** (hobby plán má strop 300 s). Na hobby plánu první plný sync
pravděpodobně spadne uprostřed; záchranný hodinový cron ho dorovná na chybu
a další pokus jede znovu — pro produkci proto počítej s Pro plánem, nebo první
historickou synchronizaci proveď ručním nahráním CSV/XML exportů (idempotentní).
