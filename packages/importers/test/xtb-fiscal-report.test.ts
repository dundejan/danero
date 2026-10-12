import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  sniffXtbFiscalReport,
  XTB_FISCAL_REPORT_MESSAGE,
  xtbFiscalReportResult,
} from '../src/xtb/fiscal-report';
import { sniffXtbXlsx, XTB_BROKER } from '../src/xtb/xlsx';
import {
  buildXtbFiscalReportXlsx,
  buildXtbNewReportXlsx,
  buildXtbXlsx,
  XTB_ROWS_EN,
} from './fixtures/xtb';

async function load(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

describe('roční daňový přehled XTB (Fiscal Report)', () => {
  it('pozná se podle názvu listu a tabulek přehledu', async () => {
    const workbook = await load(await buildXtbFiscalReportXlsx());
    expect(sniffXtbFiscalReport(workbook)).toBe(true);
    // historie účtu to není — její sniffer ho vzít nesmí
    expect(sniffXtbXlsx(workbook)).toBe(false);
  });

  it('pozná se i po přejmenování listu, podle nadpisu', async () => {
    const workbook = await load(await buildXtbFiscalReportXlsx({ sheetName: 'List1' }));
    expect(sniffXtbFiscalReport(workbook)).toBe(true);
  });

  it('pozná se i bez nadpisu, podle názvu listu', async () => {
    const workbook = await load(await buildXtbFiscalReportXlsx({ title: null }));
    expect(sniffXtbFiscalReport(workbook)).toBe(true);
  });

  it('samotný název listu nebo nadpis bez tabulek přehledu nestačí', async () => {
    const workbook = await load(await buildXtbFiscalReportXlsx({ sections: false }));
    expect(sniffXtbFiscalReport(workbook)).toBe(false);
  });

  it('historii účtu (starý i nový report) za přehled nepovažuje', async () => {
    expect(sniffXtbFiscalReport(await load(await buildXtbXlsx({ rows: XTB_ROWS_EN })))).toBe(false);
    expect(sniffXtbFiscalReport(await load(await buildXtbNewReportXlsx()))).toBe(false);
  });

  it('neimportuje nic a řekne, který export nahrát místo něj', () => {
    const result = xtbFiscalReportResult();
    expect(result.broker).toBe(XTB_BROKER);
    expect(result.transactions).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.errors).toHaveLength(1);
    const [error] = result.errors;
    expect(error!.message).toBe(XTB_FISCAL_REPORT_MESSAGE);
    // důvod i náprava: chybí nákupní ceny držených titulů → historie účtu
    expect(error!.message).toContain('nákupní cena');
    expect(error!.message).toContain('Export (new)');
    expect(error!.message).toContain('od založení účtu');
    // náprava je na uživateli — výpis se nemá schovávat jako nepřečtený
    expect(error!.knownUnsupported).toBe(true);
  });
});
