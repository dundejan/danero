import type ExcelJS from 'exceljs';
import { readSheetRows } from '../xlsx';
import { emptyResult, type ImportResult } from '../types';
import { XTB_BROKER } from './xlsx';

/**
 * Roční daňový přehled XTB („Fiscal Report“) — poznáme ho, ale neimportujeme.
 *
 * XTB ho nabízí vedle historie účtu a vypadá jako podklad k přiznání: jeden
 * list (`Fiscal_Report_<rok>`) s nadpisem „Fiscal Report: <rok>/01/01 -
 * <rok>/12/31“ a tabulkami pod sebou — otevřené pozice ke konci roku, souhrny
 * zisku, uzavřené CFD, uzavřené akcie, dividendy, poplatky. První přišel
 * 10/2026 a uživatel k němu četl obecné „XLSX nepoznáváme“.
 *
 * Transakce z něj neskládáme, protože by vyšly špatně a potichu:
 *
 * - **Otevřené pozice nemají nákupní cenu.** Tabulka „List of Open Trades“
 *   nese jen kusy, čas otevření a nerealizovaný zisk. Portfolio by po importu
 *   bylo prázdné a příští prodej těch titulů by neměl nákup.
 * - **Uzavřené obchody jsou jen v měně účtu.** „Purchase value / Sale value in
 *   Account Currency“ přepočetl broker vlastním kurzem; cena v měně titulu
 *   chybí. Import historie účtu přitom ukládá cenu v měně titulu a přepočítává
 *   kurzem z docs/02 — kdo by nahrál obojí, měl by tytéž obchody dvakrát
 *   s jinými čísly (dedupe je obsahový).
 * - **Nákup se v přehledu objeví až v roce, kdy se pozice zavře**, takže
 *   párování starších let by se s každým dalším přehledem zpětně měnilo.
 *
 * Historie účtu z tlačítka „Export (new)“ nese všechno, co přehled, a navíc
 * to, co mu chybí — proto uživatele posíláme pro ni. Náprava je na jeho
 * straně a je známá: chyba je `knownUnsupported`, výpis se neschovává jako
 * nepřečtený a provozovateli kvůli němu nechodí upozornění.
 */

/** Název listu, jak ho XTB pojmenuje: `Fiscal_Report_<rok>`. */
const SHEET_NAME_RE = /^fiscal[ _]report/i;

/** Nadpis přehledu: „Fiscal Report: <rok>/01/01 - <rok>/12/31“. */
const TITLE_RE = /^fiscal report\s*:/i;

/** Nadpisy tabulek přehledu; ke shodě stačí jediný. */
const SECTION_TITLES = [
  'list of open trades',
  'list of stock transactions',
  'list of cfd transactions',
  'profit loss summary',
  'list of dividends and other cash operations',
];

/** Nadpis leží v prvních řádcích listu; hlouběji už jsou jen tabulky. */
const TITLE_SEARCH_ROWS = 15;

/**
 * Je to roční daňový přehled XTB?
 *
 * Název listu sám nestačí (uživatel ho může přejmenovat, jiná jazyková verze
 * ho může mít jinak) a nadpis sám taky ne — „Fiscal Report“ si může nazvat
 * kdokoli. Pozná se proto podle nadpisu NEBO názvu listu a k tomu aspoň jedné
 * tabulky, kterou má jen tenhle dokument.
 */
export function sniffXtbFiscalReport(workbook: ExcelJS.Workbook): boolean {
  return workbook.worksheets.some((sheet) => {
    const rows = readSheetRows(sheet);
    const titled =
      SHEET_NAME_RE.test(sheet.name.trim()) ||
      rows.slice(0, TITLE_SEARCH_ROWS).some((row) => row.cells.some((cell) => TITLE_RE.test(cell)));
    if (!titled) return false;
    return rows.some((row) =>
      row.cells.some((cell) => {
        const text = cell.trim().toLowerCase();
        return text !== '' && SECTION_TITLES.some((title) => text.startsWith(title));
      }),
    );
  });
}

export const XTB_FISCAL_REPORT_MESSAGE =
  'Tohle je roční daňový přehled XTB (Fiscal Report), ne historie účtu. Shrnuje jen obchody ' +
  'uzavřené v daném roce a u titulů, které držíš dál, v něm chybí nákupní cena — portfolio ' +
  'z něj sestavit nejde. Nahraj místo něj historii účtu: xStation → Historie → tlačítko ' +
  '„Export (new)“ → Nový report, období od založení účtu. Přijde ZIP; rozbal ho a nahraj ' +
  'XLSX zevnitř.';

/** Výsledek importu pro daňový přehled: žádná transakce, jedna hláška s návodem. */
export function xtbFiscalReportResult(): ImportResult {
  return {
    ...emptyResult(XTB_BROKER),
    errors: [{ line: 1, message: XTB_FISCAL_REPORT_MESSAGE, knownUnsupported: true }],
  };
}
