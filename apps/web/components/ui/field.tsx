import { typeset } from '@/components/typeset';
import { cn } from '@/lib/utils';

/**
 * Formulářová pole. Výška 36 px pro myš, 44 px pro prst; hranice má vlastní
 * token (`line-control`, ≥ 3:1), fokus kreslí akcentní obrys těsně na hraně
 * a chybový stav se zapíná přes `aria-invalid` (viz `describedByError`), ne
 * zvláštní třídou — co vidí oko, slyší i čtečka.
 */
const CONTROL = [
  'h-9 w-full rounded-md border border-line-control bg-surface px-3 text-sm text-ink',
  'placeholder:text-ink-muted pointer-coarse:h-11',
  'focus-visible:border-accent focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-accent',
  'aria-invalid:border-danger aria-invalid:focus-visible:outline-danger',
  'disabled:cursor-not-allowed disabled:bg-canvas disabled:text-ink-muted',
];

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label className={cn('mb-1.5 block text-sm font-medium', className)} {...props} />;
}

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input className={cn(CONTROL, className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(CONTROL, 'h-auto min-h-24 py-2 leading-normal pointer-coarse:h-auto', className)}
      {...props}
    />
  );
}

/**
 * Nativní `<select>` (na telefonu otevře systémový výběr) s vlastní šipkou —
 * třída `select-chevron` je v globals.css, protože obrázek šipky potřebuje
 * barvu podle režimu.
 */
export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return <select className={cn(CONTROL, 'select-chevron pr-9', className)} {...props} />;
}

/**
 * Zaškrtávátko s popiskem. Políčko je nativní (klávesnice, čtečka i formulář
 * bez JavaScriptu fungují samy), jen obarvené akcentem. `hint` je tichý druhý
 * řádek pod popiskem — delší vysvětlení patří do `InfoPopover`.
 */
export function Checkbox({
  label,
  hint,
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'> & {
  label: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        'flex min-h-9 items-start gap-2.5 py-1.5 text-sm pointer-coarse:min-h-11 pointer-coarse:py-2.5',
        props.disabled && 'cursor-not-allowed text-ink-muted',
        className,
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 size-4.5 shrink-0 accent-(--accent-fill) pointer-coarse:size-5"
        {...props}
      />
      <span>
        {label}
        {hint && <span className="type-footnote mt-0.5 block text-ink-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** Tichá nápověda pod polem (jedna věta). Delší výklad patří do `InfoPopover`. */
export function FieldHint({ id, className, ...props }: React.ComponentProps<'p'>) {
  return <p id={id} className={cn('type-footnote mt-1.5 text-ink-muted', className)} {...props} />;
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
    <p id={id} role="alert" className={cn('text-sm text-danger', className)}>
      {typeset(children)}
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

/**
 * Pole s popiskem pohromadě: popisek (a vedle něj případná vysvětlivka),
 * ovládací prvek, nápověda a chyba. Ovládací prvek přichází jako `children`
 * a `id`/`htmlFor` si volající páruje sám — komponenta jen drží rozestupy.
 */
export function Field({
  label,
  htmlFor,
  info,
  hint,
  error,
  errorId,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor: string;
  /** `InfoPopover` vedle popisku. */
  info?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  /** Id chybové hlášky (totéž, které dostalo pole přes `describedByError`). */
  errorId?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="mb-1.5 flex min-h-6 items-center gap-1">
        <Label htmlFor={htmlFor} className="mb-0">
          {label}
        </Label>
        {info}
      </div>
      {children}
      {hint && <FieldHint>{hint}</FieldHint>}
      {error && (
        <FieldError id={errorId ?? `${htmlFor}-error`} className="mt-1.5">
          {error}
        </FieldError>
      )}
    </div>
  );
}
