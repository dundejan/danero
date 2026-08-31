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
 */
interface Page {
  path: string;
  lastModified: string;
  changeFrequency: 'weekly' | 'monthly' | 'yearly';
  priority: number;
}

const PAGES: Page[] = [
  { path: '/', lastModified: '2026-08-09', changeFrequency: 'weekly', priority: 1 },
  { path: '/kalkulacka', lastModified: '2026-08-10', changeFrequency: 'monthly', priority: 0.9 },
  { path: '/platformy', lastModified: '2026-07-12', changeFrequency: 'monthly', priority: 0.9 },
  { path: '/pruvodce', lastModified: '2026-07-12', changeFrequency: 'monthly', priority: 0.7 },
  {
    path: '/pruvodce/limit-100-000-kc',
    lastModified: '2026-08-07',
    changeFrequency: 'monthly',
    priority: 0.8,
  },
  {
    path: '/pruvodce/pausalni-rezim-a-investice',
    lastModified: '2026-08-07',
    changeFrequency: 'monthly',
    priority: 0.8,
  },
  { path: '/bezpecnost', lastModified: '2026-08-10', changeFrequency: 'yearly', priority: 0.5 },
  { path: '/cenik', lastModified: '2026-08-09', changeFrequency: 'monthly', priority: 0.9 },
  { path: '/demo/prehled', lastModified: '2026-08-10', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/caste-otazky', lastModified: '2026-08-31', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/jak-pocitame', lastModified: '2026-08-31', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/o-projektu', lastModified: '2026-08-10', changeFrequency: 'yearly', priority: 0.5 },
  { path: '/podminky', lastModified: '2026-08-10', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/soukromi', lastModified: '2026-08-31', changeFrequency: 'yearly', priority: 0.2 },
  // povinné poučení o odstoupení (§ 1820 odst. 1 písm. i OZ) — patří do indexu
  { path: '/odstoupeni', lastModified: '2026-08-09', changeFrequency: 'yearly', priority: 0.2 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(({ path, ...rest }) => ({ url: `${SITE_URL}${path}`, ...rest }));
}
