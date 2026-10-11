import { Notice } from '@/components/ui/notice';

/**
 * Co vidí člověk s vypnutým JavaScriptem na stránce aplikace nebo dema.
 *
 * Obsah těch stránek se posílá po částech a na místo ho skládá skript; bez
 * něj zůstane ve skrytém bloku a na obrazovce jen kostra načítání, která se
 * nikdy nedočká (změřeno 11. 10. 2026 na všech stránkách aplikace i dema).
 * Aplikace bez JavaScriptu fungovat nemůže a nepředstírá to: místo kostry
 * ukáže jednu větu, co se děje a co s tím.
 *
 * Styl uvnitř `<noscript>` schová kostru (`data-app-skeleton`) — platí jen
 * tam, kde skripty neběží, takže běžné načítání neovlivní.
 */
export function NoScriptNotice() {
  return (
    <noscript>
      <style>{'[data-app-skeleton]{display:none}'}</style>
      <Notice tone="caution" title="Danero potřebuje zapnutý JavaScript.">
        Zapni ho v nastavení prohlížeče a načti stránku znovu.
      </Notice>
    </noscript>
  );
}
