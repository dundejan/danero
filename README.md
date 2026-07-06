# Danero

**Daně z investic pod kontrolou — hlídač časových testů a daňových limitů pro české investory.**

Danero hlídá, kdy jsou tvoje pozice osvobozené od daně (tříletý časový test), kolik ti zbývá do limitu 100 000 Kč z prodejů cenných papírů, a — unikátně — hlídá **limit 50 000 Kč pro OSVČ v paušálním režimu** (včetně zahraničních dividend, které do něj počítají brutto). Umí simulovat „co když teď prodám X" a spočítat podklady k daňovému přiznání ve více variantách (FIFO/LIFO, jednotný vs. denní kurz).

Konkurence pro [Taxomat](https://taxomat.cz) — za zlomek ceny.

## Status

✅ **F0 + F1 + F2 hotové** — monorepo (pnpm + Turborepo, TS strict, CI), daňový engine
(`packages/engine`, pravidla R-01 až R-09 z docs/02) a importní vrstva
(`packages/importers`: Trading212 CSV + API klient, rekonciliace pozic, univerzální
šablona — docs/06). Celkem 70 testů. Další na řadě: **F3 — webová aplikace** (docs/05).

**Ověření na reálných datech:** vlož T212 exporty (CSV za každý rok) do
`packages/importers/test/fixtures/real/` a spusť
`pnpm --filter @danero/importers test` — viz docs/06-import.md.

```
pnpm install && pnpm build && pnpm test && pnpm lint
```

## Dokumentace

| Dokument | Obsah |
|---|---|
| [docs/01-trh-a-taxomat.md](docs/01-trh-a-taxomat.md) | Analýza trhu, Taxomatu a naše pozice |
| [docs/02-danova-pravidla.md](docs/02-danova-pravidla.md) | **Specifikace daňového enginu** — pravidla ZDP s odkazy na paragrafy, sporné body |
| [docs/03-brokeri-import.md](docs/03-brokeri-import.md) | Importní vrstva — formáty brokerů, kanonický model |
| [docs/04-architektura.md](docs/04-architektura.md) | Tech stack, datový model, zabezpečení, infrastruktura |
| [docs/05-plan.md](docs/05-plan.md) | Implementační roadmapa po fázích s akceptačními kritérii |

## Právní upozornění

Danero je výpočetní a evidenční nástroj, **nikoli daňové poradenství** ve smyslu zákona č. 523/1992 Sb. Výstupy jsou orientační podklady; za správnost daňového přiznání odpovídá poplatník.
