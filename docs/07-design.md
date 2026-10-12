# Design Danero

Reference designu po redesignu z října 2026. Čti ji celou, než sáhneš na jakoukoli
stránku — je krátká schválně.

**Dva jazyky, jedny tokeny.** Aplikace (`/prehled`, `/portfolio`, …, `/demo/*`) mluví
jazykem desktopových aplikací Macu: postranní panel, nástrojová lišta, seznamy, inspektor.
Veřejné stránky mluví redakčně jako apple.com: pásy přes celou šířku okna, velké titulky,
střídání ploch. Barvy, písmo, tlačítka a pohyb mají společné.

**Tři věty, které rozhodují spory:** hierarchii nese typografie a zarovnání, ne rámečky.
Na obrazovce je číslo, stav, termín a akce — výklad je na požádání. Barva nese stav,
nikdy ozdobu.

Živá galerie primitiv: `pnpm dev` → `/dev/primitiva` (jen ve vývoji, v produkci 404).

---

## 1. Tokeny (`apps/web/app/globals.css`)

Barvy jsou CSS proměnné v `:root` a `.dark`; Tailwind z nich dělá třídy (`bg-surface`,
`text-ink-muted`). Jinou barvu než token nepoužívej — `test/design-tokens.test.ts` shodí
třídu bez tokenu a hlídá kontrasty.

| Token | Světlý | Tmavý | K čemu |
|---|---|---|---|
| `surface` | `#ffffff` | `#000000` | plocha stránky a obsahu |
| `canvas` | `#f5f5f7` | `#1c1c1e` | druhotná plocha: postranní panel, panel, vybraný řádek, šedý pás |
| `control` | `#e8e8ed` | `#2c2c2e` | výplň ovládacích prvků (šedé tlačítko, dráha přepínače) |
| `ink` | `#1d1d1f` | `#f5f5f7` | text |
| `ink-muted` | `#6e6e73` | `#98989d` | druhotný text, popisky |
| `line` | `#d2d2d7` | `#38383a` | vlásové oddělovače (`divide-line/70`, `border-line/70`) |
| `line-control` | `#86868b` | `#6e6e73` | hranice polí a vypnutá dráha přepínače (≥ 3:1) |
| `accent` / `accent-fill` / `accent-text` | `#0071e3` / `#0071e3` / `#0066cc` | `#0a84ff` / `#0071e3` / `#2997ff` | ovládání: výplň hlavního tlačítka, odkazy, fokus, tečka loga |
| `accent-strong` | `#0058b0` | `#64b5ff` | text na akcentním tónu (tlačítko `tinted`) — `accent-text` na tónu nedrží AA |
| `success` (+`-text`, `-fill`) | `#248a3d` | `#30d158` | v pořádku, osvobozeno |
| `caution` (+`-text`) | `#b26b00` | `#ffd60a` | zvýšené čerpání, upozornění |
| `warning` (+`-text`) | `#c93400` | `#ff9f0a` | těsně pod limitem |
| `danger` (+`-fill`) | `#d70015` | `#ff453a` | přes limit, chyba, nevratná akce |
| `chart-1…8` | | | kategorické série grafů, pevné pořadí |

- **Akcent je modrá a je to zároveň barva značky** (tečka loga). Token `brand` neexistuje.
- **Modrá nikdy nenese stav.** Stav = zelená / žlutá / oranžová / červená, a vždy i slovem.
- `-text` odstíny jsou pro text (AA na `surface` i `canvas`), `-fill` pro výplň s bílým
  textem, holý název pro grafiku (odměrka, tečka).
- **Materiály** (`material-bar`, `material-tabbar`, `material-sidebar`, `material-sheet`):
  průsvitnost jen na chromu, pod kterým něco roluje — tedy na **lištách**. Postranní panel
  a sheet jsou plné plochy: panel stojí vedle obsahu (pod ním neroluje nic a rozostření
  se platilo za prázdno přes celou výšku stránky), sheet měl krytí 97 %, pod kterým
  rozostření nebylo vidět. Obsah je vždy plná plocha. Spodní lišta telefonu má vlastní,
  hustší materiál: nese nejdrobnější text a roluje pod ní cokoli, takže s krytím horní
  lišty klesly popisky pod AA.
- **Hrana lišty** (`scroll-edge`) se objeví, až pod lištu něco zajede. Kde nad lištou
  stojí pruh (demo), dostane pruh třídu `page-banner` a obal stránky
  `scroll-edge-after-banner` — hrana pak počká, až pruh odroluje.
- **Zvýrazněný řádek** (`row-hover` pod myší, `row-pressable` při stisku) přepíná tichý text
  na plnou barvu — `ink-muted` má na zvýrazněné ploše 4,06–4,45:1. Klikací řádek proto
  ber přes tyhle dvě třídy (nebo rovnou `Row href` / `DisclosureRow`), ne přes
  `hover:bg-(--highlight)`.
- **Stín** má jen to, co se vznáší: `shadow-floating` (bublina, dialog, sheet, toast),
  `shadow-thumb` (palec přepínače). Obsah stíny nemá.
- **Zaoblení:** `rounded-md` 8 px pole, `rounded-lg` 12 px řádek pod myší, `rounded-xl`
  16 px panel a skupina, `rounded-2xl` inspektor/dialog, `rounded-full` tlačítka.
- **Rozměry skořápky:** `--page-gutter`, `--page-top`, `--sidebar-width`, `--toolbar-height`,
  `--tabbar-height`, `--inspector-width`, `--column-gap`; veřejné stránky `--wrap-gutter`,
  `--band-y`, `--band-y-lg`, `--nav-height`. Veřejné stránky mají **jediný sloupec**
  `wrap-wide` (1056 px) — lišta, titulek stránky, obsah pásů i patička začínají na stejné
  levé hraně; šířku textu drží `measure`.

## 2. Typografie

Písmo je systémové (San Francisco / Segoe UI Variable / Roboto), nic se nestahuje. Jediná
výjimka je obrázek pro sdílení (`app/opengraph-image.tsx`): kreslí se na serveru, systémové
písmo nevidí, a tak má přibalenou podmnožinu Interu s plnou češtinou (`apps/web/assets/og`,
licence OFL vedle). Čísla
se zarovnávají přes `tabular-nums`, neproporcionální písmo se nepoužívá. Škála jsou třídy
`type-*` — nesou velikost, proklad, prostrkání i váhu naráz, takže **nepiš `text-2xl
font-bold`**, vyber stupeň.

