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

## R-03 Strop 40 mil. Kč (§ 4 odst. 3)

- Platí pro úhrn příjmů osvobozených dle q), u), zk) přijatých **v roce 2025** (zaveden zák. č. 349/2023 Sb.). **Od 1. 1. 2026 zrušen pro CP a podíly** (zák. č. 360/2025 Sb.); **pro krypto (zk) trvá**.
- Krácení poměrné: osvobozená část = příjem × (40M / úhrn); výdaje se krátí stejným poměrem. Rozhodný je moment přijetí peněz.
- Step-up: u CP nabytých do 31. 12. 2024 lze jako výdaj uplatnit tržní hodnotu k 31. 12. 2024. (Engine: volitelný `costBasisOverride` na lotu.)
- Priorita implementace nízká (dopad až od 40M příjmů/rok) — engine musí mít hook, plná implementace post-MVP.

## R-04 Korporátní akce a časový test

- **R-04a Split / reverse split** (výměna při zachování celkové jmenovité hodnoty): test **nepřerušuje**; lot se transformuje (množství × poměr, cena / poměr), datum nabytí zůstává.
- **R-04b Fúze/rozdělení** dle § 23b/§ 23c: nepřerušuje. ⚠️ U zahraničních emitentů a ETF výkladové — přepínač na úrovni akce `preservesAcquisitionDate` (default true pro merger se zachováním hodnoty, s upozorněním).
- **R-04c Výměna akcií se změnou celkové jmenovité hodnoty**: test **přerušuje** (NSS 7 Afs 229/2022).
- **R-04d Sloučení/splynutí podílových fondů, přeměna uzavřeného fondu na otevřený**: nepřerušuje (výslovně § 4/1 u).
- **R-04e Změna ISIN/tickeru bez výměny nástroje**: nepřerušuje (⚠️ výkladová shoda). Lot pokračuje pod novým ISIN.
- **R-04f Spin-off**: původní loty běží dál; nové akcie = nový lot s datem nabytí = den spin-offu. ⚠️ Alokace nabývací ceny neřešena zákonem — default: cost basis nové pozice 0 Kč (konzervativní), volitelně poměrná alokace.
- **R-04g Dědictví**: od příbuzného v řadě přímé/manžela se doba držby zůstavitele **započítává** (nabytí = smrt zůstavitele); jinak nová lhůta.
- **R-04h Dar**: doba držby dárce se nezapočítává, obdarovanému běží nová lhůta.
- **R-04i Převod mezi brokery**: není převod vlastnictví → nepřerušuje (⚠️ mírně výkladové). Typ transakce `TRANSFER_IN/OUT` s párováním.
- **R-04j Frakční akcie**: ⚠️ nejasný status (u některých brokerů derivátový nárok, ne CP). Default: zacházet jako s CP + informační vlajka v reportu.

## R-05 Dílčí základ daně § 10 (neosvobozené prodeje)

- **R-05a Cash princip**: příjem patří do roku **připsání peněz** (na brokerský účet), ne roku obchodu.
- **R-05b Výdaje** (§ 10 odst. 4, 5): nabývací cena + související výdaje (poplatky, provize). Výdaje k osvobozeným příjmům uplatnit nelze.
- **R-05c Párování — metoda NENÍ předepsána** pro neúčtující FO: FIFO, LIFO i individuální identifikace jsou přípustné (stanovisko GFŘ, potvrzuje i praxe Taxomatu). Podmínka: průkaznost a konzistence. Engine: strategie `FIFO` (default) | `LIFO` | `MAX_PROFIT` | `MAX_LOSS` | `MANUAL`; zvolená metoda se per rok zafixuje a dokumentuje.
- **R-05d Kompenzace**: všechny prodeje CP v roce = **jeden druh příjmu** (D-59 k § 10/4) → ztráty a zisky mezi tituly se vzájemně započtou. **Celková ztráta druhu se nevykazuje** (dílčí základ min. 0), nepřenáší se do dalších let, nekompenzuje s jinými druhy (krypto = jiný druh ⚠️) ani s § 7/8/9.
- **R-05e Sazba**: 15 % / 23 % nad 36násobek průměrné mzdy (2025: 1 676 052 Kč; hodnotu pro 2026 doplnit z nařízení vlády). Z § 10 se neplatí sociální ani zdravotní pojištění.

