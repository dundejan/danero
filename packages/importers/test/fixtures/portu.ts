/**
 * Sdílené Portu fixtures — hlavička DOSLOVA dle vzorku z fóra Portfolio
 * Performance (vč. obou forex řádků). Hodnoty Typ mimo Forex jsou odvozené
 * z UI filtrů Portu (Vklady/Výběry/Nákupy/Prodeje/Převody/Poplatky/Forex/
 * Ostatní) — středníkové CSV, datum dd.MM.yyyy, desetinná čárka, záporná
 * Hodnota = odchozí peníze, Název = jméno portfolia (ne instrumentu).
 */

export const PORTU_HEADER =
  'Datum;Název;Typ;Symbol;ISIN;Kusy / Pozice;Popis;Cena;Hodnota;Měna;Srážková daň;Hrubá výše dividendy';

export const PORTU_FIXTURE = [
  PORTU_HEADER,
  // nákup ETF s frakčními kusy: 0,4823 × 103,58 ≈ 49,96 (Hodnota záporná = odchozí)
  '15.01.2026;Moje portfolio;Nákup;VWCE;IE00BK5BQT80;0,4823;Vanguard FTSE All-World UCITS ETF;103,58;-49,96;EUR;;',
  // prodej: Hodnota kladná = příjem, kusy kladné
  '20.02.2026;Moje portfolio;Prodej;VWCE;IE00BK5BQT80;0,25;Vanguard FTSE All-World UCITS ETF;110,00;27,50;EUR;;',
  // dividenda se srážkou: Hodnota = čistá částka, hrubá výše a srážka ve vlastních sloupcích
  '10.03.2026;Moje portfolio;Dividenda;CSPX;IE00B5BMR087;;iShares Core S&P 500 UCITS ETF;;12,35;USD;2,18;14,53',
  // poplatek za správu
  '31.03.2026;Moje portfolio;Poplatek;;;;Poplatek za správu portfolia;;-1,25;EUR;;',
  // vklad peněz — bez daňové události
  '12.02.2026;Moje portfolio;Vklad;;;;Vklad prostředků;;3500,00;CZK;;',
  // forex pár — DOSLOVNÉ vzorky z výzkumu (měnový pár v Popisu, Název = portfolio)
  '12.02.2026;Portfolio;Forex nákup;;;;EUR/USD;;138,14;USD;;',
  '12.02.2026;Portfolio;Forex prodej;;;;USD/EUR;;-116,37;EUR;;',
  // neznámý typ → error s doslovným zněním (slovník mimo Forex je odvozený)
  '05.04.2026;Moje portfolio;Odměna;;;;Bonus za doporučení;;100,00;CZK;;',
].join('\n');

/** Edge-cases: dopočet ceny z Hodnoty, dividenda bez hrubé výše, převod, rozbitá diakritika v Typ. */
export const PORTU_EDGE_FIXTURE = [
  PORTU_HEADER,
  // Cena chybí → jednotková cena |Hodnota| / kusy = 55 / 0,5 = 110
  '05.05.2026;Moje portfolio;Nákup;VWCE;IE00BK5BQT80;0,5;Vanguard FTSE All-World UCITS ETF;;-55,00;EUR;;',
  // dividenda bez hrubé výše → |Hodnota| jako gross + warning o čisté částce
  '06.05.2026;Moje portfolio;Dividenda;CSPX;IE00B5BMR087;;iShares Core S&P 500 UCITS ETF;;10,00;USD;;',
  // převod mezi portfolii → warning + skip
  '07.05.2026;Moje portfolio;Převod;VWCE;IE00BK5BQT80;1;Převod do portfolia Rezerva;;;EUR;;',
  // rozbitá/vynechaná diakritika v Typ → mapuje se přes stripDiacritics
  '08.05.2026;Moje portfolio;Nakup;VWCE;IE00BK5BQT80;1,5;Vanguard FTSE All-World UCITS ETF;104,00;-156,00;EUR;;',
].join('\n');

/** Celý export bez diakritiky (rozbité kódování) — hlavička i typy jen ASCII. */
export const PORTU_ASCII_FIXTURE = [
  'Datum;Nazev;Typ;Symbol;ISIN;Kusy / Pozice;Popis;Cena;Hodnota;Mena;Srazkova dan;Hruba vyse dividendy',
  '08.05.2026;Moje portfolio;Nakup;VWCE;IE00BK5BQT80;1,5;Vanguard FTSE All-World UCITS ETF;104,00;-156,00;EUR;;',
  '09.05.2026;Moje portfolio;Vyber;;;;Vyber prostredku;;-500,00;CZK;;',
  '10.05.2026;Moje portfolio;Forex nakup;;;;CZK/EUR;;20,00;EUR;;',
].join('\n');

/** Chybové řádky: neplatné datum, chybějící kusy, chybějící ISIN, chybějící měna. */
export const PORTU_ERROR_FIXTURE = [
  PORTU_HEADER,
  '31.13.2026;Moje portfolio;Nákup;VWCE;IE00BK5BQT80;1;;103,58;-103,58;EUR;;',
  '15.01.2026;Moje portfolio;Nákup;VWCE;IE00BK5BQT80;;;103,58;-49,96;EUR;;',
  '15.01.2026;Moje portfolio;Nákup;VWCE;;1;;103,58;-103,58;EUR;;',
  '15.01.2026;Moje portfolio;Poplatek;;;;Poplatek za správu;;-1,25;;;',
].join('\n');
