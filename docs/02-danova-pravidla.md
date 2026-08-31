# Daňová pravidla — specifikace enginu

Stav: červenec 2026, pravidla pro zdaňovací období 2025 a 2026. Zákon č. 586/1992 Sb. (ZDP), pokyn GFŘ D-59, pokyny D-66/D-75 (jednotné kurzy). **Každé pravidlo má ID (R-xx) — testy enginu na ně odkazují.** Sporné výklady jsou označeny ⚠️ a řeší se konfiguračním přepínačem (tabulka na konci).

Klíč k písmenům § 4 odst. 1 ZDP (po přečíslování od 1. 1. 2024; starší texty vč. D-59 používají w/x):

| Písmeno | Obsah |
|---|---|
| q) | podíl v obchodní korporaci — test 5 let |
| t) | CP — hodnotový limit 100 000 Kč/rok (dříve w) |
| u) | CP — časový test 3 roky (dříve x) |
| zj) | kryptoaktiva — limit 100 000 Kč/rok (od 15. 2. 2025) |
| zk) | kryptoaktiva — test 3 roky (od 15. 2. 2025) |
| § 4 odst. 3 | strop 40 mil. Kč (2025: q+u+zk; od 2026 jen zk) |

---

## R-01 Časový test 3 roky (§ 4/1 u)

Příjem z úplatného převodu CP je osvobozen, **přesáhne-li** doba mezi nabytím a převodem 3 roky (tj. 3 roky + aspoň 1 den). Platí i pro zahraniční CP.

**Osvobození podle § 4 je obligatorní — nejde se ho vzdát.** Splní-li příjem
podmínky, do základu daně nepatří; poplatník nemá volbu ho „neuplatnit“ (a tím si
třeba ponechat ztrátu). Doloženo judikaturou: [NSS 7 Afs 229/2022-32 ze dne
11. 3. 2024](https://vyhledavac.nssoud.cz/DokumentOriginal/Html/719421) — správce
daně z dílčího základu vyloučil částku, kterou poplatník do přiznání zahrnul,
protože šlo o příjem osvobozený podle § 4 odst. 1 písm. b). Rozsudek sám je
o prodeji nemovitosti, ale závěr o obligatornosti osvobození podle § 4 platí
stejně pro písmena t) i u). Praktický dopad na engine: osvobozená tržba se do
přiznání neuvádí a ztráta z ní se neuplatní (R-02a, R-05d), a hodnotové osvobození
podle t) nelze „vypnout“, aby vyšla nižší daň.

- **R-01a Okamžik nabytí**: u zaknihovaných CP den zápisu na majetkový účet = **settlement date** (D-59 k § 4/1, bod 1 písm. e). US akcie T+1 (od 5/2024), EU typicky T+2. ⚠️ Část praxe počítá trade date → přepínač `timeTestDateBasis` (default `settlement`), evidujeme obě data.

  **Burzovní svátky.** Když broker datum vypořádání neuvádí, engine ho dopočte —
  a lhůta T+1/T+2 běží v **obchodních dnech dané burzy**, tedy se přeskakuje
  víkend **i burzovní svátek**. Bez svátků vycházelo vypořádání až o 4–5 dní
  dřív (velikonoční týden, Vánoce) a časový test se otevíral dřív, než smí —
  chyba v neprospěch státu, tedy riziko doměrku. Kalendář se volí podle prefixu
  ISIN: `US` → NYSE/Nasdaq, `CA` → TSX, `DE` → Xetra, `GB` → LSE,
  `IE` → Euronext Dublin, `CZ` → BCPP, ostatní → TARGET2 (společný vypořádací
  kalendář eurozóny: 1. 1., Velký pátek, Velikonoční pondělí, 1. 5., 25. a 26. 12.). Tabulky se
  zdroji jsou v `packages/engine/src/config/exchangeHolidays.ts`, pokryté roky
  **2019–2027**; mimo ně se přeskakují jen víkendy (starší nákupy mají časový
  test dávno splněný, takže dopad je nulový).

  Poctivě k aproximacím: vypořádací systémy (T2S) bývají otevřené i v den,
  kdy burza neobchoduje. To posouvá dopočtené vypořádání spíš **později** = pozdější
  nabytí = pozdější osvobození, což je bezpečný směr. Datum vypořádání
  z výpisu brokera má vždy přednost před dopočtem.

  Runbook: **každý leden doplnit svátky nového roku** (nové kalendáře burz
  vycházejí obvykle v listopadu/prosinci) a posunout `HOLIDAY_CALENDAR_LAST_YEAR`.
- **R-01b Konec lhůty**: den úplatného převodu — konzistentně stejná báze jako nabytí.
- **R-01c Obchodní majetek**: osvobození neplatí pro CP v obchodním majetku a do 3 let od ukončení samostatné činnosti. OSVČ v paušálu obchodní majetek nemá → CP vždy soukromé. Flag na profilu poplatníka.
- **R-01d Smlouva o budoucím převodu** uzavřená do 3 let od nabytí ruší osvobození, i když se převod uskuteční po testu. (Jen dokumentace/upozornění, nedetekovatelné z dat.)
- **R-01e Kmenový list: test je 5 let, ne 3.** Poslední věty § 4 odst. 1 písm. u):
  „jedná-li se o kmenový list, činí doba místo 3 let 5 let“. Kmenový list je cenný
  papír představující podíl ve společnosti s ručením omezeným — u brokerů se
  neobchoduje, takže z importovaných dat nikdy nepřijde; do modelu se může dostat
  jen ručním zadáním. **Engine ho neodlišuje** (v datech není příznak druhu CP),
  a tříletý test by u něj osvobodil dřív, než smí. Dokumentační upozornění; pokud
  by se kmenový list měl evidovat, musí přijít i příznak instrumentu a delší test.
  Totéž pětileté prodloužení má i písmeno t), tam ale pro **výluku obchodního
  majetku** („jedná-li se o kmenový list, činí doba 5 let“ místo 3 let od ukončení
  činnosti — R-02f), ne pro hodnotový limit 100k.
- **R-01f Výluka kvalifikované zaměstnanecké opce (§ 6a).** Poslední věta § 4
  odst. 1 písm. u) ve znění zák. č. 360/2025 Sb. (novelizační body 3 a 4, účinnost
  1. 1. 2026): „osvobození se neuplatní pro cenné papíry nabyté uplatněním
  kvalifikované zaměstnanecké opce podle § 6a“. Časový test se na takové akcie
  nevztahuje bez ohledu na dobu držby (příjem z uplatnění opce je navíc vlastním
  druhem ostatního příjmu — § 10 odst. 1 písm. q). **Relevance nízká
  a nedetekovatelná**: jde o opce od českého zaměstnavatele a výpis brokera způsob
  nabytí neuvádí. Dokumentační upozornění (nález K7a-04).

## R-02 Hodnotový limit 100 000 Kč (§ 4/1 t)

Osvobozen je úhrn **hrubých příjmů (tržeb)** z úplatného převodu CP za zdaňovací období do 100 000 Kč. Nezkoumá se časový test ani zisk.

- **R-02a Cliff, ne odpočet**: překročení = osvobození dle t) padá celé.
- **R-02b** Sčítá se přes všechny brokery a účty poplatníka.
- **R-02c** ⚠️ Sporné, co vstupuje do úhrnu: převažující (striktní) výklad — **veškeré** příjmy z prodeje CP včetně osvobozených časovým testem (D-59 bod 20: osvobození t) a u) „nelze kombinovat"). Menšinový výklad: jen příjmy testem neosvobozené. Přepínač `limit100kIncludesTimeTestExempt` (default `true` = striktní).
- **R-02d** Limit 100k pro CP a limit 100k pro krypto (zj) jsou **oddělené**.
- **R-02e** Beze změny pro 2025 i 2026.
- **R-02f Obchodní majetek**: text § 4 odst. 1 písm. t) obsahuje stejné vyloučení
  jako u) — osvobození se nepoužije na příjem z prodeje CP, který je nebo byl
  zahrnut do obchodního majetku (a to do 3 let od ukončení samostatné činnosti).
  Flag profilu (`hasSecuritiesInBusinessAssets`, R-01c) tedy vypíná **obě**
  osvobození CP: časový test i hodnotový limit 100k — prodeje jsou zdanitelné
  vždy a jejich tržby **nevstupují do úhrnu 100k** (pool nečerpají; do stropu
  40M dle R-03 nemají co přinést, nic osvobozeného nevzniká). Flag se týká
  **jen CP** — kryptoaktiva mají vlastní vyloučení obchodního majetku přímo
  v textu zj)/zk) (R-10a) a flagem CP se jim osvobození nevypíná.

  **Lhůta výluky je 3 roky od ukončení činnosti, u kmenového listu 5** („jedná-li
  se o kmenový list, činí doba 5 let“ — týž závěr jako R-01e, jen pro výluku
  obchodního majetku). Engine drží flag jako prostý příznak profilu bez data
  ukončení činnosti, takže délku lhůty nepočítá — vypnutí osvobození je tak vždy
  konzervativní (nikdy nepodhodnotí daň).

  **Shorty (R-13a) flag vypíná taky, a je to správně.** Prodej nakrátko je podle
  R-13a týž druh příjmu z úplatného převodu CP, takže mu s vypnutým hodnotovým
  osvobozením padá i krytí stovkou (R-13e): `valueExemptionAvailable = false`
  zhasne `exemptUnder100k`, a shortu se pak uplatní jak zdanitelný příjem, tak
  jeho výdaje, a jeho příjem čerpá limity podle R-13k. Konzervativní směr: opačné
  řešení (nechat shortu osvobození, protože zapůjčené kusy poplatník v obchodním
  majetku nemá) by daň **snížilo** — a kdyby bylo špatně, znamenalo by doměrek.

## R-03 Strop 40 mil. Kč (§ 4 odst. 3)

- Platí pro úhrn příjmů osvobozených dle q), u), zk) přijatých **v roce 2025** (zaveden zák. č. 349/2023 Sb.). **Od 1. 1. 2026 zrušen pro CP a podíly** (zák. č. 360/2025 Sb.); **pro krypto (zk) trvá**.
- **R-03a Hodnotový limit t)/zj) pod strop NESPADÁ.** Výčet v § 4 odst. 3 je
  taxativní — q), u), zk). Osvobození úhrnem do 100 000 Kč (t pro CP, zj pro
  krypto) v něm není, takže příjem, který je osvobozený hodnotově,
  do stropu **nevstupuje ani se jím nekrátí** — a to i tehdy, když strop
  přetáhne druhý druh sdílející týž strop (2025: CP + krypto, R-10d).

  ⚠️ Vyloučení je **per PRODEJ s nárokem na t)/zj)**, ne per DRUH příjmu.
  Rozdíl je vidět u EMT: § 4/1 zj) je z hodnotového osvobození vylučuje
  výslovně (R-10a), takže se jejich tržby do úhrnu 100 000 Kč vůbec nepočítají.
  Prodej stablecoinu osvobozený časovým testem zk) proto stojí **čistě na zk)**
  a strop na něj dopadá, i když úhrn ostatních krypto tržeb zůstane pod
  100 000 Kč. Zkratka „celý druh je pod limitem → celý druh je mimo strop“ na
  tomhle případu selhala: se zapnutým přepínačem `emtTimeTestExempt` (R-10g)
  unikly stropu i tržby, které jinou oporu než zk) nemají — doložený rozdíl
  daně **1 238 975,04 Kč** (nález A2-3-01). Totéž platí obráceně: prodej bez
  nároku na osvobození podle R-10b do stropu nevstupuje, protože osvobozený
  vůbec není.

  Podmínka je vázaná na výklad R-02c: „úhrn do 100k" pokryje časově osvobozené
  tržby jen tehdy, když do toho úhrnu **vstupují** (striktní výklad, default).
  Při mírnějším výkladu je pool klidně nulový, a přesto jsou tytéž tržby
  osvobozené podle u)/zk) — tam strop dopadá plnou vahou.

  ⚠️ Bez tohohle pravidla vzniká absurdita, která chybu prozradí: táž krypto
  tržba 90 000 Kč vycházela při držbě **5 let dráž** (daň 1 028 289,84 Kč) než
  při držbě 1 rok (1 015 915,84 Kč), protože delší držba ji přesunula pod strop
  sdílený s cennými papíry. Delší držba nikdy nesmí vyjít dráž —
  `cap40m.test.ts` to hlídá vlastnostním testem.
- Krácení poměrné: osvobozená část = příjem × (40M / úhrn); výdaje se krátí stejným poměrem. Rozhodný je moment přijetí peněz.
- Step-up: u CP nabytých do 31. 12. 2024 lze jako výdaj uplatnit tržní hodnotu k 31. 12. 2024 — **§ 10 odst. 9 ve znění účinném do 31. 12. 2025**, zavedený zák. č. 349/2023 Sb. čl. XV bodem 32 a zrušený od 1. 1. 2026 (pro ZO 2025 platí dál; podrobně a s prameny u R-10d). (Engine: volitelný `costBasisOverride` na lotu.)
- **Implementováno (G5, zobecněno v G6)**: exemptRatio = strop / kombinovaný úhrn
  časově osvobozených příjmů **všech druhů pod stropem** (2025: CP + krypto, R-10d;
  od 2026 jen krypto, R-10e) počítá `engine.ts` a předává oběma výpočtům; dodaněná
  část příjmů i výdajů poměrem 1 − exemptRatio; varování CAP_40M_REDUCED s konkrétními
  čísly. Golden testy test/cap40m.test.ts + test/crypto.test.ts.
  Step-up (tržní hodnota k 31. 12. 2024 jako výdaj
  u dřívějších nabytí) zatím neimplementován — u dotčených uživatelů může
  výrazně snížit dodanění, doporučit konzultaci s poradcem.

