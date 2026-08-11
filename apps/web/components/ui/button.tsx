import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // syté výplně: v dark módu drží plnou barvu (světlé --ruzova/--cervena
        // jsou tam pro text — bílá by na nich neměla kontrast).
        // Hover ZTMAVUJE (brightness), nezprůhledňuje: `opacity-90` prosvítá
        // plochu pod tlačítkem a bílý text na růžové spadne ze 4,62:1 na
        // 3,58:1 — pod AA. S brightness-95 drží 5,05:1 a efekt zůstává.
        primary: 'bg-ruzova-syta text-white hover:brightness-95',
        // hranice sekundárního tlačítka je jediné, co ho odlišuje od plochy pod
        // ním — proto --linka-ovladaci (≥ 3:1, WCAG 1.4.11), ne vlásová --linka
        secondary:
          'border border-linka-ovladaci bg-plocha text-inkoust hover:border-inkoust-tlumeny',
        ghost: 'text-inkoust-tlumeny hover:text-inkoust',
        /*
         * Nebezpečná akce je obtažená, ne vylitá. Sytá cihlová výplň seděla
         * vedle brandové růžové tak blízko, že to vypadalo jako druhý odstín
         * téže barvy, ne jako varování — a zároveň si dvě plné barvy braly
         * stejnou pozornost. Obrys drží červený signál, výplň si nechává až
         * na hover, kdy uživatel opravdu míří na smazání.
         * Kontrast: --cervena 5,9:1 na bílé (světlý režim) a v dark módu je
         * to zesvětlený textový odstín, obojí nad AA i nad 3:1 pro hranici.
         */
        danger:
          'border border-cervena text-cervena hover:bg-cervena-syta hover:text-white',
      },
      size: {
        md: 'h-10 px-4',
        sm: 'h-8 px-3 text-xs',
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