| Třída | Velikost | Kde |
|---|---|---|
| `type-display` | 40–80 px | úvodní titulek veřejné stránky (jeden na stránku) |
| `type-headline` | 32–56 px | titulek pásu a titulek podstránky (veřejné stránky) |
| `type-title-1` | 28–40 px | hlavní sdělení stránky aplikace (verdikt), titulek formuláře |
| `type-title-2` | 22 px | nadpis sekce |
| `type-title-3` | 17 px | titulek lišty, panelu, inspektoru, sheetu |
| `type-lede` | 17–21 px | perex pod velkým titulkem |
| `type-reading` | 17 px | dlouhý text ke čtení (články, podmínky) |
| `type-body` | 15 px | výchozí text rozhraní |
| `type-callout` | 14 px | řádky seznamů, text sdělení |
| `type-footnote` | 13 px | popisky, tiché poznámky, text vysvětlivky |
| `type-caption` | 12 px | záhlaví tabulek, datum v řádku |
| `type-figure` / `-lg` / `-xl` | 22 / 28–34 / 56–120 px | čísla jako sdělení (`-xl` jen veřejné stránky) |

- `type-figure-lg` má strop `9vw`: při zvětšeném písmu prohlížeče velké číslo nevyjede
  z telefonu (nezalomí se, drží ho pevné mezery). Při výchozím písmu strop nezasáhne.
- Věty začínají velkým písmenem a tím to končí — žádné verzálky, žádné prostrkané štítky.
- Titulky dostávají `text-balance`, odstavce `text-pretty`.
- Text složený z řetězce protáhni přes **`tidy()` z `lib/typography.ts`** (nebo `<Tidy>`):
  neodtrhne předložku, číslo od jednotky („Kč“, „%“, „roky“, „hodin“), „§“ ani zkratku od
  čísla, nerozlomí datum a nenechá řádek začínat pomlčkou. Pravidla sazby jsou **jen tam**
  — `typeset()` pro text v JSX je jen průchod stromem, který `tidy()` volá.
  **`tidy()` vkládá jen pevné mezery, žádný jiný znak**: nezlomitelný spojovník v „e-mail“
  rozbil hledání v prohlížeči i kopírování. Aby se „e-mail“ nezlomil ve spojovníku,
  obalí ho `typeset()` stylem `whitespace-nowrap` — text s „e-mailem“ na viditelném místě
  proto pošli přes `typeset()`, ne přes `tidy()`. Krátké hlášky to dělají samy:
  `Toast`, `FieldError` a titulek s větou ve `FormPage` sází svůj text přes `typeset()`
  (hlídá `test/email-nowrap.test.ts`). Ve stejném
  souboru je `plainTitle()` (titulek upozornění bez obrázkového znaku) a `withoutLawRefs()`
  (titulek bez „(§ …)“).
- Částku v cizí měně píše `money()` z `lib/format.ts`: pevná mezera před kódem měny a pod
  haléř tři platné číslice („0,00031 CZK“, ne „0,00 CZK“).

## 3. Primitiva (`apps/web/components/ui/*` a skořápky)