## R-04 Korporátní akce a časový test

- **R-04a Split / reverse split** (výměna při zachování celkové jmenovité hodnoty): test **nepřerušuje**; lot se transformuje (množství × poměr, cena / poměr), datum nabytí zůstává.
- **R-04b Fúze/rozdělení** dle § 23b/§ 23c: nepřerušuje. ⚠️ U zahraničních emitentů a ETF výkladové — přepínač na úrovni akce `preservesAcquisitionDate` (default true pro merger se zachováním hodnoty, s upozorněním).
- **R-04c Výměna akcií se změnou celkové jmenovité hodnoty**: test **přerušuje** —
  a contrario z litery § 4 odst. 1 písm. u): „při výměně akcie emitentem za jinou
  akcii **o celkové stejné jmenovité hodnotě** se doba 3 let mezi nabytím
  a úplatným převodem cenného papíru u téhož poplatníka nepřerušuje“. Výslovná
  výjimka pro shodnou jmenovitou hodnotu by neměla smysl, kdyby se test
  nepřerušoval i při hodnotě změněné. **Jistota střední** (výklad litery,
  judikatura k tomu není).

  ⚠️ Do 23. 8. 2026 tu jako opora stála citace NSS 7 Afs 229/2022 — a byla
  **falešná**: ten rozsudek řeší obligatornost osvobození při prodeji nemovitosti
  (chalupy) podle § 4 odst. 1 písm. b), slova „jmenovitá hodnota“ ani „výměna“
  v jeho textu nejsou (nález K7a-16). Použitelná právní věta z něj patří k R-01
  a R-02, ne sem. Falešná citace v závazné specifikaci je horší než žádná: působí
  důvěryhodně a při kontrole se rozpadne.
- **R-04d Sloučení/splynutí podílových fondů, přeměna uzavřeného fondu na otevřený**: nepřerušuje (výslovně § 4/1 u).
- **R-04e Změna ISIN/tickeru bez výměny nástroje**: nepřerušuje (⚠️ výkladová shoda). Lot pokračuje pod novým ISIN.
- **R-04f Spin-off**: původní loty běží dál; nové akcie = nový lot s datem nabytí = den spin-offu. ⚠️ Alokace nabývací ceny neřešena zákonem — default: cost basis nové pozice 0 Kč (konzervativní), volitelně poměrná alokace.
- **R-04g Dědictví**: od příbuzného v řadě přímé/manžela se doba držby zůstavitele **započítává** (nabytí = smrt zůstavitele); jinak nová lhůta.
- **R-04h Dar**: doba držby dárce se nezapočítává, obdarovanému běží nová lhůta.
  ⚠️ Implementační omezení: model zatím neodlišuje způsob nabytí — dar i dědictví
  se zadávají přes `TRANSFER_IN.acquisition`. U daru je správné zadat **datum
  převodu** (nová lhůta dle R-04h) a cenu určenou ke dni nabytí; zadání
  původního data dárce by jeho lhůtu chybně započetlo. U dědictví v řadě přímé
  se naopak datum úmrtí zůstavitele zadává právem (R-04g). Odlišení druhu
  nabytí v modelu = kandidát na rozšíření.
- **R-04i Převod mezi brokery**: není převod vlastnictví → nepřerušuje (⚠️ mírně výkladové). Typ transakce `TRANSFER_IN/OUT` s párováním.
  Implementační poznámka: `TRANSFER_OUT` spotřebovává loty **vždy FIFO** bez
  ohledu na zvolený `matchingMethod` — odchozí převod není zdanitelný převod
  (žádný příjem se nepočítá), jde jen o evidenci kusů; zákon metodu výběru
  nepředepisuje (R-05c) a deterministické FIFO je průkazné a konzistentní.
- **R-04j Frakční akcie**: ⚠️ nejasný status (u některých brokerů derivátový nárok, ne CP). Default: zacházet jako s CP + informační vlajka v reportu.

## R-05 Dílčí základ daně § 10 (neosvobozené prodeje)