## R-06 Měnové přepočty (§ 38 odst. 1)

Neúčtující FO volí pro celé zdaňovací období **jednu** soustavu (nelze kombinovat):
- **R-06a Jednotný kurz** GFŘ — publikován pokynem D v lednu za předchozí rok (za 2024 = D-66; za 2025 = D-75: EUR 24,66, USD 21,84). Statická tabulka v enginu + runbook na roční aktualizaci.
- **R-06b Denní kurzy ČNB** (dle zákona o účetnictví; příp. pevný kurz).
- Engine počítá **obě varianty** a reportuje rozdíl (recenze Taxomatu: rozdíl až desítky tisíc Kč).

## R-07 Dividendy a úroky (§ 8)

- **R-07a České dividendy**: srážková daň 15 % u zdroje, konečná — do přiznání se neuvádějí, do žádných limitů nevstupují.
- **R-07b Zahraniční dividendy**: dílčí základ § 8 **brutto** (před zahraniční srážkou), bez výdajů, přepočet dle R-06.
- **R-07c Zápočet dle § 38f**: metoda prostého zápočtu po jednotlivých státech (Příloha 3 DAP); max. sazba dle smlouvy (USA 15 %) a max. do výše české daně z tohoto příjmu. Bez W-8BEN (sraženo 30 %) lze započíst jen 15 %. Nezapočtená daň u nepodnikatele fakticky propadá ⚠️.
- **R-07d § 16a**: volitelně samostatný základ daně 15 % pro zahraniční dividendy/úroky (ochrana před 23% progresí; Příloha 4). Engine spočítá obě varianty a doporučí výhodnější.
- **R-07e** Prokazování: výpisy brokera FS v praxi akceptuje, není nárokové — dokumentační upozornění.

## R-08 Paušální daň (§ 2a, § 7a) — klíčová funkce Danero

Dvě oddělené roviny:

- **R-08a Paušální REŽIM (§ 2a)**: překročení 50k limitu jej **neukončuje** (končí až např. obratem § 7 nad 2 mil., plátcovstvím DPH…). Poplatník v režimu zůstává a platí zálohy i další rok.
- **R-08b Daň rovna paušální dani (§ 7a)**: podmínka — kromě § 7 jen příjmy osvobozené / mimo předmět / srážkové, a příjmy § 8 + § 9 + § 10 **v úhrnu ≤ 50 000 Kč**.
- **R-08c Co se do 50k NEPOČÍTÁ**: osvobozené příjmy (časový test splněn — R-01; úhrn prodejů CP ≤ 100k — R-02; krypto analogicky), české dividendy/úroky se srážkou (R-07a). Objem osvobozených příjmů je neomezený.
- **R-08d Co se POČÍTÁ (hrubé příjmy, ne zisk!)**: zahraniční dividendy **brutto**, neosvobozené **tržby** z prodeje CP/krypta, zdanitelné úroky, nájmy. Příklad: prodej za 120 000 Kč, držba < 3 roky, zisk 5 000 Kč → do limitu vstupuje 120 000 Kč → prolomeno.
- **R-08e Důsledky prolomení**: daň není rovna paušální dani → povinnost podat přiznání (vše standardně vč. § 7) + přehledy ČSSZ a ZP + pojistné standardně; zaplacené paušální zálohy se započtou.
- **R-08f Danero hlídá**: běžící součet (zahraniční dividendy brutto + neosvobozené tržby + ostatní § 8–10 dle ručního zadání) vůči 50 000 Kč; warning pásma 60 % / 85 % / prolomeno; simulace prodeje ukazuje dopad na tento limit **před** obchodem; odhad finančního dopadu prolomení (doplatek daně + pojistného vs. paušální zálohy).

## R-09 Povinnost podat přiznání (§ 38g) a oznámení (§ 38v)

