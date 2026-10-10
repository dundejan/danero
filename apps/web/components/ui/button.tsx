import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Tlačítko. Tvar je kapsle, odezva přichází při stisku (`pressable` zmenší
 * tlačítko v okamžiku dotyku, ne až po uvolnění).
 *
 * Výška: 36 px pro myš, 44 px pro prst (`pointer-coarse`) — cíl dotyku se řídí
 * tím, čím se ovládá, ne šířkou okna (tablet s myší, notebook s dotykem).
 *
 * Na stránce je nejvýš JEDNO `primary`. Odkaz, který má vypadat jako
 * tlačítko, si bere třídy přes `buttonVariants` (`<Link className={…}>`).
 */
export const buttonVariants = cva(
  [
    'pressable inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full',
    'text-sm font-medium tracking-[-0.01em]',
    // Zakázané tlačítko: bez odezvy a čitelné — plošná průhlednost 40 % by
    // srazila kontrast popisku pod 3:1.
    'disabled:pointer-events-none disabled:bg-control disabled:text-ink-muted',
    'aria-disabled:pointer-events-none aria-disabled:bg-control aria-disabled:text-ink-muted',
  ],
  {
    variants: {
      variant: {
        // Sytá výplň drží plnou barvu i v tmavém režimu (bílý text 4,70:1).
        // Hover ZTMAVUJE (brightness), nezprůhledňuje — průhlednost by pod
        // tlačítkem prosvítala a kontrast textu by spadl pod AA.
        primary: 'bg-accent-fill text-white hover:brightness-95 active:brightness-90',
        // Šedá výplň bez rámečku: tlačítko pozná uživatel podle popisku
        // a tvaru; rámeček navíc by z řady tlačítek dělal mříž.
        secondary:
          'bg-control text-ink hover:brightness-95 active:brightness-90 dark:hover:brightness-125 dark:active:brightness-150',
        // Druhá nejdůležitější akce vedle `primary` (akcentní text na tónu).
        tinted:
          'bg-accent/12 text-accent-text hover:bg-accent/18 active:bg-accent/24 dark:bg-accent/20 dark:hover:bg-accent/28',
        // Textové tlačítko v řádku nebo v liště.
        ghost: 'text-accent-text hover:bg-(--highlight) active:bg-(--highlight-pressed)',
        // Nebezpečná akce je textová, ne vylitá: plnou červenou si nechává až
        // na hover, kdy uživatel opravdu míří na smazání.
        danger:
          'bg-canvas text-danger hover:bg-danger-fill hover:text-white active:bg-danger-fill active:text-white',
      },
      size: {
        md: 'h-9 px-4 pointer-coarse:h-11 pointer-coarse:px-5',
        sm: 'h-7 px-3 text-xs pointer-coarse:h-11 pointer-coarse:px-4 pointer-coarse:text-sm',
        // Velké tlačítko veřejných stránek (hlavní výzva).
        lg: 'h-11 px-6 text-[0.9375rem]',
        // Čtvercové tlačítko s ikonou (křížek, šipka); název nese `aria-label`.
        icon: 'size-9 pointer-coarse:size-11',
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