- **R-05a Cash princip**: příjem patří do roku **připsání peněz** (na brokerský účet), ne roku obchodu.
- **R-05b Výdaje** (§ 10 odst. 4, 5): nabývací cena + související výdaje (poplatky, provize). Výdaje k osvobozeným příjmům uplatnit nelze.
- **R-05c Párování — metoda NENÍ předepsána** pro neúčtující FO: FIFO, LIFO i individuální identifikace jsou přípustné (stanovisko GFŘ, potvrzuje i praxe Taxomatu). Podmínka: průkaznost a konzistence. Engine: strategie `FIFO` (default) | `LIFO` | `MAX_PROFIT` | `MAX_LOSS`; zvolená metoda se per rok zafixuje a dokumentuje. Individuální identifikaci (`MANUAL`) zákon připouští, ale **engine ji neumí** a tenhle dokument ji dřív omylem sliboval (nález A1-3-10) — typ `MatchingMethod` má čtyři hodnoty a ruční párování lotů nemá ani UI. Až přibude, patří sem zpátky. `MAX_PROFIT`/`MAX_LOSS` porovnávají nabývací ceny lotů **v CZK kurzem roku nákupu** (konvence výdajů R-06a) — loty téhož ISIN mohou být v různých měnách (duální listing, GBX/GBP) a nominály napříč měnami porovnat nelze.

  **Fixace konfigurace per rok (implementace).** Podmínku konzistence nese
  tabulka `tax_year_settings` (uživatel + daňový rok + čas fixace + zafixované
  volby). Fixují se **všechny volby, které mění už spočítaná čísla zpětně**:
  metoda párování (R-05c), kurzová soustava (R-06 — „jednu soustavu pro celé
  zdaňovací období") a výklad limitu 100k (R-02c). Ostatní sporné přepínače
  (báze časového testu R-01a, alokace spin-offu R-04f, deriváty R-12i, EMT
  R-10g) zafixované zatím **nejsou** — mají užší záběr (báze časového testu
  překlopí jen prodej padnoucí přesně na hranici tří let), ale je to známá
  mezera, ne záměr; rozšíření = další sloupce v téže tabulce.
  Konfigurace se zafixuje ve chvíli, kdy si uživatel za daný
  rok skutečně vygeneruje podklady k přiznání — otevře report za ten rok nebo
  stáhne XML pro EPO. Fixuje se **jen už skončený rok**: za běžící rok přiznání
  podat nelze, takže jeho konfigurace zůstává volná a sleduje profil. Fixace je
  idempotentní — jednou zapsané hodnoty se nikdy nepřepisují, ani při dalším
  generování podkladů. Od té chvíle se ten rok počítá zafixovanou konfigurací
  ve **všech** pohledech (přehled, portfolio, simulátor, report, XML i
  notifikační cron); změna v profilu se projeví jen v letech bez fixace.
  Zrušit fixaci jde výslovně v Nastavení (jeden rok, s potvrzením) — pro případ
  dodatečného přiznání; rok se pak zase počítá podle profilu. Zafixované
  hodnoty jsou i v exportu dat (`/api/export`), aby šlo doložit, čím se
  počítala už odeslaná čísla.
- **R-05d Kompenzace**: všechny prodeje CP v roce = **jeden druh příjmu** (D-59 k § 10/4) → ztráty a zisky mezi tituly se vzájemně započtou. **Celková ztráta druhu se nevykazuje** (dílčí základ min. 0), nepřenáší se do dalších let, nekompenzuje s jinými druhy (krypto = jiný druh ⚠️) ani s § 7/8/9.
- **R-05e Sazba**: 15 % / 23 % nad 36násobek průměrné mzdy (2025: 1 676 052 Kč; 2026: 1 762 812 Kč = 36 × 48 967 Kč dle NV č. 365/2025 Sb.). Z § 10 se neplatí sociální ani zdravotní pojištění.
  Pozn. k orientační dani: odhad daně v aplikaci se **nezaokrouhluje** na celé Kč
  dle § 146 odst. 1 daňového řádu (základ na stovky dolů dle § 16 ZDP aplikován je) —
  jde o orientační hodnotu a UI ji tak označuje; zaokrouhlení dle DŘ přijde až
  s generováním podkladů pro přiznání (DAP).

## R-06 Měnové přepočty (§ 38 odst. 1)

Neúčtující FO volí pro celé zdaňovací období **jednu** soustavu (nelze kombinovat):
- **R-06a Jednotný kurz** GFŘ — publikován pokynem D v lednu za předchozí rok.
  Ověřená tabulka 2020–2025 je v `packages/engine/src/config/unifiedRates.ts`
  (11 měn, JPY normalizováno z kotace za 100) s citacemi: 2020 = GFŘ-D-49,
  2021 = GFŘ-D-54, 2022 = GFŘ-D-60, 2023 = GFŘ-D-63, 2024 = GFŘ-D-66 (ruší
  chybný D-65), 2025 = GFŘ-D-75 (EUR 24,66 / USD 21,84). Kompletní kurzovní
  lístky: docs/podklady/jednotne-kurzy-gfr.md + PDF pokynů na
  financnisprava.gov.cz. Kurz běžného roku je jen ORIENTAČNÍ
  (apps/web/lib/tax-config.ts, `isRateVerified`) a UI ho tak musí označovat;
  runbook: každý leden doplnit nový pokyn a posunout LAST_VERIFIED_RATE_YEAR.
- **R-06b Denní kurzy ČNB** (dle zákona o účetnictví; příp. pevný kurz).
- Engine počítá **obě varianty** a reportuje rozdíl (recenze Taxomatu: rozdíl až desítky tisíc Kč).
- **R-06c Volba soustavy se per rok fixuje** — stejným mechanismem jako metoda
  párování (viz R-05c, „Fixace konfigurace per rok"). Požadavek jedné soustavy
  pro celé zdaňovací období by jinak pozdější přepnutí v profilu zpětně porušilo
  a přepočítalo už podaný rok: na reálném portfoliu je to rozdíl desítek tisíc Kč.

## R-07 Dividendy a úroky (§ 8)

- **R-07a České dividendy**: srážková daň 15 % u zdroje, konečná — do přiznání se neuvádějí, do žádných limitů nevstupují.
- **R-07b Zahraniční dividendy**: dílčí základ § 8 **brutto** (před zahraniční srážkou), bez výdajů, přepočet dle R-06.
- **R-07c Zápočet dle § 38f**: metoda prostého zápočtu po jednotlivých státech (Příloha 3 DAP); max. sazba dle smlouvy a max. do výše české daně z tohoto příjmu. Bez W-8BEN (sraženo 30 %) lze započíst jen 15 %. Nezapočtená daň u nepodnikatele fakticky propadá ⚠️ (někdy ji lze žádat zpět přímo v zemi zdroje).

  Ověřené smluvní stropy srážkové daně z dividend (portfolio FO, čl. 10 SZDZ):

  | Stát | Strop | Zdroj (SZDZ) |
  |------|-------|--------------|
  | US | 15 % | 32/1994 Sb. |
  | DE | 15 % | 18/1984 Sb. |
  | NL | **10 %** | 138/1974 Sb. |
  | JP | 15 % | 46/1979 Sb. |
  | IE | 15 % | 163/1996 Sb. |
  | ostatní | default 15 % | neověřeno — engine přidá varování `TREATY_RATE_UNVERIFIED` (jednou per země); skutečná smluvní sazba může být nižší → riziko nadhodnoceného zápočtu |

  Zaokrouhlení: zápočet po státech zaokrouhlujeme na celé Kč **dolů** (nárokovanou částku konzervativně nenadhodnocujeme); souhrn = součet zaokrouhlených (tabulka po státech tak vždy sedí na součet).

  **Koeficient zápočtu se počítá na DVĚ desetinná místa.** § 146 odst. 3 DŘ:
  „Výpočet na základě daňové sazby, koeficientů, ukazatelů a výsledek přepočtu měny
  se provádí s přesností na dvě platná desetinná místa.“ Tiskopis Přílohy 3
  (25 5405/P3, vzor č. 22) to na ř. 324 (koeficient = podíl příjmů ze státu na
  základu daně) vynucuje a podatelna přesnější hodnotu odmítne. Engine dnes strop
  zápočtu počítá **přesným** podílem, takže se od tiskopisu liší až o jednotky Kč
  (nález K3-09); zaokrouhlit se má **koeficient**, ne až výsledek.

  ⚠️ **Není to zakázané postupné zaokrouhlování — nikdo to nesmí „opravit“ zpět.**
  Druhá věta § 146 odst. 3 („Postupné zaokrouhlování ve dvou nebo více stupních je
  nepřípustné“) zakazuje zaokrouhlit MEZIVÝSLEDEK a z už zaokrouhleného čísla
  zaokrouhlovat podruhé. Tady jde o dvě různé veličiny: koeficient (ř. 324) se
  zaokrouhlí na dvě desetinná místa podle věty první, hodnota zápočtu za stát
  (ř. 326) se zaokrouhlí **jednou** na celé Kč a souhrn (ř. 328) je prostý SOUČET
  těch zaokrouhlených částek — přesně jak tiskopis předepisuje („úhrn řádků 326
  i ze samostatných listů“) a jak přikazuje § 38f odst. 8 („vyloučení dvojího
  zdanění metodou prostého zápočtu se provede samostatně za každý stát“). Nález
  K7a-11, který v tom viděl porušení § 146 odst. 3, byl proti tiskopisu
  **vyvrácen**.
- **R-07f Zápočet ze zahraničních ÚROKŮ**: úrok je stejný dílčí základ § 8 jako dividenda a § 38f zápočet po státech nerozlišuje — sražená daň z úroku se tedy započítává **stejným postupem jako u dividend** (strop smlouvou, zaokrouhlení po státech dolů, souhrn = součet zaokrouhlených). ⚠️ **Strop je ale jiný**: dividendy řeší čl. 10 SZDZ, úroky **čl. 11**, a ten ve smlouvách ČR skoro vždy dává právo zdanit úrok **jen státu rezidenta** — tj. strop **0 %**.

  Ověřené smluvní stropy srážkové daně z úroků (čl. 11 SZDZ; smlouvy jsou v tomhle recipročně formulované — strop platí bez ohledu na směr platby):

  | Stát | Strop | Zdroj (SZDZ) |
  |------|-------|--------------|
  | US | **0 %** | 32/1994 Sb. (úrok zdaňuje jen stát rezidenta) |
  | DE | **0 %** | 18/1984 Sb. |
  | NL | **0 %** | 138/1974 Sb. |
  | IE | **0 %** | 163/1996 Sb. |
  | GB | **0 %** | 89/1992 Sb. |
  | JP | 10 % | 46/1979 Sb. |
  | ostatní | default **0 %** | neověřeno — bezpečný default nikdy nenadhodnotí zápočet; engine přidá varování `INTEREST_WITHHOLDING_ABOVE_TREATY` s částkou a s tím, že se srážka žádá zpět ve státě zdroje |

  Sazby ověřeny proti přehledu smluvních sazeb [PwC Worldwide Tax Summaries — Czech Republic, Withholding taxes](https://taxsummaries.pwc.com/czech-republic/corporate/withholding-taxes) (US/DE/NL/IE/GB 0 %, JP 0/10 % — u portfoliového investora platí obecných 10 %); jde o odborný přehled, ne o text smlouvy — před rozšířením tabulky ověř konkrétní čl. 11.

  Důsledek: daň sraženou z úroku nad smluvní strop **nelze v ČR započíst** — žádá se zpět ve státě zdroje. Engine ji přesto eviduje (`withholdingTax` na transakci úroku, souhrn `foreignWithholdingCzk`), aby ji uživatel viděl a věděl, o co žádat; bez toho pole se informace ztrácela už v importu.

  Do rozpisu po státech (podklad Přílohy 3, ř. 321) vstupuje úrok **jen se sraženou daní a jen ze státu, kde smlouva zdanění u zdroje vůbec dovoluje** (strop > 0 %). Úrok nezdaněný i úrok zdaněný proti smlouvě zůstává v dílčím základu § 8 (ř. 38), ale koeficient zápočtu podle § 38f odst. 2 (příjmy státu / základ daně) nezvedá — jinak by strop zápočtu vyrostl i dividendám téhož státu, na což nárok není. Obojí je konzervativní směr.
- **R-07d § 16a**: volitelně samostatný základ daně 15 % pro zahraniční dividendy/úroky (ochrana před 23% progresí; Příloha 4). Engine spočítá obě varianty a doporučí výhodnější — ale **jen když obecný základ skutečně překračuje známou hranici progrese** a **úspora dosáhne meze významnosti 100 Kč**. Bez známé hranice (`progressiveThreshold = null`) i pod hranicí se § 16a **nedoporučuje**: obě varianty pak počítají 15 % a rozdíl je jen zaokrouhlovací šum, zatímco § 16a znamená ztrátu slev na dani a nezdanitelných částí základu.

  **Mez významnosti (proč 100 Kč).** Šum má tvrdý strop: obecná varianta zaokrouhluje na sta dolů jediný základ (§ 16 odst. 2), varianta § 16a **dva** základy odděleně, takže § 16a může vyjít nanejvýš o 100 Kč základu levněji — při horní sazbě 23 % je to **max. 23 Kč** čistě zaokrouhlovacího rozdílu. Doložený případ (nález A1-04): základ 1 676 100 Kč, tedy 48 Kč nad hranicí 2025 → obecná daň 251 418,84 Kč, § 16a 251 400 Kč, rozdíl **18,84 Kč**, z toho 15 Kč zaokrouhlení a jen 3,84 Kč skutečné progrese. Mez 100 Kč šum bezpečně přesahuje (odpovídá ~1 250 Kč příjmu § 8 skutečně v pásmu 23 %) a zároveň zůstává tak nízko, aby nezakryla reálnou úsporu. Obě varianty jsou v UI vidět vždy — mez řídí jen doporučení, nic neschovává.

  Práh **nemá smysl posouvat až za slevy na dani**: slevy ani nezdanitelné části engine nezná (závisí na § 7 a na osobní situaci mimo evidovaná data), takže by se porovnávalo s vymyšleným číslem. Doporučení ale musí ztrátu slevy **pojmenovat** — viz R-07i.
- **R-07i Doporučení § 16a musí počítat se ztrátou slevy na poplatníka.** Přesun
  dividend a úroků do samostatného základu sníží daň podle § 16 — a slevu podle
  § 35ba lze uplatnit **jen proti ní** (R-14b). Kdo kromě investic jiné příjmy
  nemá, může tím o nevyčerpaný zbytek slevy přijít, a § 16a ho pak vyjde dráž,
  než kolik ukazuje prosté porovnání dvou daní.

  Doložený případ: základ § 10 nulový, zahraniční dividendy 1,8 mil. Kč.
  Obecná varianta: daň § 16 ≈ 297 000 Kč − sleva 30 840 Kč. Varianta § 16a:
  daň § 16 = 0 (sleva propadá celá) + daň § 16a 270 000 Kč. Rozdíl proti
  porovnání bez slevy je celých 30 840 Kč.

  **Danero doporučení nemění, ale varuje s čísly** (`SEPARATE_16A_CREDIT_LOSS`,
  úroveň WARNING) vždy, když je § 16a doporučeno a daň podle § 16 ve variantě
  § 16a je nižší než sleva na poplatníka. Proč jen varování a ne změna
  doporučení: jestli se sleva spotřebuje na § 6 nebo § 7, Danero **nevidí**
  — rozhodnout to umí jen poplatník. Předstírat, že o tom víme, by znamenalo
  poradit špatně zaměstnanci i OSVČ.

  ⚠️ Do 23. 8. 2026 tuhle ztrátu **maskoval vadný ř. 91** v generátoru XML
  (počítal nevyčerpaný zbytek slevy proti dani § 16a, viz R-14). Opravit se to
  proto muselo naráz — samotná oprava ř. 91 by ztrátu poprvé zviditelnila
  v odevzdaném přiznání, aniž by o ní kdokoli uživatele varoval.
- **R-07e** Prokazování: výpisy brokera FS v praxi akceptuje, není nárokové — dokumentační upozornění.
- **R-07g České úroky**: úrok ze zdroje v ČR bývá vypořádaný srážkou u zdroje
  (§ 36 odst. 2 — mimo jiné úrok z účtu, který není určen k podnikání), a pak se
  do přiznání neuvádí a nečerpá limity, stejně jako česká dividenda podle R-07a.
  ⚠️ **Neplatí to ale plošně**: srážce nepodléhá třeba úrok z poskytnutých
  zápůjček a úvěrů (P2P platformy typu Zonky nebo Bondster) — ten je běžným
  příjmem podle § 8 a do přiznání i do limitů R-08 vstupuje.

  Engine se proto řídí sraženou daní v datech, ne zemí zdroje:
  - `withholdingTax > 0` → mimo dílčí základ § 8 i mimo limity, INFO
    `CZ_INTEREST_WITHHELD`;
  - `withholdingTax = 0` → **do § 8 a do limitů** (bezpečný směr: nezdanit by
    znamenalo podhodnotit daň i limit 50k), WARNING
    `CZ_INTEREST_WITHOUT_WITHHOLDING` s výzvou ověřit, jestli srážku jen
    nepřečetl importér.

  Úrok se v obou případech objeví ve výpisu úroků (časové řady v UI) — dřív
  český úrok mizel úplně, takže 80 000 Kč nezdaněného úroku vyšlo jako
  „základ § 8 = 0, limit 50k nevyčerpán, paušál v pořádku“ (nález A1-3-03).
- **R-07h Vratka kapitálu (return of capital)**: některé fondy a REITy vyplácejí
  vedle dividendy i **vrácení části vloženého kapitálu** — brokeři to reportují
  jako zvláštní druh dividendy (Trading 212 `Dividend (Return of capital)`,
  IBKR `Return of Capital`). Věcně to není podíl na zisku podle § 8 odst. 1
  písm. a) ZDP: vyplácí se z vloženého kapitálu, ne ze zisku, a poplatníkovi se
  jím **vrací část pořizovací ceny**. Příjem tak vzniká až prodejem (nižší
  nabývací cena = vyšší základ podle § 10), případně hned v části, která
  pořizovací cenu pozice přesáhne.

  ZDP tenhle případ u **zahraničních** fondů výslovně neupravuje (§ 36 odst. 2
  míří na snížení základního kapitálu české obchodní korporace) a pokyn GFŘ
  k němu není. Je to tedy sporný výklad, a proto **konfigurační přepínač
  `returnOfCapitalReducesBasis` s bezpečným defaultem `false`**:

  ⚠️ **Mírnější výklad nemá ocitovanou kotvu — a je poctivé to napsat.** V českém
  právu není ustanovení, které by u zahraničního fondu řeklo „vrácení vloženého
  kapitálu snižuje nabývací cenu a daní se až přebytek“. Nejblíž je **§ 10 odst. 1
  písm. g)**, který mezi ostatní příjmy řadí „vrácení emisního ážia, příplatku mimo
  základní kapitál nebo těmto plněním obdobná plnění“ — tedy míří **opačným
  směrem**: takové plnění zdaňuje, byť s výdajem v podobě nabývací ceny podílu
  podle **§ 10 odst. 6**. Vymezení nabývací ceny v **§ 24 odst. 7** její snižování
  o přijaté výplaty nepředepisuje. **ČR nemá obdobu IRC § 301(c)(3)** — americké
  úpravy, kde nontaxable return of capital výslovně snižuje basis a přebytek je
  capital gain. Analogie použitá v R-07j proto podpírá jen **mechaniku „na kus“**
  (jak měřit, když už se výklad zvolí), ne samotný nárok na snížení nabývací ceny.
  `false` (zdanit jako dividendu) tedy není opatrnost navíc, ale jediná varianta
  s oporou v českém textu; `true` je vědomé riziko, ne opomenutí zákonodárce.

  - **`false` (default, bezpečný)** — vratka se daní jako dividenda podle
    R-07b: brutto do dílčího základu § 8, čerpá limity R-08. Nikdy nepodhodnotí
    daň; jen ji vybere dřív, než by musela být. Engine na to upozorní (INFO
    `RETURN_OF_CAPITAL_TAXED_AS_DIVIDEND`), ať uživatel ví, že druhý výklad
    existuje.
  - **`true` (mírnější)** — vratka **snižuje nabývací cenu otevřených lotů**
    téhož ISIN k datu výplaty, poměrně podle zbývajícího množství (tedy stejnou
    mechanikou jako alokace u spin-offu, R-04f), a do § 8 nevstupuje.

  Mantinely mírnějšího výkladu (všechny konzervativním směrem):

  1. **Přebytek nad nabývací cenu** se zdaní jako dividenda podle R-07b
     (WARNING `RETURN_OF_CAPITAL_EXCESS`). Věcně by šlo o příjem podle § 10,
     ale ten by vyžadoval fiktivní prodej bez protiplnění; § 8 je jednodušší
     a nikdy nevyjde nižší. **Přebytek se měří NA KUS, ne na pozici — R-07j.**
  2. **Bez otevřené pozice** (kusy už jsou prodané nebo výplata nemá ISIN) se
     daní celá částka podle R-07b (WARNING `RETURN_OF_CAPITAL_NO_POSITION`) —
     nabývací cena, kterou by měla snížit, už neexistuje.
  3. **Jiná měna než měna lotu** se nepřepočítává a daní se podle R-07b
     (WARNING `RETURN_OF_CAPITAL_CURRENCY_MISMATCH`): přepočet vratky jednou
     soustavou a nabývací ceny druhou (R-06a počítá výdaj kurzem roku nákupu)
     by míchal dvě kurzové soustavy uvnitř jedné pozice.
  4. **Vratka se sraženou daní** se daní podle R-07b (WARNING
     `RETURN_OF_CAPITAL_WITHHELD`) — srážka z vratky je vnitřně rozporná
     (z vrácení vkladu se daň nesráží) a nezdanit příjem, ze kterého se přitom
     počítá zápočet, by nadhodnotilo koeficient § 38f (táž vada jako A1-3-05).

  Snížení nabývací ceny se propisuje do reportu jako každá jiná úprava lotu
  (INFO `RETURN_OF_CAPITAL_REDUCED_BASIS` s částkou), takže je průkazné, proč
  má pozice jinou nabývací cenu než nákupní doklad.

- **R-07j Přebytek vratky se měří NA KUS, ne na celou pozici.** Vratka kapitálu
  se vyplácí na jeden kus (`per share`), takže se i porovnává s tím, co ten kus
  stál: sníží nabývací cenu každého otevřeného lotu **až na nulu** a část, která
  cenu lotu přesáhne, se zdaní podle mantinelu 1. Kusy z jiných, dražších lotů
  do toho nevstupují.

  Rozdíl je vidět na dvou pozicích se **stejnou** nabývací cenou 100 100 Kč
  a vratkou 20 000 Kč: rozřezaná na lot 100 ks à 1 Kč a lot 100 ks à 1 000 Kč
  dá základ § 8 = 9 900 Kč, kdežto jediný lot 200 ks à 500,50 Kč dá nulu.

  **Proč na kus, a proč z toho nebude přepínač:**
  - Měření na pozici by uvnitř jedné pozice **skrytě průměrovalo nabývací ceny
    napříč loty**, což je přesně to, co R-05c (párování FIFO/LIFO) zakazuje —
    každý lot má vlastní pořizovací cenu a vlastní datum nabytí.
  - Na kus je vždy ≥ na pozici, takže daň **nikdy nepodhodnotí**. A není to jen
    posun v čase: kdyby se přebytek nezdanil teď a kusy se prodaly po splnění
    časového testu, nezdanil by se **nikdy**. To odporuje deklarovanému
    „mantinely všechny konzervativním směrem".
  - Analogie v ZDP: § 36 odst. 3 věta druhá u snížení základního kapitálu
    porovnává výplatu s nabývací cenou **podílu**, ne s úhrnem majetku
    poplatníka. Zahraniční prameny, které tenhle institut popisují podrobněji,
    počítají stejně: IRC § 301(c) a Treas. Reg. § 1.1012-1(c) měří základ
    **per share** (a per lot, existuje-li adekvátní identifikace),
    *Johnson v. United States* 435 F.2d 1257 (5th Cir. 1971) totéž.

  Sporný výklad, u kterého by přepínač dával smysl, to není: mírnější čtení
  by bylo věcně chybné, ne jen odvážnější. **Jistota střední** (analogie, ne
  přímá úprava).

  ⚠️ Hláška `RETURN_OF_CAPITAL_EXCESS` proto musí mluvit o **kusu**, ne o pozici.
  Do 23. 8. 2026 tvrdila „přesáhla nabývací cenu pozice o 9 900 Kč" u pozice
  s nabývací cenou 100 100 Kč — číslo, které v ní nemá oporu (nález K6b-03).

  ⚠️ **Přepínač působí jen na výplaty, které jsou jako vratka OZNAČENÉ.**
  Příznak zavádějí parsery (Trading 212 `Dividend (Return of capital)`, IBKR
  `Return of Capital`) až od 12. 8. 2026 — u dřív naimportovaných výpisů
  v datech není a dopočítat ho zpětně nejde, protože kanonický model si
  původní popis řádku nedrží. Kdo chce mírnější výklad uplatnit i na starší
  data, smaže dávku importu a nahraje výpis znovu. Deduplikační otisk příznak
  ZÁMĚRNĚ neobsahuje (je odvozený z popisu, ne z peněz), takže samotné opakované
  nahrání téhož souboru nic nezmění — musí se smazat dávka.

## R-08 Paušální daň (§ 2a, § 7a) — klíčová funkce Danero

Dvě oddělené roviny:

- **R-08a Paušální REŽIM (§ 2a)**: překročení 50k limitu jej **neukončuje** (končí až např. obratem § 7 nad 2 mil., plátcovstvím DPH…). Poplatník v režimu zůstává a platí zálohy i další rok.
- **R-08b Daň rovna paušální dani (§ 7a)**: podmínka — kromě § 7 jen příjmy osvobozené / mimo předmět / srážkové, a příjmy § 8 + § 9 + § 10 **v úhrnu ≤ 50 000 Kč** (§ 7a odst. 1 písm. b bod 4).

  ⚠️ **Druhá podmínka, o které se do 23. 8. 2026 mlčelo: zápočet zahraniční daně
  (§ 7a odst. 5).** Text: „Daň se nerovná paušální dani, pokud poplatník podle
  odstavce 1 nebo 2, který je daňovým rezidentem České republiky, **vyloučí dvojí
  zdanění příjmů plynoucích ze zdrojů v zahraničí v daňovém přiznání**.“ Není to
  zákaz, je to **volba** — a spouští ji teprve UPLATNĚNÍ zápočtu v přiznání, ne
  samotné podání přiznání.

  **Dopadá jen na toho, kdo limit 50 000 Kč NEPROLOMIL.** Odstavec 5 mluví
  o „poplatníkovi podle odstavce 1 nebo 2“ — kdo limit prolomil, podmínku odst. 1
  písm. b) nesplňuje, jeho daň paušální dani není rovna už z toho důvodu a zápočet
  má uplatnit **v plné výši**. Vyčíslení dopadu prolomení (R-08f, varování
  `FLAT_TAX_BROKEN`) se tímhle pravidlem tedy **nemění** a počítá daň po zápočtu
  správně.

  **Pro paušalistu pod limitem je ta volba skoro vždy nevýhodná.** V paušálním
  režimu se zahraniční dividenda ani úrok v ČR samostatně nedaní, takže není proti
  čemu srážku započítávat — a cenou za zápočet je ztráta paušální daně za celý rok:
  přiznání, přehledy ČSSZ i zdravotní pojišťovně a doplatek pojistného ze skutečných
  příjmů. **Paušální REŽIM tím nekončí** — § 2a odst. 8 vypočítává důvody zániku
  taxativně a uplatnění zápočtu mezi nimi není (R-08a), zálohy se platí dál.
  Sraženou daň nad smluvní strop je správné žádat zpět **ve státě zdroje**, ne
  v českém přiznání.

  Danero na to upozorní varováním `FLAT_TAX_FOREIGN_CREDIT_UNAVAILABLE` (INFO) —
  právě a jen když je režim `PAUSAL`, limit 50k **není** prolomený a zahraniční
  srážka je nenulová. Prolomivší ho vidět nesmí (nález K7a-02).

  Povinnost podat přiznání v roce, kdy daň paušální dani rovna není, plyne z § 38g
  odst. 7 („Daňové přiznání je povinen podat poplatník, který byl alespoň část
  zdaňovacího období poplatníkem v paušálním režimu a jehož daň za toto zdaňovací
  období není rovna paušální dani.“) — nezávisle na limitech R-09a/R-09b.

  ⚠️ **Od ZO 2027 bude tenhle výčet neúplný**: zák. č. 360/2025 Sb. (novelizační
  body 17 a 18) doplňuje do § 7a odst. 1 písm. b) nový **bod 5** — příjmy podle § 6
  odst. 4 — s účinností 1. 1. 2027. Do konfigurace roku 2027 to patří dřív, než se
  za 2027 začne počítat.
