import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

/**
 * Aplikace za přihlášením a API nemají v indexu co dělat.
 *
 * `/overeni-emailu` vrací anonymovi 200 (K8-09), takže je to jediná stránka
 * z `app/(auth)`, kterou robot skutečně načte — a v adrese nese ověřovací
 * token. Ostatní chráněné cesty anonyma přesměrují.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/prehled',
          '/portfolio',
          '/report',
          '/simulator',
          '/import',
          '/nastaveni',
          '/vitejte',
          '/overeni-emailu',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
