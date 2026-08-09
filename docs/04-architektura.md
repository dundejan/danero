# Architektura a technologie

Rozhodnuto 7/2026. Priority zadání: spolehlivost, rychlost, **krásné moderní UI**; solo vývoj s AI asistencí; uzavřený SaaS s cenou výrazně pod konkurencí (→ nízké fixní náklady na infrastrukturu).

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
| E-maily | **Resend** + React Email | notifikace, transakční maily |
| Billing | **Stripe** (subscriptions) | až fáze F5 |
| Hosting | **Vercel** (functions region fra1) | zero-ops, cron joby, preview deploye; exit-path: Docker na Hetzner (architektura na Vercelu nezávislá — žádné vendor-specific API kromě cronu) |
| Monitoring | **strukturované logy** (JSON) ve Vercelu + `/api/health` | externí sběr chyb ani analytika nasazené nejsou (viz „Provoz" níž) |
| Testy | **Vitest** (engine: golden + property testy via fast-check), **Playwright** (E2E) | |

## Struktura monorepa

```
danero/
  apps/web/                  # Next.js — UI, API, auth, billing
  packages/engine/           # daňový engine (čistá logika, implementuje docs/02)
    src/model/               #   kanonické transakce, loty, TaxYearConfig (Zod)
    src/ledger/              #   lot ledger, korporátní akce (R-04)
    src/timetest/            #   časový test (R-01)
    src/limits/              #   100k / 50k paušál / 20k / 40M / 5M (R-02,03,08,09)
    src/basis/               #   § 10 párování FIFO/LIFO/… , § 8 dividendy (R-05,07)
    src/fx/                  #   jednotný kurz + ČNB denní (R-06)
    src/simulate/            #   simulace prodeje, porovnání variant
    test/golden/             #   fixture scénáře s ručně ověřenými výsledky
  packages/importers/        # parsery brokerů → kanonický model
    src/trading212/          #   CSV parser + API klient (MVP)
    src/universal/           #   univerzální CSV šablona
  packages/shared/           # sdílené typy, utility
  docs/
```

**Klíčový invariant:** engine je čistá funkce `(transactions, taxYearConfig, options) → výsledky`. DB ukládá transakce (zdroj pravdy) a cachuje výsledky; každý přepočet je plně reprodukovatelný. Oprava historických dat = přepočet od nuly (řeší stížnost uživatelů Taxomatu, že minulé roky nejde měnit — u nás jde, s audit logem změn).

## Datový model (hlavní tabulky)

- `users`, `sessions`, … (Better Auth) + `taxpayer_profiles` — režim: `pausal | zamestnanec | osvc | jine`; flags (obchodní majetek…); konfigurační přepínače z docs/02
- `broker_accounts` — typ, název, `credentials_encrypted`, stav poslední synchronizace
- `import_batches` — soubor/API sync, stav, chyby per řádek, surová data
- `instruments` — ISIN, ticker, název, typ (stock/etf/bond/crypto), měna, historie změn ISIN
- `transactions` — kanonický model (docs/03), `dedupe_hash` unique, odkaz na batch + raw řádek
- `corporate_actions` — ruční i odvozené, podtyp, poměr, `preserves_acquisition_date`
- `tax_reports` — cache výsledků per (rok × metoda párování × FX metoda)
- `notification_rules`, `notifications_log`
- `subscriptions` (Stripe) — F5

Vše tenantované přes `user_id`; každý DB dotaz jde přes repository vrstvu, která scoping vynucuje (+ integrační testy na cross-tenant izolaci).

## Zabezpečení (viditelná součást produktu)

Držíme citlivá finanční data → bezpečnost je marketingová výhoda proti Taxomatu, který ji nekomunikuje.

1. **Minimalizace dat**: k ničemu nepotřebujeme jméno, adresu ani rodné číslo — jen e-mail. Žádná napojení vyžadující hesla k brokerům; T212 API klíč je **read-only**.
2. **Šifrování**: API klíče brokerů šifrované na aplikační úrovni (AES-256-GCM, klíč v env, nikdy v DB); DB šifrovaná at-rest (Neon); TLS všude. Zálohy jsou `pg_dump -Fc` **bez vlastní šifrovací vrstvy** — leží na disku provozovatele, ne v cloudu.
3. **Auth**: scrypt (N=2^16, r=8 — 64 MiB, nativní `node:crypto`), TOTP 2FA se zálohovými kódy, rate limiting na login i per účet, session revokace při změně hesla.
4. **Aplikační**: Zod validace všech vstupů; parsování CSV s limity velikosti a řádků (ochrana proti CSV bombám), bez `eval`/formula injection při exportech; CSP a security headers; CSRF ochrana (Server Actions origin-check); závislosti hlídané přes `pnpm audit` + Renovate.
5. **Tenancy**: repository vrstva s povinným `user_id`; testy na izolaci.
6. **GDPR**: data v EU (Frankfurt), zpracovatelé vypsaní v `/soukromi` (Neon, Vercel, Resend, Stripe), právo na export (JSON) a smazání účtu (hard delete + purge záloh dle retence), privacy policy bez právního ptydepe.
7. **Provoz**: audit log (přihlášení, importy, změny dat) s retencí 90 dní; zálohy ručním `scripts/db.sh backup` s ověřenou obnovou. Externí sběr chyb (Sentry apod.) **nasazený není** — logy jsou ve Vercelu.
8. **Post-launch**: security.txt, responsible disclosure; případně externí mini-pentest před škálováním.

## Spolehlivost výpočtů (nejdůležitější vlastnost produktu)

- **Golden testy**: každé pravidlo R-xx z docs/02 má fixture scénáře s ručně ověřenými výsledky (vč. příkladů ze zdrojů — např. 120k tržba/5k zisk → prolomení 50k limitu).
- **Property testy** (fast-check): invarianty — počet kusů po splitu sedí; součet dílčích základů nikdy záporný (R-05d); dedupe idempotentní; přepnutí metody párování nemění celkové množství, jen alokaci.
- **Verifikace na reálných datech**: kompletní historie zakladatele z T212, křížová kontrola proti ručnímu Excelu (a proti Taxomat free tieru).
- **Odborná validace**: před veřejným spuštěním nechat metodiku (docs/02) zkontrolovat daňovým poradcem — jednorázová konzultace, levné pojistka.
- Verzování legislativy: `TaxYearConfig` per rok; výpočty pro 2025 se nezmění, když se změní zákon pro 2027.
