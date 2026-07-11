import type { MetadataRoute } from 'next';

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://danero.cz';

/** Aplikace za přihlášením a API nemají v indexu co dělat. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/prehled', '/portfolio', '/report', '/simulator', '/import', '/nastaveni', '/vitejte'],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
