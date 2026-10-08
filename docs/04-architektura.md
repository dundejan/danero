# Architektura a technologie

Rozhodnuto 7/2026. Priority zadání: spolehlivost, rychlost, **krásné moderní UI**; solo vývoj s AI asistencí. Kód je od 3. 8. 2026 open source pod AGPL-3.0 a hostovaná služba je od 8. 10. 2026 celá zdarma jako osobní projekt (→ nízké fixní náklady na infrastrukturu).

## Tech stack

**Full-stack TypeScript** — jeden jazyk napříč enginem, importéry i UI; nejsilnější ekosystém pro moderní UI (Tailwind, shadcn/ui) a existující referenční broker-parsery (Export-To-Ghostfolio, Apache-2.0).

| Vrstva | Volba | Zdůvodnění |
|---|---|---|
| Monorepo | **pnpm workspaces + Turborepo** | čisté oddělení enginu od aplikace |
| Web | **Next.js (App Router) + React** | SSR + Server Actions, jeden deploy |
| UI | **Tailwind CSS + shadcn/ui + Recharts** | moderní vzhled bez designéra, plná kontrola nad stylem |
| Daňový engine | **čistý TS balíček, zero-I/O** | deterministický, testovatelný izolovaně, žádné závislosti na DB/HTTP |
| Peníze/čísla | **decimal.js** (v DB `numeric` jako string) | nikdy `number`/float pro částky |
| Validace | **Zod** | sdílená schémata engine ↔ API ↔ formuláře |
| DB | **PostgreSQL (Neon, region Frankfurt)** + **Drizzle ORM** | EU data-residency, TS-first ORM, `numeric` bez ztráty přesnosti |
| Auth | **Better Auth** (self-hosted) | data i hesla v naší DB (žádná třetí strana u citlivých dat), TOTP 2FA out-of-the-box |
| E-maily | **Resend** | notifikace, transakční maily; šablony jsou prosté TS řetězce (`lib/email.ts`, `lib/email-layout.ts`), bez šablonovací knihovny |
| Billing | **žádný** | služba je od 8. 10. 2026 celá zdarma; platby přes Stripe (značka `placene-tarify`) byly odstraněny |
| Hosting | **Vercel** (functions region fra1) | zero-ops, cron joby, preview deploye; exit-path: Docker na Hetzner (architektura na Vercelu nezávislá — žádné vendor-specific API kromě cronu) |
| Monitoring | **strukturované logy** (JSON) ve Vercelu + `/api/health` | externí sběr chyb ani analytika nasazené nejsou (viz „Provoz" níž) |
| Testy | **Vitest** (engine: golden + property testy via fast-check), **Playwright** (E2E) | |

## Struktura monorepa

```
danero/
  apps/web/                  # Next.js — UI, API, auth
    app/                     #   stránky a API routy (App Router)
    components/              #   UI komponenty
    db/                      #   Drizzle schéma (schema.ts) a migrace
    lib/                     #   aplikační logika: import, sync, e-maily, šifrování, retence
    test/                    #   unit a integrační testy (Vitest)
    e2e/                     #   E2E testy (Playwright)
  packages/shared/           # kanonický model transakcí (Zod), Decimal peníze, ISO datumy
  packages/engine/           # daňový engine (čistá logika, implementuje docs/02)
    src/config/              #   TaxYearConfig per rok, ověřené jednotné kurzy, přepínače výkladu
    src/ledger/              #   lot ledger, korporátní akce (R-04)
    src/timetest/            #   časový test (R-01)
    src/limits/              #   100k / 50k paušál / 20k / 40M / 5M (R-02,03,08,09)
    src/basis/               #   § 10 párování FIFO/LIFO/… , § 8 dividendy (R-05,07), deriváty (R-12), prodeje nakrátko (R-13)
    src/fx/                  #   jednotný kurz + ČNB denní (R-06)
    src/tax/                 #   odhad daně, zápočet zahraniční daně (R-07)
    src/filing/              #   lhůty pro podání přiznání (R-09e)
    src/simulate/            #   simulace prodeje, porovnání variant
    test/                    #   testy po pravidlech R-xx z docs/02 + property testy (fast-check)
  packages/importers/        # parsery brokerů → kanonický model
    src/trading212/          #   CSV parser + API klient; každá další platforma má vedle vlastní adresář
    src/universal/           #   univerzální CSV šablona
    src/dedupe.ts            #   obsahový otisk transakce (dedupe klíč)
  scripts/                   # správa produkční databáze (db.sh), validace EPO
  docs/
```

**Klíčový invariant:** engine je čistá funkce `(transactions, taxYearConfig, options) → výsledky`. DB ukládá transakce (zdroj pravdy), výsledky se cachují jen v paměti procesu; každý přepočet je plně reprodukovatelný. Oprava historických dat = přepočet od nuly (řeší stížnost uživatelů Taxomatu, že minulé roky nejde měnit — u nás jde, s audit logem změn).

## Datový model (hlavní tabulky)

Zdroj pravdy je `apps/web/db/schema.ts`; tady je jen přehled, k čemu která tabulka je.

- `user`, `session`, `account`, `verification`, `two_factor`, `rate_limit` — tabulky Better Authu: účet, relace, přihlašovací údaje, jednorázové tokeny, TOTP a rate limit přihlašování
- `taxpayer_profiles` — režim: `PAUSAL | ZAMESTNANEC | OSVC | JINE`; flags (obchodní majetek…); konfigurační přepínače z docs/02
- `tax_year_settings` — konfigurace zafixovaná pro rok, za který si uživatel vygeneroval podklady k přiznání (podané přiznání se zpětně nepřepočítá)
- `broker_accounts` — broker, název, `credentials_encrypted`, stav a chyba poslední synchronizace, výsledek rekonciliace pozic
- `import_batches` — soubor/API sync: počty přidaných a duplicitních řádků, chyby, přeskočené řádky a varování per řádek (`issues`); surový soubor se neukládá
- `failed_imports` — výpis, který se nepodařilo přečíst, schovaný k rozboru (obsah se maže uzavřením případu, celý záznam nejpozději po 90 dnech)
- `transactions` — kanonický model (docs/03) v `payload`; primární klíč (`user_id`, `dedupe_key`) dělá import idempotentním, `batch_id` odkazuje na dávku
- `instrument_aliases` — uživatelský číselník symbol → ISIN a měna pro brokery, kteří je neexportují
- `instrument_prices` — poslední známé ceny instrumentů z broker API (orientační)
- `fx_rates` — denní kurzy ČNB; sdílená referenční data trhu, ne uživatelská
- `notification_prefs`, `notifications` — nastavení e-mailových upozornění a události hlídače (každá vznikne jen jednou)
- `jobs` — background joby dlouhých operací (sync) včetně průběhu, na který jde navázat
- `audit_log` — události účtu (přihlášení, importy, změny profilu a klíčů)
- `app_rate_limits` — aplikační rate limity (upload, EPO, export)
- `waitlist` — archiv e-mailů nasbíraných před spuštěním; nic nového se na ní nestaví

Korporátní akce (splity, spin-offy) nemají vlastní tabulku — jsou to transakce typu `CORPORATE_ACTION` a ledger je zpracuje při výpočtu. Výsledky daňových výpočtů se do databáze neukládají: cache je jen v paměti procesu (`lib/engine-cache.ts`).

Vše tenantované přes `user_id`; každý DB dotaz jde přes repository vrstvu, která scoping vynucuje (+ integrační testy na cross-tenant izolaci).

## Zabezpečení (viditelná součást produktu)

Držíme citlivá finanční data → bezpečnost je marketingová výhoda proti Taxomatu, který ji nekomunikuje.

1. **Minimalizace dat**: k ničemu nepotřebujeme jméno, adresu ani rodné číslo — jen e-mail. Žádná napojení vyžadující hesla k brokerům; T212 API klíč je **read-only**.
2. **Šifrování**: API klíče brokerů šifrované na aplikační úrovni (AES-256-GCM, klíč v env, nikdy v DB); DB šifrovaná at-rest (Neon); TLS všude. Zálohy jsou `pg_dump -Fc` **bez vlastní šifrovací vrstvy** — leží na disku provozovatele, ne v cloudu.
3. **Auth**: scrypt (N=2^16, r=8 — 64 MiB, nativní `node:crypto`), TOTP 2FA se zálohovými kódy, rate limiting na login i per účet, session revokace při změně hesla.
4. **Aplikační**: Zod validace všech vstupů; parsování CSV s limity velikosti a řádků (ochrana proti CSV bombám), bez `eval`/formula injection při exportech; CSP a security headers; CSRF ochrana (Server Actions origin-check); závislosti hlídané přes `pnpm audit` + Renovate.
5. **Tenancy**: repository vrstva s povinným `user_id`; testy na izolaci.
6. **GDPR**: data v EU (Frankfurt), zpracovatelé vypsaní v `/soukromi` (Neon, Vercel, Resend), právo na export (JSON) a smazání účtu (hard delete + purge záloh dle retence), privacy policy bez právního ptydepe.
7. **Provoz**: audit log (přihlášení, importy, změny dat) s retencí 90 dní; zálohy ručním `scripts/db.sh backup` s ověřenou obnovou. Externí sběr chyb (Sentry apod.) **nasazený není** — logy jsou ve Vercelu.
8. **Post-launch** (plán): responsible disclosure je hotové — postup hlášení popisuje [`SECURITY.md`](../SECURITY.md); `security.txt` zatím není (`/.well-known/security.txt` aplikace nevrací); případně externí mini-pentest před škálováním.

## Spolehlivost výpočtů (nejdůležitější vlastnost produktu)

- **Golden testy**: každé pravidlo R-xx z docs/02 má fixture scénáře s ručně ověřenými výsledky (vč. příkladů ze zdrojů — např. 120k tržba/5k zisk → prolomení 50k limitu).
- **Property testy** (fast-check): invarianty — počet kusů po splitu sedí; součet dílčích základů nikdy záporný (R-05d); dedupe idempotentní; přepnutí metody párování nemění celkové množství, jen alokaci.
- **Verifikace na reálných datech**: kompletní historie zakladatele z T212, křížová kontrola proti ručnímu Excelu (a proti Taxomat free tieru).
- **Odborná validace**: před veřejným spuštěním nechat metodiku (docs/02) zkontrolovat daňovým poradcem — jednorázová konzultace, levné pojistka.
- Verzování legislativy: `TaxYearConfig` per rok; výpočty pro 2025 se nezmění, když se změní zákon pro 2027.
