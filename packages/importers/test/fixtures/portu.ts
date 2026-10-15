/**
 * Sdílené Portu fixtures. Rozložení podle skutečného exportu „Transakční
 * historie“ (15. 10. 2026): středníkové CSV, datum dd.MM.yyyy, desetinná
 * čárka, pevná mezera mezi tisíci, záporná Hodnota = odchozí peníze, Název =
 * jméno portfolia (ne instrumentu). Sloupec Typ nese druh pohybu a za
 * pomlčkou podrobnosti („Nákup – VWCE GY – 0,4823 kusů (103,58 € za kus)“).
 * Opsané je jen rozložení — tituly, portfolia, částky, kusy i data jsou
 * vymyšlené.
 */

export const PORTU_HEADER =
  'Datum;Název;Typ;Symbol;ISIN;Kusy / Pozice;Popis;Cena;Hodnota;Měna;Srážková daň;Hrubá výše dividendy';

export const PORTU_FIXTURE = [
  PORTU_HEADER,
  // nákup ETF s frakčními kusy: 0,4823 × 103,58 ≈ 49,96 (Hodnota záporná = odchozí)
  '15.01.2026;Moje portfolio;Nákup – VWCE GY – 0,4823 kusů (103,58 € za kus);VWCE GY;IE00BK5BQT80;0,4823;;103,5800;-49,96;EUR;;',
  // prodej: Hodnota kladná = příjem, kusy kladné
  '20.02.2026;Moje portfolio;Prodej – VWCE GY – 0,2500 kusů (110,00 € za kus);VWCE GY;IE00BK5BQT80;0,2500;;110,0000;27,50;EUR;;',
  // dividenda se srážkou: Hodnota = čistá částka, hrubá výše a srážka ve vlastních sloupcích
  '10.03.2026;Moje portfolio;Dividenda – EXSA GY;EXSA GY;DE0002635307;;;;12,35;EUR;2,18;14,53',
  // poplatek za správu — měsíc je v Typu i v Popisu
  '31.03.2026;Moje portfolio;Poplatek – březen 2026;;;;březen 2026;;-41,25;CZK;;',
  // vklad peněz — bez daňové události
  '12.02.2026;Moje portfolio;Vklad z bankovního účtu;;;;;;3 500,00;CZK;;',
  // spotová konverze při vkladu: „nákup EUR/CZK“ připisuje CZK, „prodej CZK/EUR“ odepisuje EUR
  '12.02.2026;Moje portfolio;Forex nákup – CZK/EUR;;;;CZK/EUR;;138,14;EUR;;',
  '12.02.2026;Moje portfolio;Forex prodej – EUR/CZK;;;;EUR/CZK;;-3 371,20;CZK;;',
  // neznámý typ → error s doslovným zněním
  '05.04.2026;Moje portfolio;Odměna – bonus za doporučení;;;;;;100,00;CZK;;',
].join('\n');

/**
 * Druhy pohybů, které skutečný export nese a první verze parseru neznala:
 * úrok, sleva na poplatku, půjčka od Portu, výběr, přesun mezi portfolii
 * (peníze i kusy) a měnové zajištění (swap s otevírací a uzavírací nohou,
 * forward s ISIN od ANNA DSB). Plus tisíce kusů s pevnou mezerou.
 */
