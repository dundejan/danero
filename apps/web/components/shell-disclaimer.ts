/**
 * Výhrada v patičce skořápky: Danero počítá, neradí. Patří mezi výhrady, které
 * z obrazovky zmizet nesmí (docs/07, Textová dieta) — ale stačí jí pár slov.
 * Závazné znění je v podmínkách užití, v článku 1 („Co Danero je (a co
 * není)“); patička na něj jen krátce odkazuje, stejně v aplikaci, v demu i na
 * veřejných stránkách.
 *
 * Jedna konstanta pro všechny tři patičky, ať se znění ani cíl nerozejdou.
 */
export const NOT_TAX_ADVICE = {
  href: '/podminky#co-danero-je',
  label: 'Není daňové poradenství',
} as const;