- **R-08c Co se do 50k NEPOČÍTÁ**: osvobozené příjmy (časový test splněn — R-01; úhrn prodejů CP ≤ 100k — R-02; krypto analogicky), české dividendy (R-07a) a české úroky **se sraženou daní** (R-07g — bez srážky se počítají). Objem osvobozených příjmů je neomezený.
- **R-08d Co se POČÍTÁ (hrubé příjmy, ne zisk!)**: zahraniční dividendy **brutto**, neosvobozené **tržby** z prodeje CP/krypta, zdanitelné úroky, nájmy. Příklad: prodej za 120 000 Kč, držba < 3 roky, zisk 5 000 Kč → do limitu vstupuje 120 000 Kč → prolomeno.
- **R-08e Důsledky prolomení**: daň není rovna paušální dani → povinnost podat přiznání (vše standardně vč. § 7) + přehledy ČSSZ a ZP + pojistné standardně; zaplacené paušální zálohy se započtou.
- **R-08f Danero hlídá**: běžící součet (zahraniční dividendy brutto + neosvobozené tržby + ostatní § 8–10 dle ručního zadání) vůči 50 000 Kč; warning pásma 60 % / 85 % / prolomeno; simulace prodeje ukazuje dopad na tento limit **před** obchodem; odhad finančního dopadu prolomení.

  **Vyčíslení dopadu (co engine počítá a co ne).** Při prolomení se dopočte
  **doplatek daně** = orientační daň z § 8 + § 10 (varianta obecného základu
  po zápočtu zahraniční srážky, R-07c) **minus zaplacené zálohy na daň**
  z paušálních záloh. Započítává se jen **daňová složka** paušální zálohy
  (§ 38lk odst. 1: 100 Kč/měsíc v 1. pásmu, tj. 1 200 Kč/rok) — pojistné složky
  se započítávají v přehledech ČSSZ a ZP, ne v přiznání. Výše zálohy je
  v konfiguraci roku (`flatTaxAdvance`; 2024 = 7 498 Kč, 2025 = 8 716 Kč,
  2026 = 9 162 Kč měsíčně, vždy 1. pásmo — zdroj: Finanční správa, Informace
  k institutu paušální daně; u 2026 po zpětném snížení odvodů OSVČ od 1. 1. 2026,
  leden–červen se platilo 9 984 Kč a rozdíl je přeplatek). Předpokládá se
  **1. pásmo** — profil poplatníka pásmo nenese.

  Stejně tak se předpokládá **12 měsíců v paušálním režimu** (12 × daňová složka
  zálohy). Kdo do režimu vstoupil nebo z něj vystoupil během roku, zaplatil záloh
  míň a **skutečný doplatek je vyšší** — až o 1 100 Kč (11 měsíců × 100 Kč).
  Počet měsíců profil poplatníka nenese, engine ho neumí zjistit z transakcí,
  a tak ten předpoklad **říká nahlas** ve varování `FLAT_TAX_BROKEN` (nález A1-05).
  Chyba jde jen jedním směrem — doplatek je podhodnocený, nikdy nadhodnocený.

  **Pojistné engine nepočítá** (chybí základ § 7, který je mimo evidovaná data) —
  varování ho zmiňuje slovně: prolomením vzniká povinnost podat přehledy ČSSZ
  a ZP a doplatit pojistné ze skutečných příjmů. Doplatek daně z § 7 taky není
  součástí odhadu, protože § 7 Danero neeviduje.

## R-09 Povinnost podat přiznání (§ 38g) a oznámení (§ 38v)

- **R-09a** Obecný limit: zdanitelné příjmy > 50 000 Kč/rok (mimo osvobozené a srážkové).
- **R-09b** Zaměstnanec: vedlejší příjmy § 7–10 > **20 000 Kč** (hrubé zdanitelné) → přiznání. Danero hlídá pro profil „zaměstnanec".
- **R-09c** Paušální OSVČ: viz R-08.
- **R-09d § 38v**: oznámení osvobozeného příjmu > **5 mil. Kč** (jednotlivý příjem = „v jednom čase z jednoho titulu od jednoho subjektu", D-59) — týká se i prodejů osvobozených časovým testem; pokuty 0,1–15 % (§ 38w). Danero: detekce jednotlivých prodejů > 5M a upozornění.

  **Lhůta: „do konce lhůty pro podání daňového přiznání“ (§ 38v odst. 1) — jenže
  pro toho, kdo přiznání nepodává, je to 1. 4., ne 1. 5.** Pokyn GFŘ D-59, str. 45,
  „K § 38v“: „I poplatník, kterému za dané zdaňovací období nevznikne povinnost
  podat daňové přiznání …, je povinen učinit oznámení o osvobozených příjmech,
  a to ve lhůtě podle ust. § 136 odst. 1 daňového řádu.“ Prodloužení na 4 měsíce
  totiž podle § 136 odst. 2 písm. a) DŘ nastane, jen „pokud … **následně bylo
  daňové přiznání podáno elektronicky**“ — a kdo přiznání nepodává vůbec, žádné
  prodloužení nezíská. Totéž platí pro šestiměsíční lhůtu poradce (§ 136 odst. 2
  písm. b bod 2: „následně daňové přiznání podal poradce“).

  ⚠️ **Kdo přiznání podává, má obě lhůty totožné** (3 / 4 / 6 měsíců podle R-09e);
  rozcházejí se jen u nepodávajícího — a to až o měsíc (za ZO 2025: **1. 4. 2026**
  místo elektronických 4. 5. 2026). Právě u něj to bolí nejvíc: daň žádná není,
  ale sankce podle § 38w se počítá z **neoznámeného příjmu**, tedy u prodeje za
  5 mil. Kč 5 000 Kč (0,1 %) až 750 000 Kč (15 %). Do 23. 8. 2026 kalkulačka
  tvrdila opak — „Přiznání to není, lhůta je ale stejná“ (nález K7a-03).
