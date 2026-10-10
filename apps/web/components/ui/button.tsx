import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Tlačítko. Tvar je kapsle, odezva přichází při stisku (`pressable` zmenší
 * tlačítko v okamžiku dotyku, ne až po uvolnění).
 *
 * Výška: 36 px pro myš, 44 px pro prst (`pointer-coarse`) — cíl dotyku se řídí
 * tím, čím se ovládá, ne šířkou okna (tablet s myší, notebook s dotykem).
 */
export const buttonVariants = cva(
  'pressable inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium tracking-[-0.01em] disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        // Sytá výplň drží plnou barvu i v tmavém režimu (bílý text 4,70:1).
        // Hover ZTMAVUJE (brightness), nezprůhledňuje — průhlednost by pod
        // tlačítkem prosvítala a kontrast textu by spadl pod AA.
        primary: 'bg-accent-fill text-white hover:brightness-95 active:brightness-90',
        // Šedá výplň bez rámečku: tlačítko pozná uživatel podle popisku
        // a tvaru; rámeček navíc by z řady tlačítek dělal mříž.
        secondary: 'bg-control text-ink hover:brightness-95 dark:hover:brightness-125',
        ghost: 'text-accent-text hover:bg-control',
        // Nebezpečná akce je textová, ne vylitá: plnou červenou si nechává až
        // na hover, kdy uživatel opravdu míří na smazání.
        danger: 'bg-canvas text-danger hover:bg-danger-fill hover:text-white',
      },
      size: {
        md: 'h-9 px-4 pointer-coarse:h-11 pointer-coarse:px-5',
        sm: 'h-7 px-3 text-xs pointer-coarse:h-11 pointer-coarse:px-4 pointer-coarse:text-sm',
        // Velké tlačítko veřejných stránek (hlavní výzva).
        lg: 'h-11 px-6 text-[0.9375rem]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
