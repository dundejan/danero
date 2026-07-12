# Danero — instrukce pro vývoj

Český SaaS hlídač daní z investic (konkurence Taxomatu). Uživatel „Jan" je OSVČ
v paušálním režimu, obchoduje přes Trading212 — je zároveň první testovací uživatel.

## Architektura (monorepo, pnpm + Turborepo, TypeScript)

- `packages/shared` — kanonický model transakcí (Zod v4), Decimal peníze, ISO datumy
- `packages/engine` — **čistý daňový engine bez I/O**; implementuje pravidla
  **R-01…R-11 z `docs/02-danova-pravidla.md`** (závazná specifikace! testy na ně odkazují)
- `packages/importers` — parsery brokerů → kanonický model, dedupe (FNV obsahu),
  T212 API klient, rekonciliace pozic
- `apps/web` — Next.js 16 App Router, Tailwind v4, Better Auth (+2FA), Drizzle;
  lokálně PGlite v `.data/` (migrace při startu), produkčně Postgres přes `DATABASE_URL`

Klíčový invariant: transakce v DB jsou zdroj pravdy, každý výpočet je čistá funkce
a jde reprodukovat od nuly. Engine nikdy nevidí formát brokera.

## Příkazy

```bash
pnpm dev                          # dev server :3000 (obsazený port: PORT=3001)
pnpm build && pnpm typecheck && pnpm test && pnpm lint   # musí být zelené před commitem
pnpm --filter @danero/web db:generate   # nová Drizzle migrace po změně schema.ts
```

Reálná anonymizovaná data Jana: `packages/importers/test/fixtures/real/*.csv`
(gitignored) — `real.test.ts` je automaticky testuje; používej je k verifikaci.

## Pravidla (závazná)

1. **Vše uživatelské česky** (UI, chyby, e-maily); commit messages česky. Kód/identifikátory anglicky, komentáře česky.
2. **Daňová logika jen podle docs/02** — každé pravidlo má ID R-xx; nové pravidlo
   nejdřív doplň do docs/02 (se zdrojem: paragraf, pokyn GFŘ), pak implementuj,
   testy odkazují na R-xx. Sporné výklady = konfigurační přepínač: **default bezpečný**,
   ale aplikace spočítá a ukáže, co by výhodnější výklad znamenal (+ poctivé riziko).
3. **Žádný daňový žargon v UI bez vysvětlení** jednou větou. Neptej se uživatele na
   nic, co jde zjistit z dat (např. W-8BEN detekujeme ze srážek).
4. **Nikdy nevyžaduj manuální kroky od Jana** během vývoje — všechno ověřuj
   automatizovaně (unit, E2E, curl na běžící instanci, reálné fixtury). Ptej se ho
   jen na produktová rozhodnutí nebo věci vyžadující jeho účty/klíče.
5. **Workflow každého uzavřeného celku**: implementace → testy (unit + E2E kde dává
   smysl) → ověření na běžící lokální instanci → `/code-review` a oprava nálezů →
   případný refaktoring → zelená pipeline → commit na main (česky, věcně).
6. Peníze **výhradně Decimal** (nikdy number), DB `numeric`/string. Datumy ISO stringy.
7. Bezpečnost: broker klíče jen read-only + AES-256-GCM (lib/crypto.ts), žádné
   secrety v kódu (produkce = env, dev = vygenerované v `.data/`), tenancy přes
   userId v každém dotazu.

## Známé zrady (ověřeno provozem — neobjevuj znovu)

- **PGlite**: jediné připojení (zámek!) — proto je auth/DB **líně inicializované**
  a `next build` se DB nesmí dotknout; `serverExternalPackages: ['@electric-sql/pglite','postgres']`
  nutné; testy s PGlite potřebují `{ timeout: 30_000 }`.
- **T212 API**: exporty mají limit ~1 dotaz/min (poll 65 s, trpělivé retry);
  prázdný rok = úplně prázdný soubor; dnešní obchody se do exportu propisují se
  zpožděním (rekonciliace může krátkodobě nesedět); klíč = pár „ID + tajný klíč",
  autentizaci (Basic vs. raw) si `resolveClient` zjišťuje sám; T212 posílá uživateli
  push notifikace o vygenerovaných dokumentech (v UI vysvětleno).
- **T212 CSV**: sloupce mapovat VÝHRADNĚ podle názvů (sada se mění); splity = pár
  řádků `Stock split close/open`; spin-off = příjem kusů s cenou 0; GBX = pence → GBP/100.
- **Zod v4**: `.default()` bere OUTPUT hodnotu (u Decimal polí `.default(ZERO)`).
- **Better Auth**: drizzle schéma musí přesně sedět na plugin (twoFactor vyžaduje
  i `verified`, `failedVerificationCount`, `lockedUntil` — při přidávání pluginů
  čti `node_modules/better-auth/dist/plugins/*/schema.mjs`).
- **Kurzy**: jednotné kurzy v `apps/web/lib/tax-config.ts` jsou zatím ORIENTAČNÍ
  (přesný jen 2025 dle D-75) — výdaj se přepočítává kurzem roku nákupu!
- `pkill` nezabije `next start` — použij `fuser -k PORT/tcp`.
- Next 16 odmítne druhý `next dev` nad stejným adresářem (zámek v `distDir/dev/lock`,
  i na jiném portu) — když už dev server běží (třeba jiná session), E2E pusť
  s odděleným distDir: `NEXT_DIST_DIR=.next-e2e pnpm test:e2e`. Alternativa
  `pnpm test:e2e:prod` (build + `next start`) funguje, ale server actions v ní
  mají občasné mnohasekundové latence (lokální kuriozita `next start` + PGlite;
  produkce běží na Postgres) — sada pak flakuje na 15s expect timeoutech.
- E2E timeouty jsou těsné (15 s) — na vytíženém stroji (souběžná session, load > 5)
  sada náhodně padá; spouštěj při klidu, pády ověř rerunnem konkrétního specu.
- Po neúspěšném syncu se nesmí nastavit `lastSyncedAt` (jinak se plná historie už nestáhne).

## Stav a plán

Hotové fáze F0–F5 (MVP kompletní vč. živého ověření na reálném účtu). Další vývoj:
**`docs/09-plan-v2.md`** — fáze G1–G10 s akceptačními kritérii. Průběh zapisuj tamtéž
(checkboxy) a po každé fázi doplň řádek do `docs/DENIK.md`.
