/**
 * Strukturované logy (G10c): jeden řádek JSON na událost — snadné filtrování
 * ve Vercel/Grafana. Nikdy nelogovat obsah transakcí, klíče ani osobní data;
 * kontext = identifikátory a počty.
 */
type Level = 'info' | 'warn' | 'error';

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