| Soubor → export | Kdy použít |
|---|---|
| `ui/info-popover.tsx` → `InfoPopover` | Vysvětlení u čísla nebo pojmu: tlačítko „i“, bublina (na telefonu sheet). Hlavní nástroj textové diety. |
| `ui/info-print.tsx` → `InfoPrint` | Tisková kopie vysvětlivky: tentýž obsah, vidět jen na papíře. Stojí pod blokem, kterého se týká. |
| `ui/disclosure.tsx` → `DisclosureRow` | Řádek seznamu s titulkem a skrytým celým zněním (kontroly, upozornění, dlouhé texty z enginu). S `id` jde otevřít kotvou. Má-li se řádek otevřít sám podle stavu z adresy (dávka po nahrání, formulář s chybou), dostane `defaultOpen`, ne `open` — řízený atribut by ho při dalším vykreslení ze serveru zavřel. |
| `ui/disclosure.tsx` → `Disclosure` | Malý odkaz „ukaž víc“ pod textem (výčet případů, „Co to znamená“). Smí stát i uvnitř `DisclosureRow`. |
| `ui/disclosure.tsx` → `Chevron` | Šipka rozbalovátka pro vlastní `<details class="disclosure">` (řádek tabulky, FAQ). Patří do `<summary>`. |
| `ui/open-on-hash.tsx` → `OpenOnHash` | Rozbalí `<details>`, na který míří kotva v adrese. Jednou na stránku, která na rozbalovací řádky odkazuje. |
| `ui/list.tsx` → `Group`, `Row` | Seskupený seznam: popisek vlevo, hodnota nebo ovládací prvek vpravo. `variant="inset"` = šedá skupina (nastavení, sheet). `Row wrap` = hodnota je věta a smí se zalomit. Hodnotu, která se vedle popisku nevejde, řádek složí pod něj (nezkracuje ji). |
| `ui/list.tsx` → `FieldRow` | Řádek skupiny s polem nebo nabídkou; v úzkém okně se pole složí pod popisek. Stránka kolem potřebuje `@container`. |
| `ui/list.tsx` → `GroupItem` | Položka skupiny s volným obsahem (soubor s formulářem, limit s odměrkou). |
| `ui/section.tsx` → `Section`, `SectionHeader` | Sekce stránky aplikace: nadpis + vysvětlivka + počet + akce vpravo. Akce, která se vedle nadpisu nevejde, spadne pod něj; přepínač se posouvá sám. |
| `ui/stat.tsx` → `Stat` | Klíčové číslo s popiskem a nejvýš pár slovy pod ním. `size="lg"` nejvýš dvakrát na stránku. |
| `ui/status.tsx` → `StatusLabel`, `TONE_TEXT` | Stav jednou větou: barevná tečka + text téže barvy. |
| `ui/notice.tsx` → `Notice` | Sdělení k celé stránce/sekci (něco chybí, něco se stalo). Místo obarvené karty. |
| `ui/empty-state.tsx` → `EmptyState` | Sekce nebo stránka nemá co ukázat. `compact` do sekce. Stejná podoba i pro stav celé stránky (chyba, nenalezeno): `headingAs="h1"`, v `action` tlačítko a nejvýš jeden odkaz, `note` pro kód chyby. |
| `ui/button.tsx` → `Button`, `buttonVariants` | Tlačítko. `primary` jednou na stránku; `tinted` (druhá akce — drží kontrast i na šedém panelu), `secondary`, `ghost`, `danger`; velikosti `sm`/`md`/`lg`/`icon`. Popisek delší než rodič se zalomí a tlačítko povyroste — výška je `min-h`, ne `h` (kdo ji přebíjí, píše `min-h-…`). |
| `ui/submit-button.tsx` → `SubmitButton` | Odesílací tlačítko formuláře se stavem „odesílám“. |
| `ui/link.tsx` → `TextLink` | Textový odkaz. `chevron` = samostatný odkaz se šipkou; bez něj odkaz ve větě (podtržený). Umí i kotvu (`#…`), stažení (`download`) a cizí web (`external`) — vlastní `<a>` s třídami odkazu nepiš. |
| `ui/field.tsx` → `Field`, `Label`, `Input`, `Select`, `Textarea`, `Checkbox`, `FieldHint`, `FieldError`, `describedByError` | Formulářová pole. Chybu zapíná `aria-invalid` přes `describedByError`. |
| `ui/switch.tsx` → `Switch` | Přepínač pro nastavení, které platí hned. |
| `ui/file-field.tsx` → `FileField` | Výběr souborů s českými texty. |
| `ui/auto-submit.tsx` → `AutoSubmit` | Formulář, který se ukládá sám při změně pole. Dostane server action, která vrací výsledek (`action`), a adresu, která uloží totéž při odchodu ze stránky (`endpoint`). Adresu stránky ani historii prohlížeče nemění. Patří k němu skrytý stav formuláře (`lib/form-baseline.ts`, viz Formulář). |
| `ui/segmented-control.tsx` → `SegmentedControl` | Přepnutí pohledu (`toggle`) nebo adresy (`nav`) mezi 2–6 volbami (roků smí být víc). `size="md"` když je přepínač hlavní ovládání (odpověď v kalkulačce); `fit="content"` pro různě dlouhé popisky. U `nav` se palec pohne hned při klepnutí, na odpověď serveru nečeká. Když se nevejde, posouvá se sám uvnitř a vybraný segment si srovná do zorného pole — vlastní posuvný obal kolem něj nepiš. Výšku ani mřížku nepřebíjej třídou. |
| `ui/sheet.tsx` → `Sheet` | Spodní sheet na telefonu: detail řádku, další sekce, vysvětlivka. S `title` má hlavičku a „Hotovo“. Vedle `onClose` předej i `onReopen` (zavíraný sheet jde hodem nahoru vrátit a rodič má vědět, že je zase otevřený). Stav drží automat v `ui/sheet-machine.ts`. |
| `ui/confirm-dialog.tsx` → `ConfirmDialog` | Potvrzení nevratné akce. Jen pro nevratné. S `action` nese formulář sám (skrytá pole `fields`, viditelná jako `children`), během akce ukazuje `pendingLabel` a nejde odeslat dvakrát. |
| `components/toast.tsx` → `Toast` | Výsledek akce z adresy (`?ok=` / `?chyba=`); `floating` = plovoucí (odchází tam, odkud přijela; dlouhý text roluje uvnitř, nezakryje telefon). |
| `components/auto-save-feedback.tsx` → `AutoSaveFeedback` | Výsledek automatického uložení (`lib/save-feedback.ts`) — stejný `Toast`, jen bez adresy. Stojí v rozložení aplikace, protože uložení při odchodu ze stránky se potvrzuje až na stránce, kam člověk odešel. |
| `components/no-script-notice.tsx` → `NoScriptNotice` | Sdělení „Danero potřebuje zapnutý JavaScript.“ místo kostry načítání. Aplikace ani demo se bez skriptů nevykreslí a nepředstírají to; tlačítka v `<noscript>` do formulářů aplikace nepiš, nejde na ně dosáhnout. |
| `ui/table.tsx` → `Table`, `Th`, `Tr`, `Td` | Tabulka dat: vlásové linky, tiché záhlaví, čísla vpravo. |
| `ui/scroll-area.tsx` → `ScrollArea` | Obal široké tabulky na úzkém displeji (roluje jen tabulka). |
| `ui/card.tsx` → `Card`, `CardTitle` | Šedý panel kolem kusu FORMULÁŘE. Ne kolem obsahu ke čtení. |
| `components/app-toolbar.tsx` → `AppToolbar` | Hlavička stránky aplikace: titulek (jediné `h1`), přepínač, jedna akce. Podstránka má vlevo od titulku cestu zpět (`back`). |
| `components/view-switch.tsx` → `ViewSwitch` | Sekce se dvěma pohledy na tatáž data (graf / tabulka) nebo variantami téhož výpočtu. V tisku ukáže všechny pod sebou. |
| `components/year-switcher.tsx` → `YearSwitcher` | Přepínač zdaňovacího období do lišty. |
| `components/nav-items.ts` → `APP_NAV_ITEMS`, `DEMO_NAV_ITEMS`, `activeNavHref` | Sekce aplikace a která je pro adresu aktivní. Sekce má **jedno jméno** — stejné v panelu, ve spodní liště i v titulku stránky („Simulátor“, ne „Simulace“). |
| `components/app-skeleton.tsx` → `AppSkeleton`, `toolbarShape` | Kostra načítání skořápky. Stránka s přepínačem nebo akcí v liště se zapíše do `TOOLBAR_SHAPES`, jinak jí kostra na telefonu neposedí. |
| `components/shell-disclaimer.ts` → `NOT_TAX_ADVICE` | Krátký odkaz „Není daňové poradenství“ → článek 1 podmínek; jedno znění a jeden cíl pro patičku aplikace, dema i veřejných stránek. Stránka vlastní výhradu na obrazovce nenese (report ji má celou jen v tisku). |
| `components/theme-toggle.tsx` → `ThemeToggle` | Přepínač vzhledu, všude se stejnými popisky; změnu prolne. Barvu lišty prohlížeče po ruční volbě srovnává `ThemeProvider` (`components/theme-color.ts`). |
| `components/limits-inspector.tsx` → `LimitsInspector` | Seznam + detail vybraného řádku (inspektor; na telefonu sheet). |
| `lib/use-container-wide.ts` → `useContainerWide` | „Je okno s obsahem dost široké na inspektor?“ — pro rozvržení, kde šířka mění i chování (výběr řádku × odkaz). |
| `components/limit-gauge.tsx` → `LimitBar`, `ZONE_TEXT`, `ZONE_LABEL` | Odměrka čerpání limitu a slovní stav. |
| `lib/limit-names.ts` → `LIMIT_NAME`, `limitWithAmount`, `limitTitle` | Jména limitů — jedno pro každý limit na přehledu, v reportu, v simulátoru i v Nastavení („Limit paušální daně“, „Osvobození prodejů cenných papírů“…). Jméno je bez částky; tu připojí `limitWithAmount` (ve větě) nebo `limitTitle` (titulek) ze stavu limitu nebo z konfigurace roku. Limit nikdy nepojmenovávej ve stránce znovu. Stejná jména nesou upozornění hlídače a předměty e-mailů (`lib/notifications.ts`) i první věta kontroly o prolomeném paušálním limitu z enginu — shodu hlídá `test/notification-names.test.ts`. Limit se „prolomí“, osvobození prodej „zruší“. |
| `components/tax-figure.tsx` → `TaxFigure`, `TaxFigureInfo`, `DividendTaxationRow`, `TaxResultRows`, `TAX_NAME`, `DUE_NAME` | Hlavní číslo daně vedle verdiktu a jeho rozpad — jediný zdroj pro přehled, report i simulátor. Jména jsou dvě: „Orientační daň z investic“ a „Doplatek daně“ (po odečtení záloh z paušálního režimu); která z nich je hlavní, rozhoduje `taxSummary()` z `lib/payable-tax.ts`. Varianty zdanění dividend jsou volba, ne sčítance (`DividendTaxationRow`). |
| `components/epo-export-form.tsx` → `EpoExportForm` | Formulář exportu XML v reportu: osobní údaje a pole dodatečného přiznání za rozbalením, chyba pole sekci otevře a zaměří. Odesílá ho i tlačítko „Stáhnout XML“ v liště (`EPO_FORM_ID` z `lib/epo-form.ts`). |
| `components/marketing-page.tsx` → `MarketingPage`, `PageHero`, `Band`, `BandHeading`, `PageClosing` | Skořápka veřejné stránky: lišta, titulek, pásy, závěr stránky, patička. `PageClosing` nemá parametry — je všude stejný. |
| `components/marketing-blocks.tsx` → `Split`, `SpecList`, `SpecRow`, `LinkList`, `SECTION_TITLE` | Obsah pásů: titulek vlevo + text vpravo; list „pojem — co k němu patří“; seznam odkazů „titulek + věta + šipka“; třídy nadpisu oddílu na podstránce. |
| `components/guide-article.tsx` → `ArticleBody`, `ArticleIntro`, `ArticleSection`, `ArticleList`, `Example`, `DisputedReading`, `ArticleLink`, `ArticleFooter`, `Prose` | Dlouhý text: článek průvodce z bloků, právní text přes `Prose`. `ArticleBody contents` přidá obsah stránky; `ArticleSection` umí kotvu (`id`), mezititulky `h3` a `footnote`. |
| `components/typeset.tsx` → `typeset` | Česká sazba textu psaného v JSX (odstavce s odkazy a tučnými místy): projde strom a pustí `tidy()` na textové listy; slovo „e-mail“ navíc obalí, aby se nezlomilo ve spojovníku. Volají ho obaly dlouhých textů, ne stránky — stránka jen tehdy, když jí jde o „e-mail“ v krátkém textu. Pravidla sama jsou v `tidy()`. |
| `components/long-read.tsx` → `LongRead`, `PROSE_ANCHORS`, `ANCHOR_OFFSET` | Dlouhý text s obsahem stránky (metodika, podmínky, soukromí): obsah vpravo zůstává na očích, na telefonu nad textem. |
| `components/faq-list.tsx` → `FaqList` | Otázky a odpovědi nad `<details>`. |
| `components/form-page.tsx` → `FormPage` | Stránka s jediným formulářem mimo aplikaci (přihlášení, registrace…). |
| `components/logo.tsx` → `Logo`, `LogoMark` | Značka. Tečka je `accent`. |