- **R-09e Lhůty pro podání** (§ 136 daňového řádu, zák. č. 280/2009 Sb.): lhůta
  běží od konce zdaňovacího období (§ 33 odst. 1 DŘ — počítá se ode dne
  následujícího a končí dnem téhož označení), takže za ZO `R` vychází:

  | Způsob podání | Lhůta | Základní datum |
  |---|---|---|
  | písemně (papírově) | 3 měsíce (§ 136/1) | 1. 4. `R+1` |
  | elektronicky | 4 měsíce (§ 136/2 a) | 1. 5. `R+1` |
  | poradcem / povinný audit | 6 měsíců (§ 136/2 b) | 1. 7. `R+1` |

  **Datum se musí POČÍTAT, ne psát natvrdo.** Připadne-li poslední den lhůty na
  sobotu, neděli nebo svátek, je posledním dnem lhůty nejblíže následující
  pracovní den (**§ 33 odst. 4 DŘ**). Svátky dle zák. č. 245/2000 Sb. —
  seznam už v repu je (`CZ_HOLIDAYS` v `packages/engine/src/config/exchangeHolidays.ts`,
  pokryté roky 2019–2027; runbook R-01a doplňuje oba kalendáře společně).

  Ověřovací příklad (ZO 2025): papírově **1. 4. 2026** (středa, neposouvá se);
  elektronicky 1. 5. 2026 je **pátek a státní svátek** → 2. 5. sobota → 3. 5.
  neděle → **pondělí 4. 5. 2026**; poradcem **1. 7. 2026** (středa).
  Zdroj: [Finanční správa — Vyplňujete daňové přiznání za rok 2025](https://financnisprava.gov.cz/cs/financni-sprava/media-a-verejnost/tiskove-zpravy-gfr/tiskove-zpravy-2026/vyplnujete-danove-priznani-za-rok-2025).

  **Tahle tabulka platí pro oznámení podle § 38v jen u toho, kdo přiznání
  skutečně podá.** Prodloužení podle § 136 odst. 2 je v obou písmenech podmíněné
  tím, že přiznání „následně bylo podáno“ (elektronicky, resp. poradcem) — bez
  podaného přiznání zůstává lhůta tříměsíční (R-09d).

  ⚠️ Natvrdo zapsané datum je chyba, která se **sama neprojeví** — jen jednou
  za rok ukáže jiný den, než platí (za ZO 2024 vycházel elektronický termín
  na 2. 5. 2025, za ZO 2025 už na 4. 5. 2026). Testy proto nesmí očekávanou
  hodnotu zapsat konstantou, ale odvodit ji z pravidla.

## R-10 Kryptoaktiva (zák. č. 32/2025 Sb., účinnost 15. 2. 2025) — implementováno (G6)

Vymezení: kryptoaktivum dle nařízení MiCA (EU) 2023/1114 — digitální zachycení hodnoty
nebo práva převoditelné a ukládatelné pomocí DLT; osvobození zj)/zk) se vztahuje jen
na kryptoaktiva odpovídající regulatornímu rámci MiCA (KOOV **625/30.04.25**, závěr
2.1.1, **souhlas GFŘ**). Pro FO nepodnikatele je prodej kryptoaktiva příjem z prodeje
**nehmotné movité věci** — § 10/1 b) bod 3 (GFŘ Informace č. j. **18809/22**; D-59
k § 10/1 písm. b: „za jinou věc se považuje také nehmotná věc"). Pozor: GFŘ připravuje
komplexní metodický materiál ke kryptoaktivům (společná pracovní skupina — závěrečná
poznámka GFŘ v KOOV 625); po vydání pravidla zrevidovat.

- **R-10a Hodnotový limit 100k (§ 4/1 zj)**: osvobozen úhrn **hrubých příjmů (tržeb)**
  z úplatného převodu kryptoaktiv ≤ 100 000 Kč/ZO — **s výjimkou elektronických
  peněžních tokenů** (EMT — stablecoiny typu USDT/USDC): text § 4/1 zj) ve znění
  zák. č. 32/2025 Sb. je z osvobození výslovně vylučuje. Prodej EMT je proto
  zdanitelný **vždy** (§ 10, s výdaji) bez ohledu na úhrn a jeho tržby se do úhrnu
  100k **nepočítají vůbec** — úhrn se posuzuje jen z ne-EMT tržeb. EMT zůstává
  **stejným druhem příjmu § 10** jako ostatní kryptoaktiva (R-10c) — zisky a ztráty
  se uvnitř druhu kompenzují. EMT detekujeme podle tickeru instrumentu (seznam
  `EMT_TICKERS` v enginu: USDT, USDC, EURC… — hlavní fiat-podložené EMT dle MiCA,
  rozšiřitelný); seznam nemůže být úplný — exotický stablecoin mimo seznam zachytí
  stávající varování `CRYPTO_EMT_ASSUMPTION` (R-10g).

  ⚠️ **Je DAI a USDD elektronický peněžní token? Sporné — ale primární text
  svědčí spíš pro ANO.** Definice v MiCA čl. 3 odst. 1 bodu 7 chce kryptoaktivum,
  „jehož cílem je udržovat stabilní hodnotu tím, že odkazuje na hodnotu **jedné
  úřední měny**“ — o krytí peněžními prostředky v ní **není nic**. Bod odůvodnění
  **41** téhož nařízení navíc výslovně říká, že se hlava III nebo IV použije „bez
  ohledu na to, jak vydavatel zamýšlí kryptoaktiva koncipovat, **včetně mechanismu
  pro udržování jejich stabilní hodnoty**“, a že „totéž platí pro tzv. algoritmické
  ‚stablecoiny‘“. ART je přitom v čl. 3 odst. 1 bodu 6 vymezen *negativně* — jako
  token, který **není** elektronickým peněžním tokenem. `DAI` (nadkolateralizovaný
  kryptoaktivy) i `USDD` (algoritmický) odkazují na hodnotu **jediné** úřední měny,
  takže literou bodu 7 EMT jsou; dřívější odůvodnění („nejsou kryté peněžními
  prostředky, jsou nanejvýš ART“) stálo na kritériu, které v nařízení není
  (nález K7a-05).

  Engine je proto drží ve vyloučení — a nově ne jen jako bezpečný default, ale jako
  **výkladově pravděpodobnější variantu**. Eviduje je zvlášť
  v `EMT_DISPUTED_TICKERS` a vydává INFO `CRYPTO_EMT_DISPUTED` s vyčíslením
  dotčených tržeb, aby rozhodnutí zůstalo na poplatníkovi.

  ⚠️ **Opačný výklad není jednoznačně výhodnější — je NEMONOTÓNNÍ.** Kdyby se DAI
  a USDD braly jako běžné kryptoaktivum, jejich tržby by sice mohly být osvobozené
  do 100 000 Kč, ale zároveň by do toho úhrnu **vstupovaly** — a mohly by ho
  přetáhnout. Cliff podle R-02a by pak shodil osvobození i ostatním krypto prodejům,
  které jsou dnes osvobozené, takže „mírnější výklad = míň daně“ tady neplatí.
  Hláška to musí říct: kdo se rozhoduje, potřebuje vědět, že rizikovější varianta
  může vyjít i dráž. **Samostatný limit vedle
  limitu CP** (R-02d) — oba se čerpají nezávisle. Cliff jako R-02a (překročení =
  osvobození padá celé). Neplatí pro krypto v obchodním majetku (a 3 roky po
  ukončení činnosti).
- **R-10b Časový test 3 roky (§ 4/1 zk) a účinnost novely**: příjem osvobozen,
  přesáhne-li doba mezi nabytím a převodem 3 roky. Doba držby **před účinností se
  započítává** (KOOV 625, závěr 2.2.1.2) — nákup 2020, prodej 3/2025 = osvobozen.
  Novela nemá přechodná ustanovení a je účinná od **15. 2. 2025**: osvobození (zj i zk)
  se vztahuje **jen na příjmy realizované od 15. 2. 2025**; příjmy 1. 1.–14. 2. 2025
  jsou plně zdanitelné dle § 10 (s výdaji) a **do limitu 100k se nepočítají**
  (KOOV 625, závěr 2.2.1.5 + příklady, souhlas GFŘ). Pro ZO **≤ 2024 krypto žádné
  osvobození nemá** (GFŘ 18809/22) — config `cryptoRules.exemptionsAvailable: false`.
  V takovém roce **žádný limit 100k neexistuje** a nesmí se zobrazovat jako
  splněný: hlídač limitu proto nese příznak `applicable: false` (čerpání i strop
  jsou nulové, protože osvobozovat není co) a UI měřák v tom roce neukazuje.
  Dědictví od příbuzného v řadě přímé/manžela dobu zůstavitele započítává; sloučení/
  splynutí kryptoaktiv a výměna kryptoaktiva jeho vydavatelem test nepřerušují (text zk).
- **R-10c Jiný druh příjmu § 10**: krypto = § 10/1 b) bod 3 „převod jiné věci" —
  **jiný jednotlivý druh** než prodej CP (D-59 k § 10/4 bod 1 a 2: každý druh se
  posuzuje samostatně). Zisky a ztráty se kompenzují **jen uvnitř druhu**, nikdy
  s CP; záporný úhrn druhu se neuplatní (ani nepřenáší). Dílčí základ § 10 =
  max(0, CP) + max(0, krypto). Krypto-krypto směna = **úplatný převod** oceněný
  obvyklou cenou (GFŘ 18809/22: směna se zdaňuje na obou stranách) — importér ji
  rozkládá na SELL+BUY v obvyklé ceně, engine formát nevidí.
- **R-10d Strop 40M v ZO 2025 — společný**: úhrn příjmů osvobozených dle q) + u) +
  zk) sdílí **jeden** strop 40 mil. Kč (§ 4/3); poměrné krácení jako R-03 (osvobozeno
  zůstává příjem × strop/úhrn, výdaje týmž poměrem). Do úhrnu vstupují jen krypto
  příjmy osvobozené od účinnosti (KOOV 625, závěr 2.2.1.6.1); limit se za rok 2025
  **nekrátí** na dny/měsíce (závěr 2.2.1.6.2).

  **Bez step-upu pro krypto.** Step-up (tržní hodnota k 31. 12. 2024 jako výdaj
  namísto pořizovací ceny) zavedl zák. č. 349/2023 Sb., **čl. XV bod 32** (ČÁST
  DESÁTÁ — Změna zákona o daních z příjmů) jako **§ 10 odst. 9 ve znění účinném do
  31. 12. 2025**; byl textově vázaný na krácení podle stropu § 4 odst. 3 a platil
  jen pro cenné papíry a podíly v obchodní korporaci. Na kryptoaktiva rozšířen
  nebyl (KOOV 625, závěr 2.2.1.4) — u krypta se uplatní jen standardní výdaje.

  ⚠️ **Vždy psát „§ 10 odst. 9 ve znění účinném do 31. 12. 2025“.** Step-up zrušil
  zák. č. 360/2025 Sb., čl. VI bod 22 („V § 10 se odstavec 9 zrušuje“) s účinností
  **1. 1. 2026** (bod 22 není v žádném odloženém výčtu čl. XXXIV); podle čl. VII
  bodu 1 (přechodné ustanovení) pro ZO 2025 step-up i strop 40M pro CP dál platí.
  Dnešní § 10 odst. 9 je **úplně jiné ustanovení** — samostatný základ podle § 16a
  pro zahraniční příjmy podle § 10 odst. 8 — takže holý odkaz „§ 10/9“ vede toho,
  kdo si pravidlo ověřuje, na nesmysl (nález K7a-01).

  ⚠️ Nesrovnalost v podkladech auditu, vyřešená měřením: nález K7a-01 uváděl
  „349/2023 Sb. **čl. I** bod 32“. Ověřeno proti textu novely — ČÁST PRVNÍ zákona
  349/2023 Sb. je *Změna trestního řádu* (Čl. I), zákon o daních z příjmů mění až
  ČÁST DESÁTÁ, a to **Čl. XV**, jehož bod 32 zní „V § 10 odstavec 9 zní: …“. Platí
  tedy **čl. XV**.
- **R-10e Strop od 2026 jen pro krypto**: zák. č. 360/2025 Sb. strop 40M pro CP
  a podíly od 1. 1. 2026 zrušil; **pro krypto (zk) trvá**. Config: `timeTestCap.appliesTo`
  (2025: `['SECURITIES','CRYPTO']`; 2026+: `['CRYPTO']`).
- **R-10f Limity 50k/20k a § 38v**: **neosvobozené** krypto tržby (**hrubé**, ne zisk)
  se počítají do limitu 50k pro daň rovnou paušální dani (§ 7a, R-08d), do limitu
  20k zaměstnance (R-09b) i obecného 50k (R-09a) — včetně tržeb 1. 1.–14. 2. 2025
  (R-10b). Jednotlivý **osvobozený** krypto příjem > 5 mil. Kč podléhá oznámení
  dle § 38v (R-09d).
