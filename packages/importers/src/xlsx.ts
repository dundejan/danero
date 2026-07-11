import ExcelJS from 'exceljs';

/**
 * Jedno načtení XLSX pro všechny sniffy. Parsery si soubor načítají znovu
 * samy (dvojí load je vědomá cena za jednoduché signatury — soubory mají
 * limit 20 MB a upload je vzácná operace; kdyby to někdy bolelo, řešením je
 * `parse*Workbook(workbook)` varianta parserů, ne cache tady).
 */
export async function loadXlsxWorkbook(data: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);
  return workbook;
}
