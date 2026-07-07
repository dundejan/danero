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
4. **Cron**: `apps/web/vercel.json` definuje denní sync T212 v 5:00 UTC
   (`/api/cron/sync-t212`); Vercel posílá `Authorization: Bearer $CRON_SECRET` sám.

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
