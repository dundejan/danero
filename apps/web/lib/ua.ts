/**
 * Lidský popis zařízení z User-Agent stringu (seznam přihlášení v Nastavení).
 * Záměrně jednoduché regexy — nejde o analytiku, jen o čitelnost pro uživatele.
 */
export function humanizeUserAgent(ua: string | null | undefined): string {
  if (!ua || ua.trim() === '') return 'neznámé zařízení';
  if (ua.startsWith('curl/')) return 'API klient (curl)';

  // OS — Android dřív než Linux (Android UA obsahuje „Linux“), iOS dřív než macOS
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iPod/.test(ua)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux|X11/.test(ua)
            ? 'Linux'
            : null;

  // prohlížeč — pořadí je klíčové (Edge obsahuje „Chrome“, Chrome „Safari“)
  const browser = matchBrowser(ua, /Edg(?:e|A|iOS)?\/(\d+)/, 'Edge')
    ?? matchBrowser(ua, /Firefox\/(\d+)/, 'Firefox')
    ?? matchBrowser(ua, /Chrome\/(\d+)/, 'Chrome')
    ?? matchBrowser(ua, /Version\/(\d+)[.\d]* .*Safari/, 'Safari')
    ?? (/Safari/.test(ua) ? 'Safari' : null);

  if (browser && os) return `${browser} · ${os}`;
  if (browser) return browser;
  if (os) return os;
  return ua.slice(0, 40);
}

function matchBrowser(ua: string, pattern: RegExp, label: string): string | null {
  const match = ua.match(pattern);
  return match ? `${label} ${match[1]}` : null;
}
