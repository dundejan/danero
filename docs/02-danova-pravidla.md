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

## R-03 Strop 40 mil. Kč (§ 4 odst. 3)

- Platí pro úhrn příjmů osvobozených dle q), u), zk) přijatých **v roce 2025** (zaveden zák. č. 349/2023 Sb.). **Od 1. 1. 2026 zrušen pro CP a podíly** (zák. č. 360/2025 Sb.); **pro krypto (zk) trvá**.
- **R-03a Hodnotový limit t)/zj) pod strop NESPADÁ.** Výčet v § 4 odst. 3 je
  taxativní — q), u), zk). Osvobození úhrnem do 100 000 Kč (t pro CP, zj pro
  krypto) v něm není, takže druh příjmu, jehož úhrn tržeb se do limitu vejde,
  do stropu **nevstupuje ani se jím nekrátí** — a to i tehdy, když strop
  přetáhne druhý druh sdílející týž strop (2025: CP + krypto, R-10d).

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
- Step-up: u CP nabytých do 31. 12. 2024 lze jako výdaj uplatnit tržní hodnotu k 31. 12. 2024. (Engine: volitelný `costBasisOverride` na lotu.)
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
- **R-04c Výměna akcií se změnou celkové jmenovité hodnoty**: test **přerušuje** (NSS 7 Afs 229/2022).
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
- **R-05c Párování — metoda NENÍ předepsána** pro neúčtující FO: FIFO, LIFO i individuální identifikace jsou přípustné (stanovisko GFŘ, potvrzuje i praxe Taxomatu). Podmínka: průkaznost a konzistence. Engine: strategie `FIFO` (default) | `LIFO` | `MAX_PROFIT` | `MAX_LOSS` | `MANUAL`; zvolená metoda se per rok zafixuje a dokumentuje. `MAX_PROFIT`/`MAX_LOSS` porovnávají nabývací ceny lotů **v CZK kurzem roku nákupu** (konvence výdajů R-06a) — loty téhož ISIN mohou být v různých měnách (duální listing, GBX/GBP) a nominály napříč měnami porovnat nelze.

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
- **R-07d § 16a**: volitelně samostatný základ daně 15 % pro zahraniční dividendy/úroky (ochrana před 23% progresí; Příloha 4). Engine spočítá obě varianty a doporučí výhodnější — ale **jen když obecný základ skutečně překračuje známou hranici progrese**. Bez známé hranice (`progressiveThreshold = null`) i pod hranicí se § 16a **nedoporučuje**: obě varianty pak počítají 15 % a rozdíl je jen zaokrouhlovací šum (základy se u variant zaokrouhlují na sta dolů odděleně, max ~15 Kč), zatímco § 16a znamená ztrátu slev na dani a nezdanitelných částí základu.
- **R-07e** Prokazování: výpisy brokera FS v praxi akceptuje, není nárokové — dokumentační upozornění.

## R-08 Paušální daň (§ 2a, § 7a) — klíčová funkce Danero

Dvě oddělené roviny:

- **R-08a Paušální REŽIM (§ 2a)**: překročení 50k limitu jej **neukončuje** (končí až např. obratem § 7 nad 2 mil., plátcovstvím DPH…). Poplatník v režimu zůstává a platí zálohy i další rok.
- **R-08b Daň rovna paušální dani (§ 7a)**: podmínka — kromě § 7 jen příjmy osvobozené / mimo předmět / srážkové, a příjmy § 8 + § 9 + § 10 **v úhrnu ≤ 50 000 Kč**.
- **R-08c Co se do 50k NEPOČÍTÁ**: osvobozené příjmy (časový test splněn — R-01; úhrn prodejů CP ≤ 100k — R-02; krypto analogicky), české dividendy/úroky se srážkou (R-07a). Objem osvobozených příjmů je neomezený.
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

  **Pojistné engine nepočítá** (chybí základ § 7, který je mimo evidovaná data) —
  varování ho zmiňuje slovně: prolomením vzniká povinnost podat přehledy ČSSZ
  a ZP a doplatit pojistné ze skutečných příjmů. Doplatek daně z § 7 taky není
  součástí odhadu, protože § 7 Danero neeviduje.

## R-09 Povinnost podat přiznání (§ 38g) a oznámení (§ 38v)

- **R-09a** Obecný limit: zdanitelné příjmy > 50 000 Kč/rok (mimo osvobozené a srážkové).
- **R-09b** Zaměstnanec: vedlejší příjmy § 7–10 > **20 000 Kč** (hrubé zdanitelné) → přiznání. Danero hlídá pro profil „zaměstnanec".
- **R-09c** Paušální OSVČ: viz R-08.
- **R-09d § 38v**: oznámení osvobozeného příjmu > **5 mil. Kč** (jednotlivý příjem = „v jednom čase z jednoho titulu od jednoho subjektu", D-59) — týká se i prodejů osvobozených časovým testem; pokuty 0,1–15 % (§ 38w). Danero: detekce jednotlivých prodejů > 5M a upozornění.
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
  `EMT_TICKERS` v enginu: USDT, USDC, DAI… — hlavní fiat-podložené EMT dle MiCA,
  rozšiřitelný); seznam nemůže být úplný — exotický stablecoin mimo seznam zachytí
  stávající varování `CRYPTO_EMT_ASSUMPTION` (R-10g). **Samostatný limit vedle
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
  **nekrátí** na dny/měsíce (závěr 2.2.1.6.2). **Bez step-upu pro krypto**: § 10/9
  (tržní hodnota k 31. 12. 2024 jako výdaj) nebyl novelou na krypto rozšířen
  (závěr 2.2.1.4) — jen standardní výdaje.
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

## Konfigurační přepínače (sporné výklady)

| Klíč | Default | Pravidlo |
|---|---|---|
| `timeTestDateBasis` | `settlement` | R-01a (`settlement` \| `trade`) |
| `limit100kIncludesTimeTestExempt` | `true` (striktní); per rok se fixuje při generování podkladů | R-02c |
| `spinoffCostBasisAllocation` | `zero` | R-04f (`zero` \| `proportional`) |
| frakční akcie (bez přepínače) | vždy jako CP + vlajka `FRACTIONAL_SHARES` — derivátový výklad nemá definovaný výpočet, přepínač by nic nepřepínal | R-04j |
| `matchingMethod` | `FIFO`; per rok se fixuje při generování podkladů | R-05c |
| `fxMethod` | počítat obě, uživatel volí; per rok se fixuje při generování podkladů | R-06 |
| `dividendsSeparateBase16a` | auto-doporučit | R-07d |
| `derivativesExpensesPerType` | `false` (restriktivní) | R-12i |
| `emtTimeTestExempt` | `false` (EMT zdanit) | R-10g |

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
