import { UNIVERSAL_TEMPLATE_CSV } from '@danero/importers';

/** Stažení předvyplněné univerzální šablony (docs/06) — bez přihlášení, žádná data. */
export function GET(): Response {
  return new Response(UNIVERSAL_TEMPLATE_CSV, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="danero-sablona.csv"',
    },
  });
}
