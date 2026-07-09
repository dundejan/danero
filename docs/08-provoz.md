# Provoz a nasazení

## Lokální vývoj

```bash
pnpm install && pnpm dev   # → http://localhost:3000
```

Bez konfigurace: DB je PGlite v `apps/web/.data/` (migrace při startu), auth secret
a šifrovací klíč se vygenerují do `.data/` (gitignored). Reset = smazat `.data/`.

## Produkce (Vercel + Neon)

1. **Neon**: projekt v regionu EU (Frankfurt) → `DATABASE_URL`. Migrace:
   `cd apps/web && DATABASE_URL=... pnpm exec drizzle-kit migrate` (spouštět při deployi).
2. **Vercel**: projekt s root directory `apps/web` (monorepo, pnpm). Funkce region `fra1`.
3. **Env proměnné** (všechny povinné — aplikace bez nich spadne při startu, viz
   `.env.example`): `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
   (produkční URL), `DANERO_ENCRYPTION_KEY`, `CRON_SECRET`.
4. **Cron**: `apps/web/vercel.json` definuje denní sync všech brokerů v 5:00 UTC
   (`/api/cron/sync-brokers`), notifikace v 5:30 (`/api/cron/notify`) a hodinovou
   záchrannou síť background jobů (`/api/cron/jobs`); Vercel posílá
   `Authorization: Bearer $CRON_SECRET` sám. Pozor: hodinový cron vyžaduje placený
   plán (Hobby umí jen denní) a dlouhý první sync viz poznámka v docs/DENIK.md.

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
- **Týdenní logický dump navíc** (nezávislý na Neonu):
  `pg_dump "$DATABASE_URL" -Fc -f danero-$(date +%F).dump` — uchovávat 8 týdnů
  mimo Neon (S3/Backblaze). Obnova: `pg_restore -d "$NEW_URL" --clean danero-X.dump`.
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