- **R-10g Sporné body (⚠️, bezpečné defaulty)**:
  - ⚠️ **EMT a časový test**: zj) EMT výslovně vylučuje, **zk) nikoli** — výklad
    nejednotný. Přepínač `emtTimeTestExempt` (default `false` = bezpečný výklad:
    EMT časovým testem NEosvobozovat, prodej EMT je zdanitelný vždy). Mírnější
    výklad (`true`) EMT po 3 letech držby osvobodí — opora v liteře zk), které EMT
    na rozdíl od zj) nevylučuje; správní praxe zatím chybí (riziko doměrku).
    Při prodejích detekovaných EMT v roce engine přidá varování `CRYPTO_EMT_DETECTED`
    s vyčíslením tržeb a částky, kterou by mírnější výklad osvobodil. Varování
    `CRYPTO_EMT_ASSUMPTION` (při aplikaci krypto osvobození na ne-EMT tržby) nově
    kryje jen tokeny mimo seznam `EMT_TICKERS` — „exotický stablecoin mimo seznam
    vyřaď/označ ručně".
  - ⚠️ **Párování částečných prodejů**: metoda není předepsána (jako R-05c) — default
    FIFO, konzistence per rok, stejné strategie jako CP.

## R-11 ETF a fondy

- ETF/podílové listy = CP → plný režim R-01/02/05.
- **Akumulační ETF**: interní reinvestice není zdanitelná událost — daní se až prodej.
- **Distribuční ETF**: dividendy = § 8 (R-07) dle domicilu fondu (IE typicky 0% srážka, česká 15% daň zůstává).
- Přeměny fondů: R-04d; ⚠️ u zahraničních SICAV/ICAV výkladové. **Změna třídy (dist→acc)** = riziko přerušení testu, nevyjasněno → označit jako událost k posouzení.
  Implementace: změna třídy přichází z brokerů jako `ISIN_CHANGE`. Lot podle
  R-04e **pokračuje** (test se nepřerušuje), ale označí se jako výkladový
  (`lot.interpretive`) a engine vydá varování `ISIN_CHANGE_INTERPRETIVE` —
  z dat nejde odlišit prostou změnu ISIN od změny třídy fondu, a mlčky přenesený
  časový test je přesně to, co si zaslouží posouzení.

---

## R-12 Deriváty: opce, futures, CFD (§ 10) — implementováno (G7)

K derivátům FO–nepodnikatele neexistuje KOOV ani judikatura NSS; D-59 je u § 10
výslovně nejmenuje. Oblast stojí na obecném textu § 10 a ustálené poradenské
praxi (XTB informace pro klienty, Taxomat, Hedger, Taxero) — jistoty uvedeny.

- **R-12a Kvalifikace**: příjmy z derivátů (opce, futures, CFD, forwardy) jsou
  ostatní příjem **§ 10** (nikdy § 8, nikdy režim CP). Písmeno odst. 1 sporné
  (b) bod 3 „jiná věc" — D-59 K § 10/1 b): *„za jinou věc se považuje také
  nehmotná věc, např. … měnový pár"* — vs. zbytkové r)); na výši daně nemá vliv.
  Jistota vysoká.
- **R-12b Jeden druh**: všechny derivátové obchody = jeden „jednotlivý druh
  příjmu" (§ 10/4, D-59 K § 10/4 body 1–2) — zisky a ztráty uzavřených obchodů
  se v rámci roku kompenzují, výdaje druhu max. do výše příjmů druhu, úhrnná
  ztráta druhu zaniká (nepřenáší se). Jistota vysoká.
- **R-12c Žádné osvobození**: časový test (§ 4/1 u) a 100k (§ 4/1 t) platí jen
  pro CP, zj)/zk) jen pro krypto, strop 40M jen pro osvobozené příjmy → na
  deriváty nedopadá nic. Jistota vysoká. Sporné: osvobození druhu do 50k
  (§ 10/3 a) by dopadlo jen při kvalifikaci pod r) — **default neaplikovat**.
- **R-12d Sekuritizované instrumenty**: warrant/certifikát vydaný jako CP se
  daní v režimu CP (druh D vč. testů) — rozhoduje právní forma. Jistota střední.
  Import: při nejistotě default derivát (bez osvobození = bezpečné).
- **R-12e Příjem = realizovaná kladná plnění**: daní se hotovostně okamžik
  realizace (uzavření/vypořádání); nerealizované přecenění se nedaní; „příjem"
  druhu = úhrn hrubých kladných plnění (sloupec 2 P2), ne netto zisk. Jistota
  střední (oficiální definice neexistuje).
  **Rozhodné datum = vypořádání, ne obchod** — stejně jako u CP (R-05a): peníze
  jsou na účtu až vypořádáním, a hotovostní princip § 5 se váže na ně. Prodej
  opce s obchodem 31. 12. a vypořádáním 2. 1. patří proto do **následujícího**
  zdaňovacího období. Datum vypořádání z výpisu brokera má přednost; když chybí,
  dopočítá se jako u CP (R-01a, včetně burzovních svátků).

  **Výjimka: instrumenty s `settlementStyle = MARGIN` (CFD, futures) se
  vypořádávají okamžitě, T+0.** Burzovní lhůta T+1/T+2 je lhůta pro převod
  *cenného papíru* na majetkový účet — CFD ani futures se takhle nepřevádějí
  a plnění je realizované **uzavřením pozice** (R-12f: „příjem = kladný rozdíl
  při uzavření pozice"; R-12r: reporty MT dávají „realizovaný výsledek
  uzavřeného obchodu"). Dopočítávat jim T+2 posouvá rok příjmu.

  ⚠️ Doloženo měřením: MT4 obchod uzavřený **30. 12. 2025** dostal dopočtem
  vypořádání 2. 1. 2026 (TARGET2: 31. 12. → 1. 1. svátek → 2. 1.), takže zisk
  60 000 Kč spadl do ZO 2026 a limit 50 000 Kč za rok 2025 hlásil „neprolomeno“,
  přestože prolomený byl. Plní-li broker `settlementDate` sám (dnes jedině IBKR),
  má jeho hodnota přednost i u MARGIN.

  **Opce (`settlementStyle = PREMIUM`) se vypořádávají T+1.** Prémie i výsledek
  uzavření se u listovaných opcí připisují **následující obchodní den** —
  clearing zajišťuje OCC (US) a obdobné protistrany v EU, a od zkrácení
  akciového cyklu na T+1 (28. 5. 2024) je to shodné s podkladem. Bez tohohle
  pravidla dopadá na opce zbytkový dopočet T+2 podle kalendáře TARGET2, protože
  brokeři je reportují pod **syntetickým identifikátorem** (`OPT:SPY-…`), ze
  kterého se burza poznat nedá — a `settlementDate` u opcí plní jedině IBKR.

  ⚠️ Doloženo měřením přes skutečný parser Schwabu: prodej opce **30. 12. 2025**
  za 2 500 USD dostal dopočtem vypořádání **2. 1. 2026**, takže ZO 2025 vykázalo
  derivátové příjmy 0 Kč a limit 50 000 Kč „neprolomeno“, zatímco ZO 2026
  dostalo 124 800 Kč navíc. Je to táž vada jako u MT4/MT5 výš, jen jinou cestou.
  Dřívější datum je tu zároveň bezpečný směr: příjem se vykáže dřív, takže se
  limit 50k nepodhodnotí. Zdroj: [OCC — Settlement Process](https://www.theocc.com/clearance-and-settlement/clearing)
  (prémie T+1), tiskové zprávy SEC ke zkrácení cyklu na T+1 od 28. 5. 2024.
  **Pořadí událostí téhož dne** je deterministické a nezávislé na ID transakcí:
  korporátní akce → otevření (BUY, TRANSFER_IN) → uzavření (SELL, TRANSFER_OUT).
  Jinak by 0DTE opce (nákup i expirace týž den) vyšla podle abecedy ID buď
  správně, nebo s uplatněnou prémií navzdory vypnutému přepínači R-12i.
- **R-12f CFD**: příjem = kladný rozdíl při uzavření pozice; záporný rozdíl
  a poplatky = výdaj druhu. Nominál pozice není příjem. Jistota střední.
- **R-12g Futures**: denní vypořádání (variation margin) by hotovostně bylo
  příjmem dnem připsání; rozšířená praxe daní až uzavření pozice. Broker
  exporty denní vypořádání per pozice nedávají → **implementace počítá
  realizaci při uzavření** a pozici drženou přes konec roku označí varováním
  (sporný okamžik příjmu). Jistota nízká.
- **R-12h Opce — prodej long**: příjem = prodejní cena, výdaj = zaplacená
  prémie + poplatky (kurz roku zaplacení, R-12m). Jistota vysoká.
- **R-12i Opce — bezcenná expirace long**: **sporné**. Restriktivně (Taxomat,
  Hedger) prémie není výdaj (nedosáhla příjmu); per druh (XTB, Taxero, opora
  § 10/4 + D-59 K § 10/4 b. 2) je výdajem druhu v roce expirace. **Default:
  neuplatnit**; přepínač `derivativesExpensesPerType` uplatní a aplikace
  vyčíslí rozdíl + riziko. Nikdy nelze přenést do dalšího roku.
  Vyčíslení musí být **skutečný rozdíl dílčího základu** (základ s přepínačem
  vs. bez něj), ne hrubá výše neuznaných prémií: výdaje druhu jsou stropované
  příjmy druhu (§ 10/4, R-12b), takže neuznaná prémie 30 000 Kč při příjmech
  druhu 5 000 Kč nemůže základ snížit o víc než o těch 5 000 Kč. Hlásit horní
  odhad by uživatele hnalo do rizikového výkladu za výhodu, která neexistuje.

  ⚠️ **Hranice je nulový příjem a zůstává skoková — vědomě.** Pravidlo míří na
  *bezcennou expiraci*, ne na ztrátový prodej. Nabízí se uznávat výdaj jen do
  výše příjmu z téhož uzavření (tím by útes „za 0 Kč neuznáno celé, za 1 Kč
  uznáno celé“ zmizel), jenže takové krácení dopadne i na obyčejný ztrátový
  prodej — opce koupená za 10 000 a prodaná za 2 000 by přišla o 8 000 Kč
  výdaje — a tím zruší kompenzaci ztrát uvnitř druhu, kterou § 10/4 přiznává
  (R-12b). Vyzkoušeno, padá na tom golden test kompenzace. Citlivost výsledku
  na to, jestli výpis ukazuje nulu nebo pár haléřů, proto neřeší výpočet, ale
  INFO `DERIVATIVE_NEAR_WORTHLESS_CLOSE` (příjem pod 1 % pořizovací ceny při
  vypnutém přepínači), aby si uživatel podklad zkontroloval (nález A2-3-07).
- **R-12j Opce — short prémie**: přijatá prémie = příjem druhu v roce PŘIJETÍ
  (hotovostní princip § 5); zpětný odkup = výdaj druhu v roce zaplacení (přes
  přelom roku nemusí mít proti čemu jít — varování). Jistota střední.
  Varování `DERIVATIVE_BUYBACK_WITHOUT_INCOME` vzniká, když rok obsahuje zpětný
  odkup vypsané opce a výdaje druhu přesáhnou příjmy druhu — propadlá část se
  vyčíslí. Typicky short otevřený v listopadu a odkoupený v lednu: prémie se
  zdanila loni, letošní výdaj nemá proti čemu jít a do dalšího roku ho převést
  nelze (R-12b).
- **R-12k Exercise/assignment**: uplatněná long call → prémie vstupuje do
  nabývací ceny podkladu (daní se v režimu CP); long put → prémie do výdajů
  proti příjmu z prodeje podkladu; short opce po assignmentu → prémie zůstává
  derivátovým příjmem roku přijetí, cena podkladu se neupravuje. Shodná praxe
  3 zdrojů, bez oficiálního pramene. Jistota střední.
  ⚠️ Implementační omezení (obdoba poznámky u R-04h): engine prémii uplatněné
  long opce do nabývací ceny podkladu (resp. do výdajů proti prodeji podkladu)
  **nepřenáší** — obchody podkladu přicházejí z importu jako samostatné BUY/SELL
  a vazbu opce→podklad z dat nelze spolehlivě určit. Konzervativně se prémie
  neuplatní vůbec (uzavření za 0 = stejný režim jako bezcenná expirace, R-12i)
  a případ kryje varování `DERIVATIVE_EXPIRED_PREMIUM` s upozorněním, že
  u uplatněné opce prémie patří do nabývací ceny podkladu a nesmí se uplatnit
  dvakrát. Ruční úprava nabývací ceny podkladu = kandidát na rozšíření.
- **R-12l Zákaz kompenzace mezi druhy**: ztráty/výdaje derivátů nelze proti CP,
  kryptu ani jiným druhům (a naopak); do ř. 209 P2 jen kladné rozdíly druhů.
  Jistota vysoká.
- **R-12m Kurzy**: jako u CP — jednotný kurz (§ 38/7) nebo denní ČNB (§ 38/1 b),
  bez kombinace v roce; výdaj z dřívějšího roku kurzem roku vynaložení. Jistota
  vysoká (přepočet výdajů: střední, praxe). Rokem vynaložení i rokem přijetí se
  rozumí rok **vypořádání** obchodu (R-12e) — u denních kurzů se přepočítává
  kurzem dne vypořádání, ne dne obchodu.
- **R-12n Vykazování**: Příloha 2, kód druhu **F — jiné ostatní příjmy**
  (tiskopis 25 5405/P2 **vzor č. 21** za rok 2025, číselník **A–H**:
  A – příležitostná činnost, B – prodej nemovitostí, C – prodej movitých věcí,
  D – prodej cenných papírů, E – příjmy z převodu podle § 10 odst. 1 písm. c),
  F – jiné ostatní příjmy, G – bezúplatné příjmy, H – příjmy z loterie a tomboly;
  „z" při zdroji v zahraničí); samostatný řádek vedle D (CP) a C (krypto —
  dovozeno z § 10/1 b) bodu 3, oficiální přiřazení písmene pro krypto publikováno
  není; F pro deriváty = ustálená praxe). Jistota vysoká.
