# Vlastní instance Danera (self-hosting)

Danero je pod [AGPL-3.0](../LICENSE) — můžeš si ho provozovat sám, se všemi
funkcemi a bez omezení. Tenhle návod popisuje běh na vlastním serveru; pokud ti
stačí, aby to prostě běželo, je tu [danero.cz](https://danero.cz).

> **Na co počítej.** Danero je jednouživatelský nástroj na daňová data — je to
> jednoduchá aplikace, ale běží na ní tvoje daňové přiznání. Aktualizace musíš
> tahat sám, a hlavně: **každý leden se mění zákon** (jednotný kurz, hranice
> sazeb, struktura formuláře EPO). Bez aktualizace ti instance po Novém roce
> počítá podle loňska.
>
> Podpora self-hostingu je best effort, bez záruky — dotazy do
> [Discussions](https://github.com/dundejan/danero/discussions), ne do issue.

## Co budeš potřebovat

- **Docker** (doporučeno), nebo **Node.js 22+** a **pnpm**
- **PostgreSQL 16+** — s Dockerem ho rozjede `docker compose` sám
- Doménu s HTTPS (aplikace posílá cookies s `Secure` a nastavuje HSTS)
- *Volitelně* účet u [Resendu](https://resend.com) na odesílání e-mailů

## Nejrychlejší cesta: Docker

```bash
git clone https://github.com/dundejan/danero.git && cd danero

# .env s vlastními tajemstvími (žádné výchozí hodnoty neexistují — schválně)
cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 16)
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
DANERO_ENCRYPTION_KEY=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -hex 32)
BETTER_AUTH_URL=https://tvoje.domena
EOF

docker compose up -d --build     # → http://localhost:3000
```

Vznikne trojice služeb: `db` (Postgres s pojmenovaným volume), `web`
(aplikace) a `cron` (naplánované úlohy — bez něj Danero nic nehlídá, jen
počítá, když se přihlásíš).

- **Migrace** se dotáhnou samy při startu (`DANERO_MIGRATE_ON_START=1`
  v compose). Platí to pro **jednu** instanci; při více současně běžících
  by si migrace lezly do zelí — tam patří `drizzle-kit migrate` do deploye.
- **Aktualizace:** `git pull && docker compose up -d --build`.
- **Záloha:** `docker compose exec db pg_dump -U danero danero > zaloha.sql`
  (a odděleně `DANERO_ENCRYPTION_KEY`, viz varování níže).
- Port změníš přes `PORT=8080` v `.env`.

Před aplikaci ještě patří reverzní proxy s TLS. Aplikace si nastavuje vlastní
bezpečnostní hlavičky včetně CSP — **v proxy je neduplikuj**, přebily by se.

## Konfigurace

Všechna tajemství se předávají env proměnnými, žádné není v kódu. Vygeneruj si
vlastní:

```bash
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -hex 32      # DANERO_ENCRYPTION_KEY  (přesně 32 bajtů hex!)
openssl rand -hex 32      # CRON_SECRET
```

| Proměnná | Povinná | K čemu |
|---|---|---|
| `DATABASE_URL` | ano | připojení k Postgresu. Bez ní běží lokální PGlite v `apps/web/.data/` — to je vývojový režim, ne produkce |
| `BETTER_AUTH_SECRET` | ano | podpis session a odhlašovacích tokenů; v produkci bez ní aplikace spadne při startu |
| `BETTER_AUTH_URL` | ano | veřejná URL instance, např. `https://dane.example.cz` |
| `DANERO_ENCRYPTION_KEY` | ano | AES-256-GCM klíč pro API klíče brokerů; v produkci bez ní aplikace spadne při startu |
| `CRON_SECRET` | ano | bez ní všechny `/api/cron/*` odmítají vše (401) — tedy žádné syncy ani e-maily |
| `RESEND_API_KEY` | ne | bez ní se e-maily jen zapisují do logu (na jedno-uživatelské instanci to může stačit) |
| `RESEND_FROM` | ne | odesílatel, např. `"Danero <notifikace@example.cz>"` |
| `DANERO_MIGRATE_ON_START` | ne | `1` = zmigruj Postgres při startu (compose to nastavuje sám). Jen pro jednu instanci. |

> ⚠️ **`DANERO_ENCRYPTION_KEY` si zálohuj odděleně od databáze.** Když ho
> ztratíš, uložené API klíče brokerů jsou nečitelné a musíš je zadat znovu.
> A obráceně: záloha databáze *spolu* s klíčem = klíče brokerů v plaintextu.

## Bez Dockeru, přímo přes Node

```bash
git clone https://github.com/dundejan/danero.git && cd danero
pnpm install
pnpm build

# migrace databáze (spouštěj při každém nasazení nové verze)
cd apps/web && DATABASE_URL='postgres://…' pnpm exec drizzle-kit migrate && cd -

pnpm --filter @danero/web start        # poslouchá na :3000
```

Za tím opět reverzní proxy s TLS (Caddy, nginx, Traefik) a naplánované úlohy
z další sekce.

## Naplánované úlohy

Danero potřebuje pět pravidelných jobů. V compose je má na starost služba `cron`,
na Vercelu je definuje `apps/web/vercel.json`; jinde je zavolej běžným cronem —
jsou to prosté `GET` požadavky s hlavičkou
`Authorization: Bearer $CRON_SECRET`:

```cron
15 4 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://tvoje.domena/api/cron/maintenance
45 4 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://tvoje.domena/api/cron/fx
 0 5 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://tvoje.domena/api/cron/sync-brokers
30 5 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://tvoje.domena/api/cron/notify
 0 * * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://tvoje.domena/api/cron/jobs
```

| Job | Co dělá |
|---|---|
| `fx` | stáhne kurzy ČNB |
| `sync-brokers` | stáhne nové transakce ze všech napojených platforem |
| `notify` | přepočítá limity a časové testy a rozešle upozornění |
| `jobs` | záchranná síť — dokončí běhy, které spadly nebo se nestihly |
| `maintenance` | smaže data po retenční lhůtě (audit log po 90 dnech) |

⚠️ **První plný sync trvá dlouho** — Trading 212 pouští export ~1×/min, takže
celá historie zabere minuty až ~10. Pod serverless funkcí s krátkým časovým
limitem to nedoběhne (proto `maxDuration = 800`); job má proto resume po
letech a hodinová `jobs` ho dorovná. Na vlastním serveru bez časového limitu
tenhle problém nemáš.

## Provoz

- **Zdravotní stav:** `GET /api/health` — ping do databáze a latence (200/503).
- **Logy:** jeden JSON řádek na událost, filtruj podle pole `event`.
- **Zálohy:** zdrojem pravdy jsou transakce, každý výpočet je čistá funkce a jde
  reprodukovat od nuly — stačí tedy zálohovat databázi (a odděleně šifrovací
  klíč). Podrobněji [docs/08](08-provoz.md).
- **Roční údržba (leden):** nový jednotný kurz z pokynu GFŘ řady D, hranice
  23 % sazby, struktura formuláře EPO pro nový rok — viz sekce „Roční údržba"
  v [docs/02](02-danova-pravidla.md). Nejjednodušší je vytáhnout si aktuální
  verzi z repozitáře.

## Vlastní jméno

Kód si uprav jakkoli. Název „Danero", logo a doména danero.cz ale pod licenci
nespadají — pokud instanci nabízíš dalším lidem, dej jí vlastní jméno. Viz
[TRADEMARK.md](../TRADEMARK.md).

---

*`Dockerfile` i `docker-compose.yml` jsou ověřené proti čisté databázi:
migrace při startu založí schéma, `/api/health` odpovídá 200, cron joby mají
naplánovaný běh a bez `CRON_SECRET` vracejí 401.*
