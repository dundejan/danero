/**
 * Otevře pro tisk rozbalení, která jsou zavřená, a vrátí funkci, která je po
 * tisku zase zavře. Co měl uživatel otevřené sám, otevřené zůstane.
 *
 * Čistá funkce nad čímkoli, co má `open` — kvůli testu; s dokumentem ji
 * spojuje `OpenDetailsForPrint` v `components/print-button.tsx`.
 */
export function openForPrint(details: Iterable<{ open: boolean }>): () => void {
  const openedHere = [...details].filter((item) => !item.open);
  for (const item of openedHere) item.open = true;
  return () => {
    for (const item of openedHere) item.open = false;
  };
}
