import type { MetadataRoute } from 'next';

/** Základ URL: produkce z env, jinak výchozí doména (dev hodnota nevadí — sitemap čtou roboti až na produkci). */
const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://danero.cz';

/** Veřejné stránky — aplikace za přihlášením do sitemap nepatří. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${BASE}/kalkulacka`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${BASE}/casovy-test`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/pausalmetr`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/platformy`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${BASE}/pruvodce`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/pruvodce/trading-212-dane`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/pruvodce/xtb-dane`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/pruvodce/limit-100-000-kc`, changeFrequency: 'monthly', priority: 0.8 },
    {
      url: `${BASE}/pruvodce/pausalni-rezim-a-investice`,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    { url: `${BASE}/bezpecnost`, changeFrequency: 'yearly', priority: 0.5 },
    { url: `${BASE}/cenik`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${BASE}/demo/prehled`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE}/caste-otazky`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/jak-pocitame`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/o-projektu`, changeFrequency: 'yearly', priority: 0.5 },
    { url: `${BASE}/podminky`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE}/soukromi`, changeFrequency: 'yearly', priority: 0.2 },
  ];
}
