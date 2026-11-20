/**
 * Export pokynů z portálu EIC. Drží jen ROZLOŽENÍ skutečného exportu
 * (nepřečtený výpis z 20. 11. 2026): hlavičku se zdvojeným sloupcem „Druh
 * pokynu“, texty v uvozovkách, čísla s desetinnou tečkou bez uvozovek, prázdné
 * datum vypořádání u nákupu a konverzi koruny před každým nákupem. Fondy,
 * částky, kusy, data, účet, poradce i čísla pokynů jsou smyšlené.
 *
 * Skutečný soubor je ve windows-1250 — testy, kterým na kódování záleží, si
 * text převedou přes `encodeCp1250` z fixtur Fia.
 */
export const EIC_HEADER =
  'Objednávka;Druh pokynu;Fond;Počet;Cena;Objem;Měna;Účet;Obchodní den;Datum vysp.;Stav;Poradce;Síť;Poplatek za výpis poštou;Poplatek za vykonání;Poplatek za vyspořádání;Poplatek za konverzi;Vstupní poplatek;Výstupný poplatek ;Druh pokynu;Share Isin;ID';

/** Nákup fondu: datum vypořádání prázdné, poplatek za vykonání nad objem. */
const buy = (
  fund: string,
  isin: string,
  quantity: string,
  price: string,
  volume: string,
  currency: string,
  date: string,
  fee: string,
  id: string,
): string =>
  `"Savings-Buy ${fund} / ${currency}";"Koupě";"${fund}";${quantity};${price};${volume};"${currency}";"1234567801";${date};;"Zaúčtovaný";"Novák Jan ";"poradci";;${fee};;;0.0;;"Koupě";"${isin}";${id}`;

/** Konverze koruny do měny fondu: směr „Prodej“, druh „Konverze“, bez ISIN. */
const conversion = (czk: string, amount: string, currency: string, date: string, id: string): string =>
  `"Savings-Fx CZK / ${currency}";"Prodej";"CZK";${czk};0.04;${amount};"${currency}";"1234567801";${date};${date};"Vyspořádané";"Novák Jan ";"poradci";;;;;;;"Konverze";;${id}`;

export const EIC_FIXTURE = [
  EIC_HEADER,
  buy('VANFTAW', 'IE00BK5BQT80', '1.257', '119.7295', '150.5', 'EUR', '17.03.2025', '0.42', '5000000104'),
  buy('ISHCEMU', 'IE00BKM4GZ66', '2.513', '31.8344', '80.0', 'USD', '17.03.2025', '0.36', '5000000103'),
  conversion('3770.75', '150.92', 'EUR', '17.03.2025', '5000000102'),
  conversion('1843.91', '80.36', 'USD', '17.03.2025', '5000000101'),
  buy('VANFTAW', 'IE00BK5BQT80', '0.802', '118.4539', '95.0', 'EUR', '03.03.2025', '0.38', '5000000002'),
  conversion('2380.25', '95.38', 'EUR', '03.03.2025', '5000000001'),
  '',
].join('\n');