- **R-09a** Obecný limit: zdanitelné příjmy > 50 000 Kč/rok (mimo osvobozené a srážkové).
- **R-09b** Zaměstnanec: vedlejší příjmy § 7–10 > **20 000 Kč** (hrubé zdanitelné) → přiznání. Danero hlídá pro profil „zaměstnanec".
- **R-09c** Paušální OSVČ: viz R-08.
- **R-09d § 38v**: oznámení osvobozeného příjmu > **5 mil. Kč** (jednotlivý příjem = „v jednom čase z jednoho titulu od jednoho subjektu", D-59) — týká se i prodejů osvobozených časovým testem; pokuty 0,1–15 % (§ 38w). Danero: detekce jednotlivých prodejů > 5M a upozornění.

## R-10 Kryptoaktiva (od 15. 2. 2025, zák. č. 32/2025 Sb.) — post-MVP modul

- Vlastní limit 100k (zj; neplatí pro stablecoiny/elektronické peněžní tokeny) + vlastní 3letý test (zk) se stropem 40M (trvá i po 2026). Doba držby před účinností se započítává; prodeje do 14. 2. 2025 postaru.
- Krypto-krypto směna = zdanitelný úplatný převod. Krypto je v § 10 **jiný druh** než CP → bez vzájemné kompenzace ⚠️.

## R-11 ETF a fondy

- ETF/podílové listy = CP → plný režim R-01/02/05.
- **Akumulační ETF**: interní reinvestice není zdanitelná událost — daní se až prodej.
- **Distribuční ETF**: dividendy = § 8 (R-07) dle domicilu fondu (IE typicky 0% srážka, česká 15% daň zůstává).
- Přeměny fondů: R-04d; ⚠️ u zahraničních SICAV/ICAV výkladové. **Změna třídy (dist→acc)** = riziko přerušení testu, nevyjasněno → označit jako událost k posouzení.

---

## Konfigurační přepínače (sporné výklady)

| Klíč | Default | Pravidlo |
|---|---|---|
| `timeTestDateBasis` | `settlement` | R-01a (`settlement` \| `trade`) |
| `limit100kIncludesTimeTestExempt` | `true` (striktní) | R-02c |
| `spinoffCostBasisAllocation` | `zero` | R-04f (`zero` \| `proportional`) |
| `fractionalSharesAsCP` | `true` + vlajka | R-04j |
| `matchingMethod` | `FIFO` | R-05c |
| `fxMethod` | počítat obě, uživatel volí | R-06 |
| `dividendsSeparateBase16a` | auto-doporučit | R-07d |

Každý přepínač má v UI vysvětlení a odkaz na zdroj; zvolená konfigurace se tiskne do reportu (průkaznost).

## Roční údržba (runbook)

Každý leden: nový jednotný kurz (pokyn GFŘ D-xx z Finančního zpravodaje), průměrná mzda pro 23% hranici (nařízení vlády), výše paušálních záloh, kontrola novel ZDP (sledovat: KPMG danovky.cz, dReport, FS tiskové zprávy). Legislativa je verzovaná per zdaňovací období — engine přijímá `TaxYearConfig`.

## Klíčové zdroje

- ZDP 586/1992 Sb.: § 4/1 q, t, u, zj, zk; § 4/3; § 2a, § 7a; § 8, § 10, § 16, § 16a, § 36, § 38, § 38f, § 38g, § 38v/w — [zakonyprolidi.cz/cs/1992-586](https://www.zakonyprolidi.cz/cs/1992-586)
- [Pokyn GFŘ D-59](https://financnisprava.gov.cz/assets/cs/prilohy/d-sprava-dani-a-poplatku/Pokyn_GFR-D-59.pdf) (okamžik nabytí, druh příjmu, § 38v)
- [Pokyn GFŘ D-75 — jednotný kurz 2025](https://financnisprava.gov.cz/cs/dane/legislativa-a-metodika/pokyny-d/cleneni-podle-dani/dane-z-prijmu/2026/pokyn-gfr-d-75)
- [FS — FAQ paušální daň](https://financnisprava.gov.cz/cs/dane/dane/dan-z-prijmu/pausalni-dan/dotazy-a-odpovedi/dotazy-a-odpovedi-k-pausalni-dani) (ot. 61: 50k limit)
- Novely: 349/2023 Sb. (40M + step-up), 32/2025 Sb. (krypto), 360/2025 Sb. (zrušení 40M pro CP od 2026)
- NSS 7 Afs 229/2022 (přerušení testu při výměně akcií se změnou jmenovité hodnoty)
- Odborné: danovky.cz (KPMG), dReport (Deloitte), rozbiteprasatko.cz/zdaneni-investic, danesestandou.cz
