import type ExcelJS from 'exceljs';
import { normalizeHeader } from './csv';
import { readSheetRows } from './xlsx';

/**
 * Přehled aktuálních pozic (stav účtu) — poznáme ho, ale neimportujeme.
 *
 * Portály bank a investičních společností ho nabízejí vedle historie pokynů:
 * jeden list, řádek za každý držený fond a za hotovost, sloupce
 * `Investiční nástroj | ISIN | Počet | Cena | Měna | Směnný kurz | Tržní
 * hodnota | Měna`. První přišel 20. 11. 2026 a uživatel k němu četl obecné
 * „XLSX nepoznáváme“.
 *
 * Transakce z něj složit nejde: `Cena` je DNEŠNÍ tržní cena, ne nákupní,
 * a chybí datum nabytí. Nákup vymyšlený z dnešní ceny a dnešního data by dal
 * nulový zisk z čehokoli a časový test od nuly — potichu a špatně.
 *
 * Náprava je na uživateli a je známá (nahrát přehled transakcí), takže chyba
 * je `knownUnsupported`: výpis se neschovává jako nepřečtený a provozovateli
 * kvůli němu nechodí upozornění.
 */

/** Sloupce, které dohromady má jen přehled pozic. */
const POSITION_COLUMNS = ['investicni nastroj', 'isin', 'pocet', 'cena', 'trzni hodnota'] as const;

/** Všechno, co hlavička přehledu smí nést. */
const KNOWN_COLUMNS = new Set<string>([...POSITION_COLUMNS, 'mena', 'smenny kurz']);

/**
 * Je to přehled pozic? Každý neprázdný list má v prvním řádku všechny sloupce
 * přehledu a NIC jiného.
 *
 * Bílý seznam, ne hledání slov jako „datum“: sloupec navíc („Nakoupeno dne“,
 * „Nákupní cena“, „Valuta“) může být přesně to, co hláška prohlašuje za
 * chybějící, a sešit s dalším listem může nést historii. Takový soubor sem
 * nepatří — propadne jako nepoznaný formát a schová se k rozboru.
 */
export function sniffPositionsStatementXlsx(workbook: ExcelJS.Workbook): boolean {
  const sheets = workbook.worksheets.map((sheet) => readSheetRows(sheet)).filter((rows) => rows.length > 0);
  if (sheets.length === 0) return false;
  return sheets.every((rows) => {
    const header = rows[0]!.cells.map(normalizeHeader).filter((column) => column !== '');
    return (
      POSITION_COLUMNS.every((column) => header.includes(column)) &&
      header.every((column) => KNOWN_COLUMNS.has(column))
    );
  });
}

export const POSITIONS_STATEMENT_MESSAGE =
  'Tohle je přehled toho, co právě držíš, ne historie obchodů: u každého fondu je dnešní cena ' +
  'a tržní hodnota, ale chybí, kdy a za kolik jsi ho koupil — a bez toho daň spočítat nejde. ' +
  'Stáhni z téže platformy přehled transakcí (pokynů) za celé období od založení účtu a nahraj ' +
  'ten. V nápovědě „Kde výpis stáhnout“ najdeš cestu u své platformy; když ji tam nemáš, ' +
  'nahraj přehled transakcí stejně a podíváme se na něj.';