Ukázky:

```tsx
// Číslo s výhradou a vysvětlivkou. Výhrada (pár slov) je vidět, výklad na požádání.
<Stat
  size="lg"
  label="Doplatek daně"
  value={czk(amount)}
  note="orientačně, jen z investic"
  info={
    <InfoPopover label="Doplatek daně" title="Jak doplatek vznikl">
      <p>{tidy('Daň z podnikání (§ 7) Danero nevidí…')}</p>
    </InfoPopover>
  }
/>

// Sekce se seznamem „popisek — hodnota“.
<Section title="Daň z investic" info={<InfoPopover label="Daň z investic">…</InfoPopover>}>
  <Group footer="Krypto je plně osvobozené.">
    <Row label="Základ daně z prodejů" hint="z toho deriváty 8 552 Kč" value="8 552 Kč" />
    <Row strong label="Orientační daň z investic" value="2 180 Kč" />
  </Group>
</Section>

// Dlouhý text ze zdroje: titulek + rozbalení, zdroj se nepřepisuje.
<Group>
  <DisclosureRow title={plainTitle(n.title)} meta={czDate(n.createdAt)}>
    <p>{n.body}</p>
  </DisclosureRow>
</Group>

// Nastavení: šedá skupina, přepínač vpravo.
<Group variant="inset" title="Upozornění">
  <Row label="E-mail při 85 % limitu"><Switch name="limit85" aria-label="E-mail při 85 % limitu" /></Row>
</Group>

// Nastavení s polem: v úzkém okně se pole složí pod popisek.
<Group variant="inset">
  <FieldRow label="Souhrn" htmlFor="frekvence" hint="Jednou týdně, v pondělí.">
    <Select id="frekvence" name="frekvence">…</Select>
  </FieldRow>
</Group>

// Nevratná akce nad server action: skrytá pole přes `fields`, stav „probíhá“ má dialog sám.
<ConfirmDialog
  trigger={<Button variant="danger" size="sm">Vrátit import zpět</Button>}
  title="Vrátit import zpět?"
  description="Smažeme 12 transakcí, které přibyly tímhle importem."
  confirmLabel="Vrátit import zpět"
  pendingLabel="Vracím…"
  action={undoImportAction}
  fields={{ davka: batch.id }}
/>

// Totéž s viditelnými poli (heslo); po neúspěchu ho server otevře znovu.
<ConfirmDialog … action={deleteAccountAction} defaultOpen={deleteError !== null}>
  <Field label="Heslo" htmlFor="heslo"><Input id="heslo" name="heslo" type="password" /></Field>
  {deleteError && <FieldError id="smazani-error">{deleteError}</FieldError>}
</ConfirmDialog>

// Vysvětlivka, která má být i na papíře.
<Section title="Použité kurzy" info={<InfoPopover label="Použité kurzy">{ratesInfo}</InfoPopover>}>
  <Table>…</Table>
  <InfoPrint>{ratesInfo}</InfoPrint>
</Section>
```

Pravidla, která z kódu nejsou vidět:

