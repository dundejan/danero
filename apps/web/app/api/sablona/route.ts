import { UNIVERSAL_TEMPLATE_EXCEL_CSV } from '@danero/importers';

/**
 * Stažení předvyplněné univerzální šablony (docs/06) — bez přihlášení, žádná data.
 *
 * Posílá se tvar pro český Excel (BOM, středník, desetinná čárka): čárkové CSV
 * bez BOM se po dvojkliku nasypalo celé do sloupce A s rozbitou diakritikou
 * (L2c-02). Import čte oba tvary stejně.
 */
export function GET(): Response {
  return new Response(UNIVERSAL_TEMPLATE_EXCEL_CSV, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="danero-sablona.csv"',
    },
  });
}
