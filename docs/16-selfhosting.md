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

- **Node.js 22+** a **pnpm**
- **PostgreSQL 16+** (kdekoli — vlastní server, Neon, Supabase…)
- Doménu s HTTPS (aplikace posílá cookies s `Secure` a nastavuje HSTS)
- *Volitelně* účet u [Resendu](https://resend.com) na odesílání e-mailů

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

> ⚠️ **`DANERO_ENCRYPTION_KEY` si zálohuj odděleně od databáze.** Když ho
> ztratíš, uložené API klíče brokerů jsou nečitelné a musíš je zadat znovu.
> A obráceně: záloha databáze *spolu* s klíčem = klíče brokerů v plaintextu.

## Instalace a běh

```bash
git clone https://github.com/dundejan/danero.git && cd danero
pnpm install
pnpm build

# migrace databáze (spouštěj při každém nasazení nové verze)
cd apps/web && DATABASE_URL='postgres://…' pnpm exec drizzle-kit migrate && cd -

pnpm --filter @danero/web start        # poslouchá na :3000
```

Za tím dej reverzní proxy s TLS (Caddy, nginx, Traefik). Aplikace si nastavuje
vlastní bezpečnostní hlavičky včetně CSP — **neduplikuj je v proxy**, přebily by
se navzájem.

## Naplánované úlohy

Danero potřebuje čtyři pravidelné joby. Na Vercelu je definuje `apps/web/vercel.json`,
jinde je zavolej běžným cronem — jsou to prosté `GET` požadavky s hlavičkou
`Authorization: Bearer $CRON_SECRET`:

```cron
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

*Docker image a `docker-compose.yml` jsou v plánu; do repozitáře se přidají,
až budou skutečně vyzkoušené proti čisté databázi.*
