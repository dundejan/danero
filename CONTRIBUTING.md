# Jak přispět do Danera

Díky, že to zvažuješ. Nejcennější příspěvek je **podpora dalšího brokera** —
formáty výpisů se mění a jeden člověk je neuhlídá.

## Než začneš: jak je projekt řízený

Danero je otevřený kód, ne otevřené řízení. O směru produktu, o tom co se
přijme a co ne, rozhoduje vlastník projektu (Jan Dunder). U větší změny si
napřed **založ issue a domluv se** — ušetří to zbytečnou práci na obou stranách.

Odměna, která platí: **kdo přispěje parserem nebo anonymizovanou fixturou,
která povede k podpoře platformy, má hostovanou službu na danero.cz zdarma
napořád.**

## ⚠️ Nikdy neposílej reálné výpisy do issue nebo PR

Výpis z brokera jsou osobní údaje. Do veřejného repozitáře patří **jen
anonymizované vzorky**: smyšlené jméno a číslo účtu, změněné počty kusů a
částky, ponechaná jen struktura souboru (hlavičky, formát dat a čísel, druhy
řádků). Adresář `packages/importers/test/fixtures/real/` je gitignorovaný
a musí takový zůstat.

Máš jen syrový výpis a anonymizovat ho nechceš? **Pošli ho e-mailem na
dunder.jan@gmail.com** — po převedení na anonymní fixturu se maže.

## Přidání brokera

1. **Issue** „Podpora brokera X" s ukázkou hlavičky (jen názvy sloupců, žádná data).
2. Parser do `packages/importers/src/<broker>/`, výstup je kanonický model ze
   `packages/shared`. Sloupce mapuj **výhradně podle názvů**, nikdy podle pořadí
   — brokeři sadu sloupců mění mezi lety.
3. Test s anonymizovanou fixturou v `packages/importers/test/`.
4. Zaregistruj formát v `apps/web/test/import-detect.test.ts` (routing
   autodetekce) a v `apps/web/lib/brokers-catalog.ts` (katalog platforem).
5. Kontext k importní vrstvě: [docs/03](docs/03-brokeri-import.md),
   [docs/06](docs/06-import.md).

## Změny v daňové logice

Engine je čistá funkce bez I/O a implementuje **pravidla R-01…R-12
z [docs/02](docs/02-danova-pravidla.md)** — to je závazná specifikace.

Pořadí je vždy stejné: **nejdřív pravidlo do docs/02 se zdrojem** (paragraf
zákona, pokyn GFŘ), teprve pak implementace, a test odkazuje na ID pravidla.
PR, který mění výpočet bez opory v docs/02, nepřijmeme — ani když je věcně
správný. U sporných výkladů je řešením konfigurační přepínač: **default
bezpečný**, a aplikace zároveň ukáže, co by výhodnější výklad znamenal, včetně
poctivě popsaného rizika.

## Zvyklosti v kódu

- **Vše, co uvidí uživatel, je česky** (UI, chybové hlášky, e-maily) — včetně
  commit messages. Kód a identifikátory anglicky, komentáře česky.
- **Peníze výhradně `Decimal`**, nikdy `number`; v DB `numeric`/string. Datumy
  jsou ISO stringy.
- Zelené musí být všechno: `pnpm build && pnpm typecheck && pnpm test && pnpm lint`.
- Známé zrady prostředí (PGlite drží jediné připojení, rate limity T212 API,
  chování Next 16) jsou sepsané v [CLAUDE.md](CLAUDE.md) — vyplatí se přečíst,
  ušetří to hodiny.

## Podepisování commitů (DCO)

Commituj s `-s`:

```bash
git commit -s -m "Importér: podpora výpisů brokera X"
```

Podpis znamená souhlas s [Developer Certificate of Origin](https://developercertificate.org/)
— tedy že kód smíš přispět a že ho dáváš pod AGPL-3.0. CI to kontroluje.

## Chyby ve výpočtu

Máš-li podezření, že Danero počítá špatně, je to prioritní issue. Přilož:
**co jsi čekal, co vyšlo, a podle jakého pravidla** (ideálně R-xx z docs/02 nebo
paragraf zákona). Čísla klidně změň, ať nejde o tvoje reálná — důležitá je
struktura případu.

Bezpečnostní chyby patří jinam: [SECURITY.md](SECURITY.md).

## Self-hosting

Provozování vlastní instance je licencí výslovně dovolené a rádi ho vidíme.
Podpora k němu je ale **best effort, bez záruky** — dotazy do Discussions, ne
do issue. Název „Danero" a logo zůstávají chráněné, viz [TRADEMARK.md](TRADEMARK.md).