- **R-12o Zálohy, srážky, § 38v**: § 10 se pro poslední známou daňovou
  povinnost vylučuje (§ 38a/1) → deriváty nezakládají zálohy; žádná srážková
  daň; § 38v se netýká (nejsou osvobozené). Jistota vysoká.
- **R-12p Úroky u brokera**: úrok z hotovosti/marže = § 8 (hrubý, bez výdajů),
  ne derivátový příjem — už pokryto R-07. Placené úroky z marže/CFD financing
  default neuplatňovat (nízká opora). Jistota vysoká/nízká.
- **R-12q Limit 50k paušální daně**: do limitu se počítá úhrn HRUBÝCH příjmů
  § 8 + § 9 + § 10 („celková výše těchto příjmů", § 7a/1 b) 4) — u derivátů
  úhrn kladných přijatých plnění (R-12e–g, vč. přijatých prémií), ne zisk.
  Jistota vysoká (u přesného vymezení plnění nízká → širší pojetí = bezpečné).
- **R-12r Import platforem bez hodnot podkladu (MT4/MT5 aj.)**: reporty
  MetaTraderu (a obdobných CFD platforem) neposkytují prodejní/nákupní hodnoty
  podkladu, jen realizovaný výsledek uzavřeného obchodu v měně účtu (Profit +
  swap + komise + taxes). Plnění druhu se přebírá **per uzavřený obchod**:
  kladný čistý výsledek = příjem druhu, záporný = výdaj druhu (v mezích R-12b),
  přepočet z měny účtu kurzem dle R-12m. Otevřené pozice se neimportují (nemají
  daňový dopad, R-12e). Shodná praxe: Taxomat („zpracováváme jako CFD obchody";
  přiznává, že příjmy/výdaje z hodnot podkladu z dat získat nelze). Do limitu
  50k (R-12q) vstupuje úhrn kladných čistých výsledků — užší než teoretická
  hrubá plnění, ale jediné z dat zjistitelné. Jistota střední.

Zdroje: § 4, § 5, § 10, § 38, § 38a ZDP; D-59 K § 10/1 b) a K § 10/4;
tiskopis 5405-P2 vzor 21 (číselník A–H); XTB „Informace o zdaňování příjmů
z obchodování s deriváty" (2022); Taxomat, Hedger, Taxero, danesestandou.cz,
NeoTax (výkladová praxe). Negativní zjištění: žádný KOOV/NSS k § 10 derivátům.

---

## R-13 Prodej nakrátko (short) na spotu — implementováno

Prodej vypůjčených akcií s pozdějším zpětným nákupem (Interactive Brokers,
Lynx, Fio na BCPP, Degiro s profilem Active). **Netýká se CFD ani vypsaných
opcí** — ty jsou deriváty podle R-12 a jsou hotové.

Short se pozná VÝHRADNĚ podle značky `positionEffect` z parseru (SELL+OPEN,
BUY+CLOSE) — odvozovat ho ze sledu obchodů nejde, protože „prodej bez pozice“
je v datech nerozeznatelný od neúplné historie (`NEGATIVE_POSITION`) a splést
si to lze oběma směry. Značku plní **IBKR** (`openCloseIndicator` + znaménko
množství), **Tastytrade** (`SELL_TO_OPEN`/`BUY_TO_CLOSE` u `Instrument Type =
Equity`) a ručně **univerzální šablona** (sloupec `position_effect`).
**Schwab značku nemá** — v reálném exportu uzavírá short obyčejným `Buy`, takže
se jeho shorty dál vědomě přeskakují s vysvětlením.

**Výchozí bod je tvrdý: k prodeji nakrátko neexistuje v ČR ŽÁDNÝ výkladový
zdroj.** Ověřeno negativně, ne odhadem: pokyn GFŘ D-59 (plný text) neobsahuje
„nakrátko“, „short“ ani „zápůjčka cenných papírů“; ZDP slovo „nakrátko“ nezná;
prohledané zápisy KOOV k tomu mlčí; Taxomat spot short nepodporuje (kryje jen
CFD) a Lynx, Fio ani Patria k jeho zdanění nic neuvádějí. Pravidlo proto stojí
**na zákonném textu**, ne na praxi — u každého bodu je to rozlišené.

- **R-13a Kvalifikace**: příjem z prodeje nakrátko je příjem z úplatného
  převodu cenného papíru podle **§ 10/1 b) bod 2** — tedy TÝŽ druh jako běžný
  prodej akcií (kód D), ne zbytková kategorie. Písmeno b) neváže kvalifikaci na
  délku držby ani na způsob nabytí a short prodávající vlastnictví skutečně
  převádí: zápůjčka zastupitelné věci (§ 2390 ObčZ) převádí vlastnictví na
  vydlužitele, takže v okamžiku prodeje akcie vlastní. **Jistota střední**
  (text zákona jednoznačný, autorita chybí).

  ⚠️ **Oprava z 23. 8. 2026: zbytkové písmeno EXISTUJE.** Do té doby tu stálo
  „zbytkové písmeno pro jiný ostatní příjem v zákoně neexistuje (výčet a–q končí
  zaměstnaneckou opcí)“ — to je nepravda. § 10 odst. 1 písm. **r)** zní „ostatní
  příjem, který není příjmem uvedeným v písmenech a) až q)“; zaměstnanecká opce je
  písmeno q) a r) je zbytek. („F“ je pořád jen kolonka tiskopisu, ne zákonné
  písmeno.) Závěr R-13a to **nemění, ale opírá se jinak**: r) je výslovně
  **subsidiární** — použije se, jen když příjem nespadá pod a) až q) — a short
  prodávající vlastnictví cenného papíru skutečně převádí, takže pod b) bod 2
  spadá. Kvalifikace podle b) tedy platí dál.

  **Co by se změnilo, kdyby byl short přesto písmenem r):** osvobození 50 000 Kč
  podle § 10 odst. 3 písm. a) by na něj **dopadlo**. Jeho výluka vyjmenovává druhy
  podle odstavce 1 písm. b) nebo c), písm. f) bodu 2, písm. h) bodů 2 až 6 a písm.
  m), n) nebo p) — **písmeno r) mezi nimi není**. Kvalifikace pod r) by tedy byla
  pro poplatníka výhodnější hned dvakrát: úhrn druhu do 50 000 Kč osvobozený
  (opak R-13f) a zároveň by short nečerpal stovku podle § 4 odst. 1 písm. t)
  (opak R-13e). Právě proto je zařazení pod b) **bezpečný default** — nikdy
  nepodhodnotí daň. Přepínač z toho neděláme: litera b) je jednoznačná
  a subsidiarita r) ji nepřebíjí.
- **R-13b Okamžik příjmu**: hotovostní princip § 5/1 — příjem plyne
  **připsáním výnosu z prodeje**, ne uzavřením pozice. Pro § 10/1 b) není
  „stanoveno jinak“ a zákonodárce mezidobí přes přelom roku řeší výslovně tam,
  kde chce (§ 10/5 věta o vrácené záloze) — pro zpětný nákup obdobné pravidlo
  chybí. Rozhodné datum = **vypořádání** obchodu, konzistentně s R-05a.
  **Jistota nízká.** Opačný výklad (příjem až uzavřením pozice) se objevuje
  jen v diskusích, a to v takových, které short zaměňují s CFD a odvolávají se
  na osvobození, které na písmeno b) nedopadá — jako oporu ho brát nelze.
- **R-13c Výdaj**: nabývací cenou je **zpětný nákup** (§ 10/5: „cena, za kterou
  poplatník věc prokazatelně nabyl“ — zákon nikde nežádá, aby nabytí předcházelo
  převodu), plus komise brokera („výdaje související s uskutečněním úplatného
  převodu“). Uplatní se v roce zaplacení (hotovostně). **Jistota střední**
  (nabývací cena) / **nízká** (rok uplatnění: § 5/1 páruje výdaje s příjmy,
  hotovostní logika § 10 svědčí pro rok platby; rozpor nikdo neřeší).
- **R-13d Osvobození — časový test NEDOPADÁ**: § 4/1 u) žádá dobu mezi nabytím
  a úplatným převodem delší než 3 roky; u shortu leží nabytí bezprostředně před
  prodejem (zápůjčka), resp. zpětný nákup až po něm. Test **nelze splnit
  konstrukčně**. **Jistota vysoká.**
- **R-13e Osvobození — stovka DOPADÁ (a je to past)**: § 4/1 t) osvobozuje
  „příjmy z úplatného převodu cenných papírů, pokud jejich úhrn u poplatníka
  nepřesáhne ve zdaňovacím období částku 100 000 Kč“ — **bez jakékoli podmínky
  držby**. Platí-li R-13a, hrubý výnos shortu se do úhrnu **započítává** a může
  přes limit přetlačit i jinak osvobozené běžné prodeje: short za 300 000 Kč
  vedle dlouhého prodeje za 50 000 Kč znamená, že se zdaní obojí.
  ⚠️ **Rozhodnutí je vázané, ne dvě nezávislé volby:** buď je short úplatný
  převod CP (pak čerpá stovku *i* je jí kryt), nebo není (pak ani jedno).
  Vyloučit ho z úhrnu a zároveň mu přiznat osvobození je nekonzistentní.
  **Jistota střední.**
- **R-13f Osvobození 50k neplatí**: § 10/3 a) osvobozuje jen druhy **jiné než
  podle odstavce 1 písm. b) nebo c)**. **Jistota vysoká — ale podmíněně na
  R-13a**: platí, dokud je short příjmem podle písm. b). Pod zbytkovým písmenem
  r), které ve výluce § 10/3 a) uvedeno není, by osvobození 50 000 Kč naopak
  dopadlo. Ta dvě pravidla proto nikdo nesmí měnit odděleně.
- **R-13g Poplatek za půjčení a náhrada dividendy — NEDOLOŽENO**: borrow fee
  Fio sám popisuje jako „úrok z tržní hodnoty půjčených akcií“; úrok do výčtu
  v § 10/5 nespadá a § 10 nezná obdobu § 24, takže **default je neuplatnit**.
  Náhrada dividendy (manufactured dividend), kterou short prodávající platí
  půjčiteli, nemá v českých pramenech vůbec nic — doložena je jen existence
  povinnosti (Lynx), ne daňový režim. **Default neuplatnit**, obojí s výčtem
  v reportu, ať to uživatel může uplatnit po dohodě s poradcem.
  **Jistota nízká.**
- **R-13h Zápůjčka samotná**: přijetí ani vrácení akcií není předmětem daně
  (§ 3/4 b: „předmětem daně nejsou úvěry nebo zápůjčky“, výjimky na vydlužitele
  nedopadají). Daňově relevantní je jen prodej a zpětný nákup. **Jistota
  střední** (odvozeno ze zákona, žádný pramen to o securities lendingu neříká).
- **R-13i Vykazování a kompenzace**: kód **D** v Příloze 2 — shorty a longy
  jsou týž jednotlivý druh příjmu, takže se v rámci roku kompenzují (D-59
  ke § 10/4), a úhrnná ztráta druhu zaniká (§ 10/4). **Jistota vysoká**
  (číselník) / **střední** (zařazení shortu).
- **R-13j Přelom roku je nejtvrdší důsledek**: prodej v listopadu = zdanitelný
  příjem toho roku **bez jediného výdaje**; zpětný nákup v lednu = výdaj v roce,
  kde nemusí mít proti čemu jít, a podle § 10/4 propadá. To je legitimní
  bezpečný default, ale aplikace na něj musí upozornit **před koncem roku**,
  ne až v březnu u přiznání (obdoba `DERIVATIVE_BUYBACK_WITHOUT_INCOME`, R-12j).
