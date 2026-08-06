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
        secondary: 'border border-linka bg-plocha text-inkoust hover:border-inkoust-tlumeny',
        ghost: 'text-inkoust-tlumeny hover:text-inkoust',
        danger: 'bg-cervena-syta text-white hover:brightness-95',
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