- `InfoPopover` nesmí stát **uvnitř** tlačítka ani odkazu (ani v klikacím `Row href`).
  Jinak smí stát všude, kde smí stát text: bublina i sheet (úzké okno) se vykreslují
  portálem do `<body>`, takže `<dialog>` s nadpisem neskončí v `<span>`, `<dt>` ani `<p>`.
  Jeho obsah se vykreslí až po otevření — co musí být vidět vždy, patří vedle čísla, co má
  být na papíře, dostane `InfoPrint`.
  Uvnitř `Stat` se bublina kotví pod celý blok sama; jinde zvol `side`/`align` tak, aby
  nezakryla číslo, které vysvětluje.
- `InfoPopover label="X"` dává tlačítku přístupný název **„Vysvětlení: X“**. Když je X
  zároveň popisek pole, najde `getByLabel('X')` pole i tlačítko a Playwright spadne na
  strict mode — v testu použij `getByRole('textbox', { name: 'X' })` nebo `exact`, v kódu
  dej vysvětlivce `label`, který říká, co vysvětluje („jak funguje souhrn“).
- Děti `Group` jsou `Row`, `FieldRow`, `DisclosureRow` a `GroupItem` (skupina je pro čtečku
  seznam) — `role="listitem"` ručně nepiš.
- **Kotvy a rolování po server action.** Přesměrování bez kotvy odroluje stránku nahoru;
  kotva na existující prvek k němu skočí; kotva na prvek, který na stránce není, nechá
  polohu být (tak ukládá `/nastaveni/upozorneni` — `#ulozeno`). Odkaz na kotvu téže stránky
  piš přes `TextLink` (obyčejné `<a>`): směrovač Nextu při změně samotné kotvy nevyvolá
  `hashchange`. Míří-li kotva na zavřený `DisclosureRow`, stránka potřebuje `OpenOnHash`.
  Cíl kotvy pod přilepenou lištou potřebuje odstup (`ANCHOR_OFFSET`, v aplikaci
  `scroll-mt-24`).
- **Dlouhý obsah je starost primitiva, ne stránky.** `Row`, `Button`, `SegmentedControl`,
  `AppToolbar`, `DisclosureRow`, `EmptyState`, `Notice` a `Sheet` unesou e-mail o sto
  znacích, název fondu bez tickeru i dvojnásobné písmo bez přetečení stránky: hodnota
  řádku spadne pod popisek, popisek tlačítka se zalomí, přepínač roluje uvnitř, titulek
  lišty se zkrátí (celé znění nese `title`). Místní `max-w-…`, `truncate` nebo vlastní
  `overflow-x-auto` kolem primitiva proto nepiš — a zkracování třemi tečkami nech jen
  titulku lišty: useknutou částku nebo adresu na dotyku nejde přečíst nikde. Nejhorší
  vstupy má galerie v sekci „Dlouhý obsah“.
- **Sheet a překryvy zamykají rolování stránky samy** (`html:has(dialog:modal)` v
  globals.css). Překryv, který nativním dialogem není (rozbalené menu veřejných stránek),
  dostane po dobu otevření atribut `data-scroll-lock` na kterýkoli svůj prvek.
- Odkaz, který je ovládacím prvkem navigace aplikace (spodní lišta, postranní panel,
  segment přepínače), nese třídu `control-link` — dlouhý stisk mu neoznačí popisek ani
  nevyvolá nabídku odkazu. Odkazy v textu a na veřejných stránkách ji nedostávají.
- Tabulku na úzkém displeji obal do `ScrollArea`; první sloupec text, čísla `align="right"`.
- Když primitivum chybí, **nepiš si vlastní do stránky**. Slož ho z existujících, nebo ho
  navrhni zvlášť (viz Sdílené soubory). Dialogy, popovery a menu staví na Base UI
  (`@base-ui/react`), pružiny na `motion` — vlastní past na fokus nepiš.

## 4. Vzory stránek

### Stránka aplikace

```tsx
<>
  <AppToolbar title="Portfolio" actions={<Link className={buttonVariants({ size: 'sm' })} …>…</Link>}>
    <YearSwitcher … />
  </AppToolbar>
  <div className="max-w-[72rem] space-y-14 pt-2 md:pt-4">
    {/* 1. odpověď: stav + jedna věta + nejvýš dvě čísla */}
    {/* 2. sekce pod sebou: <Section title="…"> … </Section> */}
  </div>
</>
```

- Jedna lišta, jeden `h1` (titulek lišty), jedno `primary` tlačítko.
- Nahoře odpověď na otázku, kvůli které člověk stránku otevřel; až pod ní data.
- Sekce dělí vzduch (`space-y-14`), ne rámečky. Dvě příbuzné sekce vedle sebe:
  `<div className="@container"><div className="grid gap-x-(--column-gap) gap-y-14 @3xl:grid-cols-2">`.
- Rozvržení se řídí šířkou okna s obsahem (`@container`, `@3xl:`), ne šířkou prohlížeče.
- Vzor: `components/views/overview-view.tsx`.

### Veřejná redakční stránka

```tsx
<MarketingPage active="cenik">
  <PageHero eyebrow="Proč zdarma" title="Danero je zdarma. Celé." lede="…" />
  {/* pás pojmenovaný svým nadpisem */}
  <Band tone="canvas" aria-labelledby="platformy-nadpis">
    <BandHeading id="platformy-nadpis" title="Odkud načte obchody" />
    <SpecList className="mt-10">
      <SpecRow label="Živě přes API">…</SpecRow>
    </SpecList>
  </Band>
  <Band>
    <Split title="Proč se neplatí"><p>…</p></Split>
    <Split divided title="Kde je háček"><p>…</p></Split>
  </Band>
  <PageClosing />
</MarketingPage>
```

- Stránka je sled pásů; sousední pásy střídají `surface` a `canvas`. Jeden pás = jedna
  myšlenka. Černý pás neexistuje: v tmavém režimu měl stejnou plochu jako stránka.
- V pásu je titulek (`type-headline`), nejvýš jeden perex a obsah. Žádné karty s rámečkem,
  žádné verzálkové štítky, žádné ikony v kroužku. Seznam výhod je seznam, ne mřížka dlaždic.
- Sloupec je jeden (`wrap-wide`): titulek stránky, obsah pásů i patička lícují s logem
  v liště. Text drž v `measure` (≈ 62 znaků); živé kusy rozhraní smí přes celý sloupec.
- `eyebrow` u `PageHero` je volitelný — říká, kde čtenář je, když to neříká titulek sám.
- Závěr stránky je `<PageClosing />` — na všech stránkách tentýž: jedna věcná věta a dvě
  akce (demo, založení účtu) na ploše `canvas`, bez titulku a bez vlastního textu podle
  stránky. Žádné slogany. Pás před ním je proto `surface`. Kde závěr nic nepřidává
  (právní texty, 404, kalkulačka — tam akce nese verdikt), stránka ho nemá.
