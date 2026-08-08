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
| `POSTGRES_PASSWORD` | ano (compose) | heslo databáze, kterou zakládá `docker compose`; jde i do `DATABASE_URL` služby `web` |
| `DATABASE_URL` | ano | připojení k Postgresu. Bez ní běží lokální PGlite v `apps/web/.data/` — to je vývojový režim, ne produkce |
| `BETTER_AUTH_SECRET` | ano | podpis session a odhlašovacích tokenů; v produkci bez ní aplikace spadne při startu |
| `BETTER_AUTH_URL` | ano | veřejná URL instance, např. `https://dane.example.cz`. **Musí být https** — z ní si Better Auth odvozuje příznak `Secure` u session cookie. Compose bez ní nenastartuje (schválně: tichý `http://localhost` default by vydával cookie bez `Secure`) |
| `DANERO_ENCRYPTION_KEY` | ano | AES-256-GCM klíč pro API klíče brokerů; v produkci bez ní aplikace spadne při startu |
| `DANERO_ENCRYPTION_KEYS_OLD` | ne | klíče vyřazené při výměně `DANERO_ENCRYPTION_KEY` (hex oddělené čárkou). Šifruje se vždy tím aktuálním, ale data od těch starých se dál čtou — viz „Výměna šifrovacího klíče" níž |
| `CRON_SECRET` | ano | bez ní všechny `/api/cron/*` odmítají vše (401) — tedy žádné syncy ani e-maily |
| `PORT` | ne | na kterém portu hostitele instance poslouchá (výchozí `3000`); uvnitř kontejneru je to vždy 3000 |
| `RESEND_API_KEY` | ne | bez ní se e-maily jen zapisují do logu (na jedno-uživatelské instanci to může stačit) |
| `RESEND_FROM` | ne | odesílatel, např. `"Danero <notifikace@example.cz>"` |
| `DANERO_MIGRATE_ON_START` | ne | `1` = zmigruj Postgres při startu (compose to nastavuje sám). Jen pro jednu instanci. |
| `DANERO_TRUSTED_PROXIES` | ne | IP/CIDR tvých reverzních proxy oddělené čárkou. Podle nich se z `X-Forwarded-For` hledá skutečná IP klienta (klíč rate limitu přihlašování). Nevyplněno = privátní rozsahy (loopback, RFC1918, docker), což sedí na běžnou proxy na témž stroji. Vyplň, když máš před sebou CDN s veřejnými adresami — jinak by se limity počítaly na adresu CDN a sdíleli by je všichni. |
| `NEXT_PUBLIC_SOURCE_URL` | **ano, pokud kód měníš** | adresa repozitáře **s tvými úpravami**. Aplikace ji ukazuje přihlášeným uživatelům v patičce, protože § 13 licence AGPL-3.0 ukládá nabídnout zdrojový kód každému, komu instanci nabízíš po síti. Bez ní ukazuje upstream — a ten tvoje změny neobsahuje, takže bys licenci porušoval. |
| `DANERO_BILLING` | ne | `stripe` zapne placené tarify. Pro vlastní instanci to nechceš — bez ní je odemčené všechno (viz `lib/entitlements.ts`). |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_REPORT`, `STRIPE_PRICE_SUBSCRIPTION`, `STRIPE_WEBHOOK_SECRET` | jen s platbami | klíč, ID cen a podpis webhooku ze Stripu. Nastavený `STRIPE_SECRET_KEY` bez `DANERO_BILLING=stripe` v produkci aplikaci schválně shodí. |

> ⚠️ **`DANERO_ENCRYPTION_KEY` si zálohuj odděleně od databáze.** Když ho
> ztratíš, uložené API klíče brokerů jsou nečitelné a musíš je zadat znovu.
> A obráceně: záloha databáze *spolu* s klíčem = klíče brokerů v plaintextu.

### Výměna šifrovacího klíče

Každý zašifrovaný údaj v databázi nese osmiznakový otisk klíče, kterým vznikl
(`v2-3f7a1c9d.…`), takže výměna nemusí být skokem přes propast:

1. vygeneruj nový klíč (`openssl rand -hex 32`),
2. nový dej do `DANERO_ENCRYPTION_KEY`, ten dosavadní přesuň do
   `DANERO_ENCRYPTION_KEYS_OLD` a restartuj,
3. od té chvíle se šifruje novým klíčem a stará data se čtou tím vyřazeným,
4. starý klíč smíš zahodit, až žádný záznam nemá jeho otisk. Překlopení
   jednotlivého údaje umí `reencryptSecret()` z `apps/web/lib/crypto.ts`;
   automatický přešifrovací průchod v aplikaci zatím není.

Bez kroku 2 (starý klíč nikde) se uložené broker klíče po výměně nepřečtou —
aplikace to řekne nahlas a uživatel je zadá znovu, ale je to zbytečná otrava.

## Bez Dockeru, přímo přes Node

```bash
git clone https://github.com/dundejan/danero.git && cd danero
pnpm install
pnpm build

