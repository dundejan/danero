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
 *
 * Popisek je na jeden řádek, dokud se vejde do rodiče. Delší (dlouhý překlad,
 * zvětšené písmo, úzký dialog) se zalomí a tlačítko povyroste — nikdy
 * nevyteče z rodiče ani z vlastní kapsle. Výška je proto nejmenší (`min-h`),
 * ne pevná. Zkracování třemi tečkami tu není: tlačítko, které neřekne, co
 * udělá, je horší než dvouřádkové.
 */
export const buttonVariants = cva(
  [
    'pressable inline-flex max-w-full shrink-0 items-center justify-center gap-2 rounded-full',
    'text-center text-balance wrap-anywhere',
    'text-sm font-medium',
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
          'bg-accent/12 text-accent-strong hover:bg-accent/18 active:bg-accent/24 dark:bg-accent/20 dark:hover:bg-accent/28 dark:active:bg-accent/28',
        // Textové tlačítko v řádku nebo v liště. Pod myší a při stisku text
        // ztmavne (`accent-strong`): zvýraznění pod ním ubere kontrast a běžná
        // akcentní barva na ploše `canvas` klesla na 4,46:1 (tmavý režim 4,49).
        ghost:
          'text-accent-text hover:bg-(--highlight) hover:text-accent-strong active:bg-(--highlight-pressed) active:text-accent-strong',
        // Nebezpečná akce je textová, ne vylitá: plnou červenou si nechává až
        // na hover, kdy uživatel opravdu míří na smazání.
        danger:
          'bg-canvas text-danger hover:bg-danger-fill hover:text-white active:bg-danger-fill active:text-white',
      },
      size: {
        md: 'min-h-9 px-4 py-1.5 tracking-[-0.01em] pointer-coarse:min-h-11 pointer-coarse:px-5',
        // Prostrkání podle velikosti: 12px popisek ho nemá, na dotyku (14 px)
        // se vrací to společné.
        sm: 'min-h-7 px-3 py-1 text-xs tracking-normal pointer-coarse:min-h-11 pointer-coarse:px-4 pointer-coarse:text-sm pointer-coarse:tracking-[-0.01em]',
        // Velké tlačítko veřejných stránek (hlavní výzva).
        lg: 'min-h-11 px-6 py-2 text-[0.9375rem] tracking-[-0.01em]',
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