- Že je Danero zdarma, říká úvod jednou v titulku a jednou v pásu „Proč je zdarma“;
  tlačítka příponu „zdarma“ nenesou. Hlídá `test/public-pages.test.ts`.
- **Čtenář je kdokoli, kdo investuje, ne vývojář.** Úvod se rámuje „Bezpečně a zdarma“
  a obě slova hned dokládá faktem (připojení jen pro čtení s odkazem na `/bezpecnost`,
  žádná placená verze). „Otevřený kód“, „open source“ ani „osobní projekt“ na úvod, do
  patičky, titulků a obrázku pro sdílení nepatří. Veřejný kód je důkaz, ne heslo: stojí na
  `/bezpecnost`, `/o-projektu` a „Proč zdarma“ obyčejnými slovy („kdokoli se může podívat,
  co Danero s daty dělá“). Výjimka je „Proč zdarma“, kde mluví autor sám za sebe.
- Nadpis oddílu na podstránce je `SECTION_TITLE` (na telefonu o stupeň menší než titulek
  stránky), ne holé `type-title-1`.
- Úvodní stránka má `type-display` a `type-figure-xl`; podstránky `type-headline`.
- Hlas: veřejné stránky mluví za Danero ve třetí osobě nebo v množném čísle („čteme“,
  „Danero spočítá“). První osoba autora patří jen na `/o-projektu` a `/cenik` („Proč
  zdarma“), kde mluví sám za sebe.

### Dlouhý textový článek

```tsx
<MarketingPage>
  <PageHero eyebrow="Průvodce" title="…" lede="…" />
  <ArticleBody>
    <ArticleIntro>Krátká odpověď článku.</ArticleIntro>
    <ArticleSection title="…"><p>…</p><Example title="…">…</Example></ArticleSection>
    <ArticleFooter next={[…]} />
  </ArticleBody>
  <PageClosing />
</MarketingPage>
```

Dlouhý text má obsah stránky: článek přes `<ArticleBody contents={[{ id, title }]}>`,
metodika a právní texty přes `<LongRead contents={…}>` kolem `ArticleSection id="…"` nebo
kolem `<Prose className={PROSE_ANCHORS}>` s obyčejnými `h2 id="…"`.

Právní a metodické texty s vlastní strukturou: `<Prose>` kolem obyčejných `h2`/`p`/`ul`.
Tady text zůstává — dieta se týká rozhraní, ne článku, který si člověk přišel přečíst.
Odkaz uprostřed věty je vždy podtržený.

- **Text ke čtení je `ink`.** Tělo článku, metodiky i právního textu se sází barvou textu;
  `ink-muted` patří perexu, popisku („Příklad“), zdroji a poznámce pod čarou.
- **Sazbu dělá obal.** `Prose`, `ArticleSection`, `FaqList`, `SpecRow`, `Split` a `LinkList`
  protáhnou obsah přes `typeset()` — odstavec ve stránce se píše obyčejně, bez `tidy()`
  a bez `&nbsp;`. U právních textů smí sazba změnit jen druh mezer, nikdy znění
  (`test/typeset.test.ts`).

### Formulář

- Mimo aplikaci: `<FormPage title="Přihlášení" lede={…} footer={…}> <form>…</form> </FormPage>`.
- V aplikaci (nastavení): `Section` → `Group variant="inset"` s řádky `FieldRow` (pole,
  nabídka) a `Row` (přepínač, tlačítko). Samostatný kus formuláře mimo seznam: `Card` →
  `Field` + tlačítko. Popisek, nápověda jedna věta (`hint`), delší výklad do `info`.
  Chyba pod polem (`FieldError`) — v dialogu jen tehdy, když pole v dialogu je.
- Volba, která platí hned = `Switch`; volba odesílaná formulářem = `Checkbox`.
- Výsledek akce hlásí `Toast`, nevratnou akci potvrzuje `ConfirmDialog`. Výsledek, který
  mluví o konkrétním seznamu na stránce (nahrání a vrácení importu → historie importů),
  neplave: je to `Notice` v toku stránky hned nad tím seznamem — plovoucí hláška na telefonu
  ležela přes řádek, o kterém mluvila. Kód výsledku z adresy pak uklidí `ClearFeedbackUrl`.
  Taková hláška nemizí sama, takže ji po úklidu adresy musí držet prohlížeč: stránka se
  umí obnovit i bez uživatele (doběhne synchronizace) a ze serveru už přijde bez ní
  (vzor: `app/(app)/import/upload-result.tsx`).
- Totéž platí pro chybu u pole: formulář, který ji ukazuje podle kódu z adresy, si výsledek
  akce drží v prohlížeči (`lib/action-result.ts`; vzor: `nastaveni/ucet/account-forms.tsx`).
  Řádek s formulářem otevírej přes `defaultOpen`, nikdy řízeným `open`, a nedávej mu klíč,
  který se mění při každém vykreslení — obojí ho při obnovení stránky zavře uživateli pod
  rukama i s rozepsaným textem.
- Formulář s auto-save (`AutoSubmit`) nese skrytý stav, se kterým byl vykreslen, a server
  zapisuje jen pole, která se od něj liší (`lib/form-baseline.ts`) — panel se starým stavem
  tak nepřepíše změnu udělanou jinde. Výchozí hodnoty polí i skrytý stav ber z jednoho místa
  (vzor: `app/(app)/nastaveni/form-state.ts`) a formuláři dej `key` podle toho stavu.
  Uložení formulář vykreslí celý znovu; fokus přitom zůstává na poli, kde byl, a rozepsaný
  text se neztratí — předá si je starý a nový formulář (`lib/focus-handoff.ts`). Hodnoty
  ostatních polí jsou vždy ze serveru; jen dokud další uložení ještě běží, ukazuje formulář
  stav, který právě odchází (jinak by změna na chvíli skočila zpátky).
- Auto-save nepřesměrovává: výsledek vrací akce a ukáže ho `AutoSaveFeedback`, adresa ani
  historie prohlížeče se nemění (dřív každá změna přidala krok a Zpět z Nastavení chtělo
  tolik stisků, kolik bylo změn). Odeslání řadí `lib/save-queue.ts` — jdou za sebou, změny
  během ukládání se slijí — a stránku ze serveru dotáhne až poslední v řadě.
