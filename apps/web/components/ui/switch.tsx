import { cn } from '@/lib/utils';

interface SwitchProps extends Omit<React.ComponentProps<'input'>, 'type'> {
  /** Volitelný popisek vpravo od přepínače. */
  label?: React.ReactNode;
}

/**
 * Přepínač (vizuální pilulka) nad nativním checkboxem — funguje bez JS uvnitř
 * formuláře (odesílá se jako běžný checkbox „on“). Stavy řeší Tailwind přes
 * `peer-checked`, fokus kreslí ring kolem pilulky (input samotný je sr-only).
 */
export function Switch({ label, className, ...props }: SwitchProps) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-3 text-sm',
        props.disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <input type="checkbox" role="switch" className="peer sr-only" {...props} />
      <span
        aria-hidden="true"
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border border-linka bg-plocha transition-colors',
          'after:absolute after:left-0.5 after:top-1/2 after:h-4.5 after:w-4.5 after:-translate-y-1/2',
          'after:rounded-full after:bg-inkoust-tlumeny after:transition-transform',
          'peer-checked:border-ruzova peer-checked:bg-ruzova',
          'peer-checked:after:translate-x-5 peer-checked:after:bg-white',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ruzova',
        )}
      />
      {label != null && <span>{label}</span>}
    </label>
  );
}
