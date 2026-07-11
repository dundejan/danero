# Design systém Danero

Směr: **„růžový formulář, který pracuje pro tebe"**. Každý český poplatník zná růžový
daňový formulář („růžák") — symbol povinnosti a stresu. Danero si tu růžovou bere
a obrací její význam: z barvy úřadu je barva nástroje, který daně hlídá za tebe.
Spárovaná s inkoustovou modří a mono-číslicemi působí editorsky a prémiově, ne hravě.
Zároveň nás okamžitě odliší od genericky modrého Taxomatu i zelených fintechů.

## Barvy (tokeny)

| Token | Light | Dark | Použití |
|---|---|---|---|
| `--pozadi` | `#F6F5F1` (kancelářský papír, chladný) | `#15172B` (inkoust) | plocha |
| `--plocha` | `#FFFFFF` | `#1C1E36` | karty, panely |
| `--inkoust` | `#171930` | `#EDECE6` | text |
| `--inkoust-tlumeny` | `#5A5D78` | `#9A9DB8` | popisky, meta |
| `--ruzova` | `#D6336C` | `#F06E9B` | značka, primární akce, linie horizontu — **střídmě** |
| `--zelena` | `#2E8B62` | `#5CBD8F` | „osvobozeno" — barva odměny |
| `--jantar` | `#C7861B` | `#E3A93C` | pásmo WARNING (≥ 60 %) |
| `--oranz` | `#C25A25` | `#E07C42` | pásmo CRITICAL (≥ 85 %) |
| `--cervena` | `#B3362F` | `#E05D52` | EXCEEDED / chyby (čistá červeň ≠ růžová značky) |
| `--linka` | `#E4E2DA` | `#2B2E4A` | bordery, dělítka |

Zásada: růžová = značka a pozornost (CTA, aktivní stav, linie osvobození). Semafor
limitů jede na zelená/jantar/oranž/červená — funkční, naučitelné. Zelená má druhý
význam „daňově osvobozeno" (odměna za trpělivost).

### Grafy (G3)

Kategorické série v grafech mají vlastní tokeny `--graf-1…4` (light:
`#1C7ED6, #3B5BDB, #0CA678, #7048E8`; dark: `#339AF0, #5C7CFA, #0CA678, #845EF7`) —
pevné pořadí (největší kategorie = `--graf-1`), kontrast ≥ 3:1 vůči ploše karty
v obou režimech. Semaforové barvy se v grafech používají výhradně pro
stav/polaritu (zisk/ztráta, pásma limitů), nikdy jako běžná série. **Brand
růžová do sérií nepatří vůbec** (F1 z panelového testování) — zůstává jen
akcentem (čára „dnes", aktivní stav, hover); jednosériové grafy jedou na
`--graf-1`. Sloupce mají 2px mezeru (stroke plochy), mřížka a osy ustupují
datům (`--linka`, tlumený mono text). Víc než 4 kategorie = top 3 + „Ostatní".

## Typografie

| Role | Písmo | Poznámka |
|---|---|---|
| Display (nadpisy, čísla-hrdinové) | **Bricolage Grotesque** (600–800) | charakterní grotesk, výborné diakritice; používat střídmě |
| Text/UI | **Hanken Grotesk** (400–600) | čistý, humanistický, skvělá čitelnost |
| Data (částky, data, ISIN, odpočty) | **IBM Plex Mono** (400–500) | tabulární z podstaty; všechna čísla v tabulkách a gauge |

Měřítko: display 2.25/1.75/1.25 rem, text 1/0.875 rem, data 0.875 rem. Sentence case
všude („Nahrát výpisy", ne „Nahrát Výpisy").

## Layout

Aplikace: úzký levý rail (ikona + label: Přehled, Portfolio, Import, Report,
Nastavení), nahoře lišta s přepínačem roku a primární akcí „Simulovat prodej".
Obsah na 12sloupcové mřížce, radius 10 px, stíny minimální — plochý „inkoust na
papíře". Mobil: rail → spodní tab bar.

```
┌──────────────────────────────────────────────────┐
│ rok 2026 ▾                       [Simulovat prodej]│
├──────┬───────────────────────────────────────────┤
│ rail │ LIMITY: odměrky (svislé sloupce s ryskami  │
│      │ 60/85/100 %) — 50k paušál · 100k CP · §38v │
│      │                                            │
│      │ HORIZONT OSVOBOZENÍ  ← signatura           │
│      │ ─●──●●───●────┃růžová linie┃──●──●──→ čas  │
│      │  osvobozené   dnes      čekající loty      │
│      │                                            │
│      │ tabulka pozic (mono čísla, odpočty dní)    │
└──────┴───────────────────────────────────────────┘
```

## Signatura: Horizont osvobození

Vodorovný časový pás přes celou šířku dashboardu. Osa X = čas; **růžová svislá
linie = dnešek**; každý lot je tečka (velikost dle hodnoty) umístěná na datu svého
osvobození. Tečky nalevo od linie už jsou **zelené (osvobozené — prodej bez daně)**,
napravo inkoustové čekají a den po dni k linii putují. Hover = tooltip (ISIN, kusy,
datum osvobození, dní zbývá). Encoduje skutečná data — struktura je informace,
ne dekorace. Jediný orchestrovaný pohyb: při načtení dashboardu se odměrky naplní
a tečky rozjedou na svá místa (respektovat `prefers-reduced-motion`).

## Hlas (copy)

Česky, věcně, activní slovesa, druhá osoba jednotného čísla. Tlačítko říká, co se
stane: „Nahrát výpisy", „Spočítat dopad", „Stáhnout podklady". Chyby bez omluv,
s návodem: „Řádek 84: neznámý typ transakce ‚X'. Nahlaš nám ho — doplníme podporu."
Prázdný stav = pozvánka: „Zatím žádná data. Nahraj export z Trading212 a Danero
pohlídá zbytek." Odborné pojmy (§ 10, časový test) nechávat — cílovka je zná;
vysvětlení do tooltipů.

## Kvalitativní podlaha

Responsivní do 360 px, viditelný keyboard focus (růžový ring), `prefers-reduced-motion`,
kontrast AA (ověřit růžovou na inkoustu — na dark mode používat světlejší odstín),
dark mode = plnohodnotný, ne inverze.
