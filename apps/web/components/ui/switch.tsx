import { cn } from '@/lib/utils';

interface SwitchProps extends Omit<React.ComponentProps<'input'>, 'type'> {
  /** Volitelný popisek vpravo od přepínače. */
  label?: React.ReactNode;
}

/**
 * Přepínač (vizuální pilulka) nad nativním checkboxem — funguje bez JS uvnitř
 * formuláře (odesílá se jako běžný checkbox „on“). Stavy řeší Tailwind přes
 * `peer-checked`, fokus kreslí obrys kolem pilulky (input samotný je sr-only).
 *
 * Vypnutá dráha je šedá `line-control` (3,6:1 proti ploše — WCAG 1.4.11),
 * zapnutá akcentní; palec je v obou stavech bílý a mezi polohami přejede
 * krátkým přechodem. Použij pro nastavení, které platí HNED (bez tlačítka
 * Uložit); volbu, která se odesílá formulářem, nese `Checkbox`.
 */
export function Switch({ label, className, ...props }: SwitchProps) {
  return (
    <label
      className={cn(
        'flex min-h-9 items-center gap-3 text-sm pointer-coarse:min-h-11',
        props.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
    >
      <input type="checkbox" role="switch" className="peer sr-only" {...props} />
      <span
        aria-hidden="true"
        className={cn(
          'relative h-6 w-10 shrink-0 rounded-full bg-line-control transition-colors duration-200',
          'after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white',
          'after:shadow-thumb after:transition-transform after:duration-200 after:ease-(--ease-out)',
          'peer-checked:bg-accent-fill peer-checked:after:translate-x-4',
          'peer-active:after:scale-95',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
        )}
      />
      {label != null && <span>{label}</span>}
    </label>
  );
}
