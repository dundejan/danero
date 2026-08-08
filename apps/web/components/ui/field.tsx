import { cn } from '@/lib/utils';

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label className={cn('mb-1.5 block text-sm font-medium', className)} {...props} />;
}

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-md border border-linka-ovladaci bg-plocha px-3 text-sm text-inkoust placeholder:text-inkoust-tlumeny',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Chybová hláška formuláře. `role="alert"` ji čtečce přečte hned, jak se
 * objeví (bez něj se o nezdařeném přihlášení ani špatném 2FA kódu nedozví),
 * `id` slouží k `aria-describedby` na poli, kterého se chyba týká (WCAG 3.3.1).
 */
export function FieldError({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p id={id} role="alert" className={cn('text-sm text-cervena', className)}>
      {children}
    </p>
  );
}

/** Atributy pole, kterého se chyba týká — `aria-invalid` + odkaz na hlášku. */
export function describedByError(
  hasError: boolean,
  errorId: string,
): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  return hasError ? { 'aria-invalid': true, 'aria-describedby': errorId } : {};
}

export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-md border border-linka-ovladaci bg-plocha px-3 text-sm text-inkoust',
        className,
      )}
      {...props}
    />
  );
}
