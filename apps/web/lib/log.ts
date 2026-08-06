/**
 * Strukturované logy (G10c): jeden řádek JSON na událost — snadné filtrování
 * ve Vercel/Grafana. Nikdy nelogovat obsah transakcí, klíče ani osobní data;
 * kontext = identifikátory a počty.
 */
type Level = 'info' | 'warn' | 'error';

/**
 * Text chyby bezpečný k zalogování i k zobrazení uživateli.
 *
 * Drizzle dává do `DrizzleQueryError.message` celý dotaz VČETNĚ hodnot
 * parametrů („Failed query: … params: reset-token-abc,…"). Do logu by tak
 * z jednoho selhaného insertu spadly ověřovací a resetovací tokeny, e-mailové
 * adresy i obsah transakcí — přesně to, co má hlavička tohohle souboru zakázané.
 * Parametry proto uřízneme a délku omezíme.
 */
export function errorText(error: unknown, maxLength = 500): string {
  const raw = error instanceof Error ? error.message : String(error);
  const withoutParams = raw.split(/\n\s*params:/)[0]!;
  return withoutParams.length > maxLength
    ? `${withoutParams.slice(0, maxLength)}…`
    : withoutParams;
}

export function logEvent(
  level: Level,
  event: string,
  context: Record<string, string | number | boolean | null | undefined> = {},
): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...context });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}
