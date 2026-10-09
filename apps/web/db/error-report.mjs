/**
 * Co z chyby migrace smí do logu (L9-08).
 *
 * Log workflow v GitHub Actions čte každý přihlášený — repozitář je veřejný
 * a log v něm leží 90 dní. Postgres přitom do chyby skládá hodnoty z řádků:
 * `detail` u porušené unikátnosti nese klíč („Key (email)=(…) is duplicated."),
 * u porušeného NOT NULL celý řádek i s JSON payloadem, `where` kontext
 * PL/pgSQL a u chyb třídy 22 je hodnota přímo v hlášce („invalid input syntax
 * for type integer: …"). `stack` hlášku opakuje na prvním řádku.
 *
 * Ve veřejném režimu se proto tiskne jen to, co je na SEZNAMU POVOLENÉHO —
 * ne „všechno kromě zakázaného": pole, které driver přidá příště, se do logu
 * nedostane samo. Mimo Actions zůstává výpis celý (M-4), tam ho čte jen ten,
 * kdo skript pustil.
 *
 * Čistý modul bez I/O, aby šel testovat (`test/migrate-log.test.ts`).
 */

/**
 * Pole, která hodnotu z řádku nést nemůžou: kód, názvy objektů ze schématu,
 * pozice a text dotazu — ten je u migrace statické SQL z veřejného repozitáře
 * (parametry dotazu se netisknou v žádném režimu).
 */
const PUBLIC_FIELDS = [
  'code',
  'severity',
  'position',
  'schema_name',
  'table_name',
  'column_name',
  'constraint_name',
  'routine',
  'query',
];

/** Všechno, co postgres.js na chybě nese — pro ruční spuštění. */
const ALL_FIELDS = [
  'code',
  'severity',
  'detail',
  'hint',
  'position',
  'where',
  'schema_name',
  'table_name',
  'column_name',
  'constraint_name',
  'routine',
  'query',
];

/** Věta, kterou veřejný výpis uvádí — ať je z logu poznat, že není celý, a kde celý vzít. */
export const PUBLIC_LOG_NOTICE =
  'Výpis je zkrácený: log GitHub Actions je veřejný a hláška, detail, hint i kontext chyby ' +
  'můžou nést hodnoty z řádků. Celou chybu ukáže stejná migrace puštěná mimo GitHub Actions.';

/**
 * Běží skript v GitHub Actions? Runner tam nastavuje `GITHUB_ACTIONS=true` sám.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function isPublicLog(env = process.env) {
  return env.GITHUB_ACTIONS === 'true';
}

/** Název třídy chyby — jen když jako název třídy vypadá, jinak obecné „Error". */
function className(error) {
  const name = error?.name;
  return typeof name === 'string' && /^[A-Za-z_$][\w$]{0,63}$/.test(name) ? name : 'Error';
}

/**
 * Řádky výpisu chyby včetně řetězu příčin (drizzle chybu obaluje — SQLSTATE
 * bývá až v příčině).
 *
 * @param {unknown} error
 * @param {{ publicLog: boolean }} options
 * @param {number} [depth]
 * @returns {string[]}
 */
export function formatMigrationError(error, { publicLog }, depth = 0) {
  const prefix = ' '.repeat(depth * 2);
  const source = /** @type {Record<string, unknown> | null | undefined} */ (error);
  const lines = [
    publicLog
      ? `${prefix}${className(source)}`
      : `${prefix}${source?.name ?? 'Error'}: ${source?.message ?? String(error)}`,
  ];
  for (const field of publicLog ? PUBLIC_FIELDS : ALL_FIELDS) {
    if (source?.[field] !== undefined && source[field] !== null) {
      lines.push(`${prefix}  ${field}: ${source[field]}`);
    }
  }
  if (!publicLog && source?.stack) lines.push(`${prefix}  stack: ${source.stack}`);
  if (source?.cause) lines.push(...formatMigrationError(source.cause, { publicLog }, depth + 1));
  return lines;
}
