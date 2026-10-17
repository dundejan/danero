/**
 * Články s datem: dva články průvodce a metodika. Odtud bere datum viditelná
 * řádka „Aktualizováno …“ pod titulkem, `Article` v JSON-LD i `lastModified`
 * v sitemapě — jeden zdroj, ať se nerozejdou (SEO audit, K5).
 *
 * Data se drží **ručně**, ze stejného důvodu jako v `app/sitemap.ts`: na
 * Vercelu má každý soubor čas checkoutu a datum buildu by tvrdilo, že se
 * článek měnil při každém nasazení. Platí tedy totéž pravidlo:
 * **měníš text článku → přepiš `modified`.** Odkaz přidaný do už existující
 * věty text nemění; nová věta, oprava čísla nebo pravidla ano.
 *
 * - `published`: commit, který článek založil (33426f2, 12. 7. 2026) —
 *   dohledatelné přes `git log --diff-filter=A`.
 * - `modified`: poslední doložená změna textu, táž jako v tabulce
 *   `lastContentChange` v `test/seo-metadata.test.ts`.
 * - `headline`: titulek stránky (H1) — stránka ho bere odsud, takže se
 *   strukturovaná data nemůžou rozejít s tím, co čtenář vidí.
 */
export interface ArticleInfo {
  headline: string;
  published: string;
  modified: string;
}

export const ARTICLES = {
  '/pruvodce/limit-100-000-kc': {
    headline: 'Limit 100 000 Kč: počítá se objem prodejů, ne zisk',
    published: '2026-07-12',
    modified: '2026-10-10',
  },
  '/pruvodce/pausalni-rezim-a-investice': {
    headline: 'OSVČ v paušálu: jak ti investice můžou vrátit přiznání',
    published: '2026-07-12',
    modified: '2026-10-10',
  },
  '/jak-pocitame': {
    headline: 'Každé pravidlo má svůj paragraf',
    published: '2026-07-12',
    modified: '2026-10-10',
  },
} as const satisfies Record<string, ArticleInfo>;

export type ArticlePath = keyof typeof ARTICLES;
