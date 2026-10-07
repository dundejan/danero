/**
 * Údaje, které se musí shodovat napříč právními texty.
 *
 * Verze podmínek se do 7. 8. 2026 psala ručně na `/podminky` i `/soukromi`,
 * takže se stránky rozcházely v tom, které znění platí (nález E-30).
 *
 * ⚠️ Změna verze je změnou podmínek: podle `/podminky` čl. 10 se oznamuje
 * e-mailem **nejméně 30 dní předem**. Číslo se tu proto nepřepisuje spolu
 * s opravou překlepu, ale až s věcnou změnou závazku.
 *
 * Verze 3.0 (8. 10. 2026): Danero je celé zdarma, placené tarify a všechno
 * kolem nich (ceny, objednávky, odstoupení, Stripe) z textů zmizelo. Účtům
 * založeným dřív platí po 30 dní vedle ní i znění 2.4 — viz konstanty níž.
 */
export const TERMS_VERSION = '3.0';

/** Datum účinnosti aktuálního znění, česky (vypisuje se v patičce právních stránek). */
export const TERMS_EFFECTIVE_FROM = '8. října 2026';

/**
 * Do kdy platí starším účtům vedle nového znění i to předchozí (30 dní od
 * účinnosti). Po tomhle datu jde přechodný odstavec z `/podminky` vypustit.
 */
export const TERMS_OVERLAP_UNTIL = '7. listopadu 2026';

/**
 * Předchozí znění podmínek (2.4) — poslední s placenými tarify. Je to pevná
 * adresa upstream repozitáře, ne `SOURCE_URL`: odkazuje na konkrétní dokument,
 * kterým se řídila služba na danero.cz, ne na zdroják běžící instance.
 */
export const PREVIOUS_TERMS_URL =
  'https://github.com/dundejan/danero/blob/placene-tarify/apps/web/app/podminky/page.tsx';

/**
 * Mimosoudní řešení spotřebitelských sporů (§ 14 zákona 634/1992 Sb.).
 * Odkaz na evropskou platformu ODR schválně chybí — byla zrušena k 20. 7. 2025
 * nařízením (EU) 2024/3228 a informační povinnost k ní skončila.
 */
export const ADR = {
  authority: 'Česká obchodní inspekce, Ústřední inspektorát — oddělení ADR',
  address: 'Gorazdova 24, 120 00 Praha 2',
  web: 'coi.gov.cz',
  online: 'adr.coi.cz',
} as const;

/**
 * Kde leží zdrojový kód **téhle běžící instance**.
 *
 * § 13 licence AGPL-3.0 ukládá tomu, kdo software nabízí uživatelům po síti,
 * nabídnout jim i odpovídající zdrojový kód. Pro danero.cz je to upstream
 * repozitář; kdo si Danero provozuje sám a upraví ho, musí sem přes
 * `NEXT_PUBLIC_SOURCE_URL` dát adresu svého forku — jinak licenci porušuje
 * (nález E-45).
 */
export const SOURCE_URL =
  process.env.NEXT_PUBLIC_SOURCE_URL?.trim() || 'https://github.com/dundejan/danero';
