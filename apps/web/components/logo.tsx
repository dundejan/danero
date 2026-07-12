import { cn } from '@/lib/utils';

/**
 * Značka Danero — malé „d“ složené ze signatury produktu (horizont osvobození):
 * růžová tečka = nákup (lot), svislá linie = dnešek. Tečka už je nalevo od
 * linie, tedy za časovým testem — přesně ten moment, kvůli kterému Danero
 * existuje. Jednobarevně (mono) se silueta slije do čistého „d“.
 *
 * Geometrie drží čitelnost od 16 px: dva plné tvary, žádné tenké tahy,
 * gradienty ani stíny. Stejné tvary používá i favicon (app/icon.svg).
 */
export function LogoMark({
  className,
  mono = false,
}: {
  className?: string;
  /** Jednobarevná varianta (tečka i linie currentColor) — pro tisk a akcentní plochy. */
  mono?: boolean;
}) {
  return (
    <svg viewBox="0 0 24 24" className={cn('h-6 w-6 shrink-0', className)} aria-hidden="true">
      {/* tečka (lot) — kreslí se první, linie překryje drobný přesah v místě dotyku */}
      <circle cx="10.6" cy="15.4" r="5.6" fill={mono ? 'currentColor' : 'var(--ruzova)'} />
      {/* linie dneška */}
      <rect x="15.8" y="3" width="3.2" height="18" rx="1.6" fill="currentColor" />
    </svg>
  );
}

/**
 * Logotyp: mark + wordmark „Danero“. Velikost se řídí velikostí písma
 * rodiče/className (mark je v em), takže `<Logo className="text-lg" />` stačí.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-[0.4em]', className)}>
      <LogoMark className="h-[1.25em] w-[1.25em]" />
      <span className="font-display font-bold leading-none tracking-tight">Danero</span>
    </span>
  );
}
