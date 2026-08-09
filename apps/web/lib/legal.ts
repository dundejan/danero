/**
 * Údaje, které se musí shodovat napříč právními texty a potvrzením objednávky.
 *
 * Verze podmínek se do 7. 8. 2026 psala ručně na `/podminky` i `/soukromi`
 * a potvrzení o uzavření smlouvy (§ 1824a OZ) ji neuvádělo vůbec — kupující
 * tedy nedokázal doložit, které znění pro něj platí (nález E-30).
 *
 * ⚠️ Změna verze je změnou podmínek: podle `/podminky` čl. 10 se oznamuje
 * e-mailem **nejméně 30 dní předem**. Číslo se tu proto nepřepisuje spolu
 * s opravou překlepu, ale až s věcnou změnou závazku.
 */
export const TERMS_VERSION = '2.3';

/** Datum účinnosti aktuálního znění, česky (vypisuje se v patičce právních stránek). */
export const TERMS_EFFECTIVE_FROM = '9. srpna 2026';

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