export const PORTU_REAL_LAYOUT_FIXTURE = [
  PORTU_HEADER,
  '31.07.2025;Rezerva;Úrok;;CZK000000001;;;;212,40;CZK;0,00;',
  '04.05.2025;Rezerva;Výběr na bankovní účet – peníze jsme odeslali 04.05.2025;;;;;;-8 000,00;CZK;;',
  '03.06.2025;Moje portfolio;Sleva na poplatku – květen 2025;;;;květen 2025;;12,70;CZK;;',
  '03.08.2021;Moje portfolio;Bezúročná půjčka;;;;;;9,10;CZK;;',
  '17.09.2021;Moje portfolio;Splátka bezúročné půjčky;;;;;;-9,10;CZK;;',
  '18.02.2026;Moje portfolio;Převod do Rezerva;;;;;;-4,15;EUR;;',
  '18.02.2026;Rezerva;Převod z Moje portfolio;;;;;;4,15;EUR;;',
  '18.02.2026;Moje portfolio;Převod do Rezerva – VWCE GY – 0,2100 kusů;VWCE GY;IE00BK5BQT80;0,2100;;121,3000;-25,47;EUR;;',
  '18.02.2026;Rezerva;Převod z Moje portfolio – VWCE GY – 0,2100 kusů;VWCE GY;IE00BK5BQT80;0,2100;;121,3000;25,47;EUR;;',
  // swap: otevírací noha (prodej USD za CZK) a o dva měsíce později uzavírací
  '05.05.2023;Moje portfolio;Forex nákup – 5.5.2023 Swap USDCZK;;;;5.5.2023 Swap USDCZK;;96,80;CZK;;',
  '05.05.2023;Moje portfolio;Forex prodej – 5.5.2023 Swap USDCZK;;;;5.5.2023 Swap USDCZK;;-4,40;USD;;',
  '04.07.2023;Moje portfolio;Forex nákup – 5.5.2023 Swap USDCZK;;;;5.5.2023 Swap USDCZK;;4,40;USD;;',
  '04.07.2023;Moje portfolio;Forex prodej – 5.5.2023 Swap USDCZK;;;;5.5.2023 Swap USDCZK;;-95,90;CZK;;',
  // prodloužení swapu: v podrobnostech další pomlčka, druh pohybu ale rozhoduje ta první
  '04.07.2023;Moje portfolio;Forex nákup – 4.7.2023 Swap USDCZK - Roll;;;;4.7.2023 Swap USDCZK - Roll;;95,40;CZK;;',
  '04.07.2023;Moje portfolio;Forex prodej – 4.7.2023 Swap USDCZK - Roll;;;;4.7.2023 Swap USDCZK - Roll;;-4,40;USD;;',
  // forward vypořádaný jednou nohou, s derivátovým ISIN
  '10.11.2025;Moje portfolio;Forex nákup – 2.9.2025 Forward EURCZK;;EZ0000000001;;2.9.2025 Forward EURCZK;;7 410,50;CZK;;',
  '10.11.2025;Moje portfolio;Forex prodej – 2.9.2025 Forward EURCZK;;EZ0000000001;;2.9.2025 Forward EURCZK;;-300,00;EUR;;',
  // podílový fond v CZK: tisíce kusů s pevnou mezerou, za kus jen pár korun
  '14.03.2024;Moje portfolio;Nákup – ABCFOND CP – 1 250,0000 kusů;ABCFOND CP;CZ0000000017;1 250,0000;;1,2000;-1 500,00;CZK;;',
].join('\n');

/** Edge-cases: dopočet ceny z Hodnoty, dividenda bez hrubé výše, převod, rozbitá diakritika v Typ. */
export const PORTU_EDGE_FIXTURE = [
  PORTU_HEADER,
  // Cena chybí → jednotková cena |Hodnota| / kusy = 55 / 0,5 = 110
  '05.05.2026;Moje portfolio;Nákup;VWCE;IE00BK5BQT80;0,5;Vanguard FTSE All-World UCITS ETF;;-55,00;EUR;;',
  // dividenda bez hrubé výše → |Hodnota| jako gross + warning o čisté částce
  '06.05.2026;Moje portfolio;Dividenda;CSPX;IE00B5BMR087;;iShares Core S&P 500 UCITS ETF;;10,00;USD;;',
  // převod peněz mezi vlastními portfolii → skip
  '07.05.2026;Moje portfolio;Převod do Rezerva;;;;;;-20,00;EUR;;',
  // rozbitá/vynechaná diakritika v Typ → mapuje se přes stripDiacritics
  '08.05.2026;Moje portfolio;Nakup;VWCE;IE00BK5BQT80;1,5;Vanguard FTSE All-World UCITS ETF;104,00;-156,00;EUR;;',
].join('\n');

/**
 * Celý export bez diakritiky (rozbité kódování) — hlavička i typy jen ASCII,
 * en dash v Typu nahrazený obyčejným spojovníkem.
 */
export const PORTU_ASCII_FIXTURE = [
  'Datum;Nazev;Typ;Symbol;ISIN;Kusy / Pozice;Popis;Cena;Hodnota;Mena;Srazkova dan;Hruba vyse dividendy',
  '08.05.2026;Moje portfolio;Nakup - VWCE GY - 1,5000 kusu (104,00 EUR za kus);VWCE GY;IE00BK5BQT80;1,5000;;104,0000;-156,00;EUR;;',
  '09.05.2026;Moje portfolio;Vyber na bankovni ucet - penize jsme odeslali 09.05.2026;;;;;;-500,00;CZK;;',
  '10.05.2026;Moje portfolio;Forex nakup - CZK/EUR;;;;CZK/EUR;;20,00;EUR;;',
].join('\n');

/** Chybové řádky: neplatné datum, chybějící kusy, chybějící ISIN, chybějící měna. */
export const PORTU_ERROR_FIXTURE = [
  PORTU_HEADER,
  '31.13.2026;Moje portfolio;Nákup;VWCE;IE00BK5BQT80;1;;103,58;-103,58;EUR;;',
  '15.01.2026;Moje portfolio;Nákup;VWCE;IE00BK5BQT80;;;103,58;-49,96;EUR;;',
  '15.01.2026;Moje portfolio;Nákup;VWCE;;1;;103,58;-103,58;EUR;;',
  '15.01.2026;Moje portfolio;Poplatek;;;;Poplatek za správu;;-1,25;;;',
].join('\n');
