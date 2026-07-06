# Danero

**Daně z investic pod kontrolou — hlídač časových testů a daňových limitů pro české investory.**

Danero hlídá, kdy jsou tvoje pozice osvobozené od daně (tříletý časový test), kolik ti zbývá do limitu 100 000 Kč z prodejů cenných papírů, a — unikátně — hlídá **limit 50 000 Kč pro OSVČ v paušálním režimu** (včetně zahraničních dividend, které do něj počítají brutto). Umí simulovat „co když teď prodám X" a spočítat podklady k daňovému přiznání ve více variantách (FIFO/LIFO, jednotný vs. denní kurz).

Konkurence pro [Taxomat](https://taxomat.cz) — za zlomek ceny.

## Status

✅ **F0 + F1 hotové** — monorepo (pnpm + Turborepo, TS strict, CI) a daňový engine
(`packages/engine`) implementující pravidla R-01 až R-09 z docs/02, pokrytý 45 golden
a property testy (`pnpm test`). Další na řadě: **F2 — import Trading212** (docs/05).

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
