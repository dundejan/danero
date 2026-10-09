import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

/**
 * Veřejné stránky — aplikace za přihlášením do sitemapy nepatří.
 *
 * `lastModified` se drží **ručně** (K8-09: dosud ho neměla ani jedna adresa).
 * Automaticky ho vzít není z čeho: na Vercelu se repozitář čerstvě naklonuje,
 * takže všechny soubory mají čas checkoutu, a datum buildu by tvrdilo, že se
 * při každém nasazení změnilo úplně všechno. Proto platí jediné pravidlo:
 * **měníš obsah stránky → přepiš tady datum.** Staré a pravdivé je lepší než
 * dnešní a smyšlené — nepřesný `lastmod` vyhledávače prostě přestanou brát.
 *
 * Obsah stránky není jen její `page.tsx` (L1-11): /platformy tu měly 12. 7. 2026,
 * přestože se návody v `lib/brokers-catalog.ts` a věty v
 * `components/platform-catalog.tsx` od té doby měnily několikrát — datum se
 * odvodilo od souboru stránky a minulo zdroj, ze kterého stránka text bere.
 * Stejně tak /demo/* (společný `layout.tsx`) a právní stránky (`lib/legal.ts`).
 * Poslední doloženou změnu drží i `test/seo-metadata.test.ts`.
 */
interface Page {
  path: string;
  lastModified: string;
  changeFrequency: 'weekly' | 'monthly' | 'yearly';
  priority: number;
}

const PAGES: Page[] = [
  { path: '/', lastModified: '2026-10-08', changeFrequency: 'weekly', priority: 1 },
  { path: '/kalkulacka', lastModified: '2026-10-09', changeFrequency: 'monthly', priority: 0.9 },
  { path: '/platformy', lastModified: '2026-10-08', changeFrequency: 'monthly', priority: 0.9 },
  { path: '/pruvodce', lastModified: '2026-07-12', changeFrequency: 'monthly', priority: 0.7 },
  {
    path: '/pruvodce/limit-100-000-kc',
    lastModified: '2026-10-09',
    changeFrequency: 'monthly',
    priority: 0.8,
  },
  {
    path: '/pruvodce/pausalni-rezim-a-investice',
    lastModified: '2026-08-07',
    changeFrequency: 'monthly',
    priority: 0.8,
  },
  { path: '/bezpecnost', lastModified: '2026-10-09', changeFrequency: 'yearly', priority: 0.5 },
  { path: '/cenik', lastModified: '2026-10-08', changeFrequency: 'monthly', priority: 0.9 },
  { path: '/demo/prehled', lastModified: '2026-10-08', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/caste-otazky', lastModified: '2026-10-09', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/jak-pocitame', lastModified: '2026-10-09', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/o-projektu', lastModified: '2026-10-08', changeFrequency: 'yearly', priority: 0.5 },
  { path: '/podminky', lastModified: '2026-10-09', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/soukromi', lastModified: '2026-10-09', changeFrequency: 'yearly', priority: 0.2 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(({ path, ...rest }) => ({ url: `${SITE_URL}${path}`, ...rest }));
}