- Text, který člověk napsal a pole neopustil, se neztrácí: uloží se při odchodu ze stránky
  (Zpět, odkaz, skrytí i zavření panelu, F5) požadavkem, který odchod přežije
  (`/api/settings/*`, `lib/auto-save-route.ts`; kde prohlížeč neumí `fetch` s `keepalive`,
  jde při zániku dokumentu přes beacon — `lib/leaving-request.ts`), a po F5 ho pole hned
  ukazuje (`lib/leaving-draft.ts`). Ukládá se jen text, který prokazatelně psal člověk. Neplatný
  text server odmítne: hláška to řekne i na stránce, kam člověk odešel, pole zůstane
  označené a ostatní změny se uloží bez něj. Pole s pevným tvarem má dostat `pattern`
  (a větu k němu v `title`) — podle něj se při zavírání panelu s neplatným textem prohlížeč
  zeptá, jestli opravdu odejít; jinde už to říct nejde.
- Co auto-save nesmí (revize R7 — každý bod byla naměřená tichá ztráta nebo nepravda):
  - **potvrdit přes odmítnutí.** Dokud v poli leží text, který server odmítl, potvrzení jiné
    změny říká obojí („Ostatní změny jsou uložené. …“) a odmítnutý text i s `aria-invalid`
    přežije nové vykreslení formuláře;
  - **tvrdit stav, který nezná.** Když odpověď na uložení nepřijde, formulář se zamkne
    (`inert`, `data-auto-submit="unsynced"`) a stav si vyžádá ze serveru, až je zase
    dosažitelný; do té doby neukazuje ani starou, ani novou volbu jako platnou;
  - **nechat starší odeslání přepsat novější.** Odeslání nese pořadí
    (`SUBMISSION_FIELD` v `lib/form-baseline.ts`) a server starší odeslání téhož formuláře
    nezapíše — odchod ze stránky posílá čekající změnu souběžně s tou, která ještě běží;
  - **vrátit hodnotu z poznámky pro F5,** kterou uživatel mezitím přepsal, nebo ji nabídnout
    jinému účtu: poznámka vzniká jen při zániku dokumentu a nese označení účtu
    (`lib/owner-tag.ts`);
  - **ukázat hlášku dvakrát nebo cizímu účtu:** hláška, která z obrazovky odešla, se z úložiště
    maže a patří jen účtu, jehož formulář ji vyvolal (`lib/save-feedback.ts`).
- Formulář, který odesílá skript, má `method="post"`. Než skript naběhne (nebo když je
  vypnutý), odešle ho prohlížeč sám — a bez metody by pole včetně hesla skončila v adrese.

## 5. Textová dieta

Janovo zadání: *„na hodně stránkách je hodně textu, který je zbytečný, anebo by měl být
schovaný v info ikonkách.“* Závazná pravidla:

1. **Na obrazovce je jen to, co člověk v tu chvíli potřebuje k rozhodnutí:** číslo, stav,
   termín, akce.
2. **Vysvětlení patří do `InfoPopover`** u konkrétního čísla či pojmu (proč, jak se to
   počítá, výjimky, metodika), případně za odkaz na `/jak-pocitame`. **Číslo paragrafu
   nikdy v hlavním textu** — jen ve vysvětlivce, v rozbaleném detailu a v článcích.
3. **Výhrada, která chrání před špatným závěrem, nesmí zmizet** — zkrať ji na pár slov
   u čísla („orientačně, jen z investic“, „Platí se jen při podání přiznání“) a zbytek dej
   do vysvětlivky. Patří sem i výhrada v patičce: krátký odkaz **„Není daňové
   poradenství“** → `/podminky#co-danero-je` (článek 1 podmínek, kde je závazné znění),
   stejný v aplikaci, v demu i na veřejných stránkách. Celou větu do patičky nevracej —
   na každé stránce se neopakuje.
4. **Žádný úvodní odstavec pod nadpisem**, který nadpis jen opakuje. Žádná vysvětlivka
   ke grafu, který je srozumitelný sám; legenda ano, návod ne.
5. **Žargon nahraď obyčejným slovem;** kde to nejde, jednověté vysvětlení je ve vysvětlivce
   (pravidlo 3 z CLAUDE.md tím zůstává splněné).
6. **Fakta nevymýšlej a zdroj nepřepisuj.** Texty z enginu a z `lib/` (kontroly výpočtu,
   upozornění — ta jsou zároveň předmět e-mailu) se zkracují *zobrazením*: titulek
   v `DisclosureRow`, celé znění po rozbalení. Engine a daňová logika se nemění.
7. **Test, který hlídal doslovné znění zkráceného textu,** uprav tak, aby dál hlídal význam
   (správný termín, částku, přítomnost výhrady). Obsah vysvětlivky se v
   `renderToStaticMarkup` neobjeví — test si `InfoPopover` nahradí obalem
   (vzor: `test/payable-tax.test.ts`).

Zkouška: zakryj odstavec. Rozhodne se člověk hůř? Když ne, odstavec patří pryč nebo za „i“.

Příklad z přehledu — bylo pod verdiktem: dva odstavce o datové schránce, lhůtě, ČSSZ
a základu z § 7. Je: `Termín podání 3. 5. 2027 · jen elektronicky ⓘ` a `Doplatek daně
980 Kč ⓘ` se dvěma tichými řádky pod číslem: `daň 2 180 Kč − zálohy 1 200 Kč` (odkud
doplatek je) a `orientačně, jen z investic · navíc pojistné a přehledy` (výhrada).

**Grafy limitů mají jedinou vodicí čáru: limit.** Pásma 60 a 85 % se nekreslí nikde.

## 6. Pohyb

- **Odezva při stisku, ne po uvolnění.** Tlačítko se při `:active` zmenší na 0,97
  (`pressable`, 100 ms), řádek se zvýrazní (`row-pressable`). Hover jen přes `hover:`
  (Tailwind ho omezuje na zařízení s myší).
- **Co se dělá stokrát denně, se neanimuje:** navigace, přepnutí vybraného řádku, rozbalení
  `details`, otevření klávesnicí. Čísla a odměrky se při načtení neplní.
- **Odezva hned, ne po odpovědi serveru.** Palec přepínače roku se pohne při klepnutí
  (optimisticky) a vrátí se jen tehdy, když navigace nedopadne.
- **Co se objevuje, vyrůstá ze svého spouštěče:** bublina z tlačítka (i když je ukotvená
  k celému bloku), sheet zdola a tamtéž zpět, dialog ze středu, toast odkud přijel.
  Začátek `scale(0.95)` + průhlednost, nikdy `scale(0)`. Přechody v CSS do 250 ms, křivka
  `--ease-out`; nikdy `ease-in`, nikdy `transition-all`. **Odchod je kratší než příchod**
  (bublina 150/100 ms, dialog 200/150 ms, sheet odezva 0,35/0,25 s).
