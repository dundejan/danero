/**
 * Výhrada v patičce skořápky: Danero počítá, neradí. Patří mezi výhrady, které
 * z obrazovky zmizet nesmí (docs/07, Textová dieta) — ale stačí jí pár slov.
 * Závazné znění je v podmínkách užití (čl. 1); patička na ně jen krátce
 * odkazuje, stejně v aplikaci, v demu i na veřejných stránkách.
 *
 * Jedna konstanta pro obě skořápky, ať se znění ani cíl nerozejdou.
 */
export const NOT_TAX_ADVICE = { href: '/podminky', label: 'Není daňové poradenství' } as const;