# migrace databáze (spouštěj při každém nasazení nové verze).
# db/migrate.mjs dělá totéž co `drizzle-kit migrate`, ale při selhání vypíše
# celou chybu včetně SQLSTATE a dotazu, na kterém to spadlo.
cd apps/web && DATABASE_URL='postgres://…' node db/migrate.mjs && cd -

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
15 4 * * *  curl -fsS --retry 3 --retry-delay 30 --max-time 300  -H "Authorization: Bearer $CRON_SECRET" https://tvoje.domena/api/cron/maintenance
45 4 * * *  curl -fsS --retry 3 --retry-delay 30 --max-time 300  -H "Authorization: Bearer $CRON_SECRET" https://tvoje.domena/api/cron/fx
 0 5 * * *  curl -fsS --retry 3 --retry-delay 60 --max-time 1800 -H "Authorization: Bearer $CRON_SECRET" https://tvoje.domena/api/cron/sync-brokers
30 5 * * *  curl -fsS --retry 3 --retry-delay 60 --max-time 1800 -H "Authorization: Bearer $CRON_SECRET" https://tvoje.domena/api/cron/notify
 0 * * * *  curl -fsS --retry 3 --retry-delay 60 --max-time 1800 -H "Authorization: Bearer $CRON_SECRET" https://tvoje.domena/api/cron/jobs
```

⏰ **Časy jsou v UTC** — kontejner `cron` nemá nastavenou zónu a Vercel Cron
jinou neumí. V létě je 5:00 UTC 7:00 pražského času, v zimě 6:00. Chceš-li to
jinak, posuň časy v crontabu (ne zónu).

📋 **Když cron mlčí:** služba `cron` v compose běží s `crond -f -d 8`, takže
`docker compose logs cron` ukáže i selhání. (`-l 8` nastavuje jen úroveň, cíl
zůstává syslog — a ten v kontejneru nikdo neposlouchá, takže špatný
`CRON_SECRET` končil absolutním tichem.)

| Job | Co dělá |
|---|---|
| `fx` | stáhne kurzy ČNB |
| `sync-brokers` | stáhne nové transakce ze všech napojených platforem |
| `notify` | přepočítá limity a časové testy a rozešle upozornění |
| `jobs` | záchranná síť — dokončí běhy, které spadly nebo se nestihly |
| `maintenance` | smaže data po retenční lhůtě (audit log, historie importů a joby po 90 dnech, prošlé přihlašovací relace a ověřovací tokeny hned, doručená upozornění po 400 dnech) |

⚠️ **První plný sync trvá dlouho** — Trading 212 pouští export ~1×/min, takže
celá historie zabere minuty až ~10. Pod serverless funkcí s krátkým časovým
limitem to nedoběhne (proto `maxDuration = 800`); job má proto resume po
letech a hodinová `jobs` ho dorovná. Na vlastním serveru bez časového limitu
tenhle problém nemáš.

## Provoz

- **Zdravotní stav:** `GET /api/health` — dostupnost databáze, latence a počet
  aplikovaných migrací (200/503). Nezmigrovaná databáze vrací 503 s
  `migrations: { applied, expected }`, nedostupná `db: "timeout"` do pár sekund.
  Kontroluje ho i `HEALTHCHECK` v obrazu, takže `docker ps` ukáže `unhealthy`.
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