- **Past Tailwindu v4:** `scale-*`, `translate-*` a `rotate-*` se píšou do vlastností
  `scale`/`translate`/`rotate`, ne do `transform`. Přechod `transition-[transform,opacity]`
  je proto neanimuje — měřítko skočí. Piš `transition-[opacity,scale]`.
- **Pružiny jen v `lib/motion.ts`** a **zadané fyzikou** (`spring(tlumení, odezva)`):
  `SPRING_DEFAULT` (bez překmitu, odezva 0,35 s) pro přesun a objevení, `SPRING_QUICK`
  (bez překmitu, 0,25 s) pro malý častý pohyb a odchod, `SPRING_MOMENTUM` (lehký překmit)
  jen po gestu, které neslo hybnost. Zápis `duration` + `bounce` nepoužívej: takové
  pružině `motion` 14 počáteční rychlost zahazuje a puštěný sheet „narazí do zdi“.
- **Sheet:** sleduje prst 1 : 1, o zavření rozhoduje rychlost promítnutá dopředu
  a měřená k okamžiku puštění (prst, který zastavil, nic neodhazuje), pružina rychlost
  prstu přebírá. Chytit jde kdykoli — i při zavírání; puštění ho pošle tam, kam ho prst
  hodil. Žádná cesta nesmí skončit sheetem, který stojí a nereaguje: hlídá to čistý
  automat `ui/sheet-machine.ts` a jeho test.
- **Animuj jen `transform` a `opacity`.**
- **Omezený pohyb** (`prefers-reduced-motion`): posuny a změny měřítka mizí, prolnutí
  zůstává. `prefers-reduced-transparency` a `prefers-contrast` mění materiály v plné plochy.

## 7. Telefon a přístupnost

- Dotykový cíl 44 px (`pointer-coarse:` u tlačítek a polí, `hit-area` u malých ikon);
  s myší nejmíň 24 px.
- Pevné lišty počítají s `env(safe-area-inset-*)`; výška okna je `dvh`/`svh`, ne `vh`.
- Pole mají na dotyku písmo 16 px (jinak iOS přiblíží stránku); zoom se nezakazuje.
  Pravidlo je v globals.css **mimo vrstvy** — ve vrstvě `base` ho přebila každá utilita
  velikosti písma (`text-sm`) a pole měla 14 px.
- Detail, který by na telefonu odsunul zbytek stránky, patří do `Sheet`.
- Fokus je vždy vidět (akcentní obrys). Stav nikdy nenese jen barva. Kontrast AA; hranice
  ovládacích prvků ≥ 3:1. Každá stránka projde axe (WCAG 2 A/AA) ve světlém i tmavém
  režimu — včetně otevřené vysvětlivky a sheetu.
- Tmavý režim je plnohodnotný: obsah na černé, druhotné plochy o stupeň světlejší.

## 8. Hlas

Česky, věcně, druhá osoba jednotného čísla. Tlačítko říká, co se stane („Nahrát výpisy“,
„Připravit podklady“), potvrzení opakuje sloveso („Smazat účet“), ne „OK“. Chyba bez
omluv a s cestou dál. Prázdný stav je pozvánka. Danero je celé zdarma — žádné ceny,
tarify ani „vyzkoušej zdarma na 14 dní“.

## 9. Sdílené soubory

Souběžná fáze redesignu (šest větví podle jedné reference) skončila 10. 10. 2026 — soubory
už nejsou uzamčené. Zůstává dělba, kdo co nese, a jedno pravidlo: **co potřebují dvě
stránky, patří do sdíleného souboru, ne do druhé kopie ve stránce.**

- **Tokeny a utility:** `apps/web/app/globals.css`. Nová barva = nový token tady (hex,
  světlý i tmavý) a řádek v tabulce výš; `test/design-tokens.test.ts` hlídá, že třída má
  token, a počítá kontrasty.
- **Primitiva:** `apps/web/components/ui/*` — obecné stavební kameny bez znalosti domény.
  Když primitivu něco chybí (velikost, varianta, stav), **doplň to v něm**; třída, která
  primitivum ve stránce přebíjí (`h-9` na přepínači, `[--highlight:transparent]`, jiná
  plocha dialogu), je dluh a při integraci se všechny takové mazaly.
  Galerie `/dev/primitiva` má ukázat každý nový stav.
- **Skořápka aplikace:** `app/(app)/layout.tsx`, `app/demo/layout.tsx`,
  `components/nav-rail.tsx`, `components/nav-items.ts`, `components/nav-icons.tsx`,
  `components/app-toolbar.tsx`, `components/view-switch.tsx`, `components/year-switcher.tsx`,
  `components/toast.tsx`, `components/theme-toggle.tsx`, `components/theme-provider.tsx`,
  `components/theme-color.ts`, `components/app-skeleton.tsx`,
  `components/shell-disclaimer.ts`, `components/sign-out-button.tsx`,
  `components/refresh-on-restore.tsx`, `components/clear-feedback-url.tsx`,
  `components/auto-save-feedback.tsx`, `components/no-script-notice.tsx`.
- **Skořápka a bloky veřejných stránek:** `components/marketing-page.tsx`,
  `components/marketing-nav.tsx`, `components/marketing-blocks.tsx`,
  `components/guide-article.tsx`, `components/long-read.tsx`, `components/faq-list.tsx`,
  `components/form-page.tsx`, `components/logo.tsx`.
- **Doménové komponenty sdílené mezi stránkami:** `components/warnings-list.tsx`,
  `components/horizon-strip.tsx`, `components/charts.tsx`, `components/limit-gauge.tsx`,
  `components/limits-inspector.tsx`, `components/filing-verdict.tsx`,
  `components/tax-figure.tsx`, `components/epo-export-form.tsx`,
  `components/tax-year-config-notice.tsx`, `components/positions-table.tsx`,
  `components/positions-explorer.tsx`, `components/position-card.tsx`. Verdikt o povinnosti
  podat přiznání kreslí na přehledu i v reportu týž `FilingVerdict` — neopisuj ho.
- **Stránky a jejich místní části:** `components/views/*` (přehled, portfolio, detail,
  simulátor, report — sdílí je aplikace a demo) a soubory vedle `page.tsx`
  (`app/(app)/import/*`, `app/(app)/nastaveni/*`). Místní komponenta je v pořádku, dokud
  ji používá jedna stránka; s druhým použitím se stěhuje výš.
- **Texty a typografie:** `lib/typography.ts`, `lib/format.ts`; jména limitů
  `lib/limit-names.ts`; pružiny `lib/motion.ts`; názvy platforem `platformName()`
  v `lib/brokers-catalog.ts`.

Tahle reference se mění zároveň s primitivem — nový prop bez řádku tady neexistuje.