- **R-13k Short čerpá limity 50k a 20k, ale ne dřív, než přestane být
  osvobozený**: je-li příjem ze shortu příjmem z úplatného převodu CP (R-13a),
  vstupuje do všech úhrnů, které se počítají z **hrubých zdanitelných příjmů**:
  50 000 Kč pro daň rovnou paušální dani (§ 7a odst. 1 písm. b bod 4),
  20 000 Kč u zaměstnance (§ 38g odst. 2) i 50 000 Kč obecné povinnosti podat
  přiznání (§ 38g odst. 1). Plyne to přímo z R-08d („neosvobozené **tržby**
  z prodeje CP") a z R-13a („týž druh").

  ⚠️ **Podmínkou je, že příjem OSVOBOZENÝ NENÍ.** Padne-li celý úhrn prodejů CP
  pod 100 000 Kč (R-13e), je osvobozený i short — a osvobozený příjem se do
  limitů nepočítá vůbec (R-08c, § 4/1 t). Měřák proto musí sáhnout na
  `exemptUnder100k`, ne na hrubou tržbu: jinak by u drobného investora
  s prodejem za 30 000 Kč hlásil „prolomený limit", který ve skutečnosti nenastal.

  **Do limitu jde `shortSales.incomeCzk`, ne `proceedsCzk`.** Při výchozím
  nastavení jsou obě čísla stejná; jenže `proceedsCzk` je hrubá tržba prodeje,
  kdežto `incomeCzk` je částka, kterou druh v daném roce skutečně zdaňuje.
  Použít tržbu by limit nadhodnotilo. **Jistota vysoká** (§ 7a, § 38g,
  § 4/1 t) v návaznosti na R-13a).

  ⚠️ Do 23. 8. 2026 engine tržby ze shortu do žádného z těch tří limitů
  nepočítal — a odporoval si sám: u téhož portfolia vyčíslil daň z § 10 na
  6 000 Kč a zároveň tvrdil, že limit 50 000 Kč je nevyčerpaný. Měřák stejně
  jako simulátor (funkce, jejímž jediným smyslem je ukázat dopad **před**
  obchodem) hlásil bezpečný stav u účtu, který limit prolomil. Naměřeno na
  2 000 náhodných portfoliích: **462× podhodnocený měřák, 4× překlopený
  verdikt**.

**Implementační poznámky:**
- Výpočet je v `packages/engine/src/basis/shortSales.ts`; do inventáře lotů
  shorty nevstupují (`engine.ts` je z ledgeru vyřazuje), aby nevyráběly
  syntetický lot za 0 Kč a hlášku o neúplné historii.
- Do druhu CP se slévají v `computeSecurities`: sdílený pool 100k, sdílená
  kompenzace, jeden řádek Přílohy 2. Report je vypisuje ve vlastní tabulce —
  loty nemají, takže v rozpisu prodejů by neměly co ukázat.
- Osvobozený rok: když je úhrn pod stovkou, neuplatní se ani výdaje ze shortů —
  **kromě** části připadající na tržbu zdaněnou v dřívějším roce
  (`priorYearIncomeExpensesCzk`), protože její příjem osvobozený nebyl.
- Fill `C;O` z IBKR (jedním obchodem se zavře jedna pozice a otevře opačná) se
  neoznačuje vůbec — kolik kusů patří na kterou stranu, výpis neuvádí — a
  uživatel dostane varování. U derivátů se značka nepoužívá (řeší je R-12).
- Uvnitř dne musí být otevření (PRODEJ) před uzavřením — sdílená priorita
  událostí řadí nákup první, což je u shortu obráceně; jinak se intradenní
  short páruje proti prázdné frontě.
- Značku nesou jen nově naimportované výpisy: dedupe je obsahový, takže
  opakované nahrání téhož souboru ji do už uložených řádků nedoplní — dávku je
  potřeba smazat a nahrát znovu (stejně jako u R-07h).

**Co zůstává otevřené:** borrow fee a náhrada dividendy se neuplatňují (R-13g,
nedoloženo); podpora shortů u Schwabu čeká na export, ze kterého by šly poznat.

Zdroje: § 3/4, § 4/1 t) a u), § 5/1, § 10/1 b), § 10/3 a), § 10/4, § 10/5 ZDP;
§ 2390 ObčZ (zápůjčka zastupitelné věci); tiskopis 5405-P2 vzor 21 (číselník);
pokyn GFŘ D-59 ke § 10/4 (jednotlivý druh příjmu). Negativní zjištění: žádné
stanovisko GFŘ, KOOV ani judikát NSS ke spot shortu; Taxomat ho nepodporuje.

---

## R-14 Výpočet daně, slevy a hranice pro doplatek (§ 16ab, § 35ba, § 35, § 38b)

Pravidlo, které do 23. 8. 2026 žilo jen v komentáři v `apps/web/lib/epo.ts` — a žilo
tam špatně. Řetězec „daň § 16 → slevy → daň § 16a → kolik zbývá doplatit" rozhoduje
o čísle, které poplatník odevzdá finančnímu úřadu, takže patří sem.

- **R-14a Součet dvou daní (§ 16ab odst. 1).** Daň poplatníka = **daň podle § 16
  snížená o slevy na dani** + **daň podle § 16a**. Pořadí je závazné: slevy se
  odečítají od daně podle § 16, teprve pak se přičítá daň ze samostatného základu.
- **R-14b Sleva se na § 16a NEUPLATNÍ (§ 35ba odst. 1).** Slevy podle § 35ba se
  odečítají „od daně vypočtené **podle § 16**", ne od celkové daně. Nevyčerpaný
  zbytek slevy na poplatníka (2025 i 2026: **30 840 Kč**) se tedy do daně ze
  samostatného základu **nepřelévá**.
- **R-14c Sleva daň nesnižuje pod nulu (§ 35 odst. 5).** „Daň … lze snížit … nejvýše
  do nuly." Sleva na poplatníka není daňový bonus, přeplatek z ní nevzniká.
  Mezikrok se proto zaokrouhluje na nulu **hned**, ne až na konci řetězce.
- **R-14d Vzorec.** `daň = max(0, daň§16 − slevy) + daň§16a`. V tiskopisu DPFDP7:
  ř. 71 = `max(0, ř.60 − 30 840)`, ř. 74a = daň § 16a (ř. 414 Přílohy 4),
  ř. 75 = ř. 74 + ř. 74a, ř. 77 = ř. 75 (bez daňového bonusu).
- **R-14e Hranice 200 Kč (§ 38b).** „Daň … se nepředepíše a neplatí, **nepřesáhne-li
  200 Kč**." Do řádku „zbývá doplatit" (ř. 91) jde proto `ř.77 ≤ 200 ? 0 : ř.77`.
  Změřeno sondou na zkušební podatelně EPO: ř. 77 = 60 / 195 / 199 / **200** → čeká 0;
  ř. 77 = **201** / 210 / 300 → čeká plnou hodnotu.
- **R-14f Druhou větev § 38b NEIMPLEMENTUJEME.** Táž věta osvobozuje od placení
  i poplatníka, jehož **roční příjmy nepřesáhnou 15 000 Kč** (resp. 50 000 Kč
  ve znění od 2023). Podatelna ji na ř. 91 neuplatňuje — podání s příjmy 40 000 Kč
  a daní 6 000 Kč prošlo bez výhrad. Podmínka se navíc váže na **veškeré** příjmy
  poplatníka, které Danero nevidí (§ 6, § 7 mimo evidovaná data). Uplatnit ji sami
  by znamenalo doplnit poplatníkovi nulu tam, kde má platit.

⚠️ **Proč to sem muselo přijít.** Kód počítal ř. 91 jako
`max(0, ř.60 − 30 840 + ř.74a)`, tedy s nevyčerpaným zbytkem slevy proti dani § 16a.
Podatelna takové XML **odmítá** (`[N] kc_zbyvpred :: Oddíl 7/ř.91 — hodnota položky
se nerovná hodnotě příslušného vzorce`) a je to i věcně proti § 35ba. Vzorec se do
kódu dostal z **jediného** pokusu, jehož ř. 77 = 30 Kč — tedy uvnitř okna § 38b, kde
oba vzorce shodně dávají nulu. Testy i kontrola podatelnou to minuly ze stejného
důvodu: vzorek `validate-epo.mjs` měl ř. 60 = 52 845 > 30 840 (obě formule splynou)
a fixtura `epo.test.ts` ř. 77 = 30 ≤ 200. **Vzorek, který vadu pozná, musí mít
zároveň `ř.60 < 30 840` a `ř.414 > 200 Kč`.**

Zdroje: § 16ab odst. 1, § 35ba odst. 1, § 35 odst. 5, § 38b ZDP; tiskopis DPFDP7
vzor 7 (kontrolní vzorce oddílu 7); 77 podání na zkušební podatelnu EPO
(`adisspr.mfcr.cz`) z 23. 8. 2026.

---

## Konfigurační přepínače (sporné výklady)

| Klíč | Default | Pravidlo |
|---|---|---|
| `timeTestDateBasis` | `settlement` | R-01a (`settlement` \| `trade`) |
| `limit100kIncludesTimeTestExempt` | `true` (striktní); per rok se fixuje při generování podkladů | R-02c |
| `spinoffCostBasisAllocation` | `zero` | R-04f (`zero` \| `proportional`) |
| frakční akcie (bez přepínače) | vždy jako CP + vlajka `FRACTIONAL_SHARES` — derivátový výklad nemá definovaný výpočet, přepínač by nic nepřepínal | R-04j |
| `matchingMethod` | `FIFO`; per rok se fixuje při generování podkladů | R-05c |
| `fxMethod` | počítat obě, uživatel volí; per rok se fixuje při generování podkladů | R-06 |
| `dividendsSeparateBase16a` | auto-doporučit při úspoře ≥ 100 Kč | R-07d |
| `treatyInterestWithholdingCap` / `defaultInterestTreatyCap` | ověřené státy dle tabulky, jinak `0` (bezpečný) | R-07f |
| `derivativesExpensesPerType` | `false` (restriktivní) | R-12i |
| `emtTimeTestExempt` | `false` (EMT zdanit) | R-10g |
| `returnOfCapitalReducesBasis` | `false` (vratku kapitálu zdanit jako dividendu) | R-07h |
| `shortSaleIncomeOnSale` | `true` (příjem už prodejem — dřívější zdanění) | R-13b |

Každý přepínač má v UI vysvětlení a odkaz na zdroj; zvolená konfigurace se tiskne do reportu (průkaznost).

## Roční údržba (runbook)

Každý leden: nový jednotný kurz (pokyn GFŘ D-xx z Finančního zpravodaje), průměrná mzda pro 23% hranici (nařízení vlády), výše paušálních záloh (`flatTaxAdvance` v `TaxYearConfig`, R-08f), **burzovní svátky nového roku** (`packages/engine/src/config/exchangeHolidays.ts` + posunout `HOLIDAY_CALENDAR_LAST_YEAR`, R-01a), kontrola novel ZDP (sledovat: KPMG danovky.cz, dReport, FS tiskové zprávy). Legislativa je verzovaná per zdaňovací období — engine přijímá `TaxYearConfig`.

## Klíčové zdroje

- ZDP 586/1992 Sb.: § 4/1 q, t, u, zj, zk; § 4/3; § 2a, § 7a; § 8, § 10, § 16, § 16a, § 36, § 38, § 38f, § 38g, § 38v/w — [zakonyprolidi.cz/cs/1992-586](https://www.zakonyprolidi.cz/cs/1992-586)
- [Pokyn GFŘ D-59](https://financnisprava.gov.cz/assets/cs/prilohy/d-sprava-dani-a-poplatku/Pokyn_GFR-D-59.pdf) (okamžik nabytí, druh příjmu, § 38v)
- [Pokyn GFŘ D-75 — jednotný kurz 2025](https://financnisprava.gov.cz/cs/dane/legislativa-a-metodika/pokyny-d/cleneni-podle-dani/dane-z-prijmu/2026/pokyn-gfr-d-75)
- [FS — FAQ paušální daň](https://financnisprava.gov.cz/cs/dane/dane/dan-z-prijmu/pausalni-dan/dotazy-a-odpovedi/dotazy-a-odpovedi-k-pausalni-dani) (ot. 61: 50k limit)
- Novely: 349/2023 Sb. (40M + step-up), 32/2025 Sb. (krypto — § 4/1 zj, zk; účinnost 15. 2. 2025), 360/2025 Sb. (zrušení 40M pro CP od 2026; pro krypto trvá)
- KOOV **625/30.04.25** (Nesrovnal, Nešleha) — osvobození příjmů z úplatného převodu kryptoaktiv, **souhlas GFŘ** se všemi závěry (MiCA vymezení; časové dopady účinnosti; limit 100k jen od 15. 2. 2025; 40M bez krácení; bez step-upu)
- [GFŘ Informace č. j. 18809/22/7100-40050-205680](https://financnisprava.gov.cz/cs/dane/dane/dan-z-prijmu/informace-stanoviska-a-sdeleni/informace-k-danovemu-posouzeni-transakci-s-kryptomenami) — daňové posouzení transakcí s kryptoměnami (nehmotná movitá věc, § 10; směna krypto-krypto zdanitelná)
- NSS 7 Afs 229/2022 (přerušení testu při výměně akcií se změnou jmenovité hodnoty)
- Odborné: danovky.cz (KPMG), dReport (Deloitte), rozbiteprasatko.cz/zdaneni-investic, danesestandou.cz
