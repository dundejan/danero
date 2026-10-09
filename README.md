# Danero

**Daně z investic pod kontrolou — hlídač časových testů a daňových limitů pro
české investory.**

Danero hlídá, kdy jsou tvoje pozice osvobozené od daně (tříletý časový test),
kolik ti zbývá do limitu 100 000 Kč z prodejů cenných papírů, a — unikátně —
hlídá **limit 50 000 Kč pro OSVČ v paušálním režimu** (včetně zahraničních
dividend, které do něj počítají brutto). Umí simulovat „co když teď prodám X"
a spočítat podklady k daňovému přiznání včetně XML pro elektronické podání.

Nejde o daňové poradenství — je to výpočetní nástroj, který **můžeš zkontrolovat**.
Proto je kód otevřený a proto jsou [pravidla výpočtu](docs/02-danova-pravidla.md)
sepsaná s odkazy na paragrafy zákona a pokyny GFŘ.

## Otevřený kód a hostovaná služba

Danero si můžeš **rozjet sám** — pod [AGPL-3.0](LICENSE), se vším všudy a zdarma
(viz [self-hosting](docs/16-selfhosting.md)).

Nebo použij **hostovanou verzi na [danero.cz](https://danero.cz)** — je
**zdarma celá**, bez placené verze, bez zkušební doby a bez karty:

- import výpisů z neomezeného počtu platforem,
- limity, časové testy, horizont osvobození a orientační daň,
- podklady k přiznání včetně XML pro EPO,
- napojení platformy přes API s denní synchronizací,
- hlídací e-maily na limity a termíny,
- simulátor prodeje.

Danero je osobní projekt, ne firma. Na provoz jde dobrovolně přispět (odkaz je
na [danero.cz/cenik](https://danero.cz/cenik)), ale nic se tím neodemyká.

> **Historie:** do října 2026 měla hostovaná verze placené tarify (Stripe,
> paywall, obchodní podmínky pro prodej na dálku). Poslední nasazený stav s nimi je pod
> značkou [`placene-tarify`](https://github.com/dundejan/danero/tree/placene-tarify)
> — kdo by na platbách chtěl stavět, najde tam celou implementaci včetně testů.

## Co umí

- **Platformy:** Trading 212 a IBKR/Lynx živě přes API; parsery výpisů pro XTB,
  Degiro, Fio, eToro, Revolut, Kraken, Coinbase, Coinmate, Anycoin, Portu,
  MT4/MT5, RoboForex, Schwab, Tastytrade, Saxo, Swissquote; české banky a fondy
  vedeným importem přes univerzální šablonu.
- **Tři druhy příjmů podle § 10** bez vzájemné kompenzace — cenné papíry,
  kryptoaktiva, deriváty.
- **Podklady k přiznání a XML (DPFDP7)** ověřené zkušební podatelnou EPO.
- **Sporné výklady jako přepínač** — default vždy bezpečný, ale aplikace
  spočítá a ukáže, co by výhodnější výklad znamenal, i s poctivě popsaným rizikem.
- Zápočet zahraniční daně po státech dle smluv o zamezení dvojího zdanění,
  FIFO/LIFO, jednotný vs. denní kurz, splity, spin-offy, GBX.

## Rychlý start (vývoj)

```bash
pnpm install && pnpm dev     # → http://localhost:3000
```

Bez konfigurace: databáze je PGlite v `apps/web/.data/` (migrace při startu),
klíče se vygenerují samy. Reset = smazat `.data/`.

E-maily se při vývoji neodesílají. Ověřovací odkaz po registraci proto hledej
v terminálu, kde běží `pnpm dev` — vypíše se tam jako řádek `[email:dev]`.

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm lint   # musí být zelené
```

Vlastní instance (Postgres + aplikace + naplánované úlohy) běží přes
`docker compose up -d --build` — návod v [docs/16](docs/16-selfhosting.md).

## Architektura

Monorepo (pnpm + Turborepo, TypeScript strict). Klíčový invariant: **transakce
v databázi jsou zdroj pravdy, každý výpočet je čistá funkce a jde reprodukovat
od nuly.** Engine nikdy nevidí formát brokera.

| Balíček | Obsah |
|---|---|
| `packages/shared` | kanonický model transakcí (Zod), Decimal peníze, ISO datumy |
| `packages/engine` | čistý daňový engine bez I/O — pravidla R-01…R-15 |
| `packages/importers` | parsery brokerů, dedupe, API klienti, rekonciliace pozic |
| `apps/web` | Next.js 16 App Router, Tailwind v4, Better Auth (+2FA), Drizzle |

## Dokumentace

| Dokument | Obsah |
|---|---|
| [docs/02-danova-pravidla.md](docs/02-danova-pravidla.md) | **Specifikace daňového enginu** — pravidla R-xx s paragrafy a pokyny GFŘ, sporné výklady |
| [docs/03-brokeri-import.md](docs/03-brokeri-import.md) | Formáty brokerů a kanonický model |
| [docs/04-architektura.md](docs/04-architektura.md) | Datový model, zabezpečení, infrastruktura |
| [docs/06-import.md](docs/06-import.md) | Importní vrstva a přidání nového formátu |
| [docs/08-provoz.md](docs/08-provoz.md) | Provoz, zálohy, monitoring, roční runbook |
| [docs/16-selfhosting.md](docs/16-selfhosting.md) | Vlastní instance — konfigurace, cron joby, roční údržba |

## Přispívání

Nejcennější příspěvek je **podpora dalšího brokera**. Pravidla
v [CONTRIBUTING.md](CONTRIBUTING.md), zejména:
**do veřejného repozitáře nikdy neposílej reálné výpisy** (jsou to osobní údaje).

Bezpečnostní chyby: [SECURITY.md](SECURITY.md).

## Licence

[AGPL-3.0-only](LICENSE) — používej, uprav si, provozuj. Kdo Danero nabídne
jako službu dalším lidem, musí zveřejnit i své úpravy.

Název „Danero", logo a doména danero.cz pod licenci **nespadají** — viz
[TRADEMARK.md](TRADEMARK.md). Forkni si co chceš, jen tomu dej vlastní jméno.

## Právní upozornění

Danero je výpočetní a evidenční nástroj, **nikoli daňové poradenství** ve
smyslu zákona č. 523/1992 Sb. Výstupy jsou orientační podklady; za správnost
daňového přiznání odpovídá poplatník.

---

**English:** Danero is a Czech tax watchdog for retail investors — it tracks
capital-gains exemption limits, three-year holding tests and prepares the annual
tax return (incl. XML for the Czech e-filing portal). The product, docs and UI
are Czech-only by design; the code is AGPL-3.0 and contributions — especially
new broker statement parsers — are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).
