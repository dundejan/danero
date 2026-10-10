'use client';

import { AlertDialog } from '@base-ui/react/alert-dialog';
import { useFormStatus } from 'react-dom';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function ConfirmButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(buttonVariants({ variant: 'primary' }), 'w-full bg-danger-fill sm:w-auto')}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * Potvrzení nevratné akce, které se neobejde bez vyplnění (smazání účtu chce
 * heslo a opsané slovo). Sdílený `ConfirmDialog` unese jen skrytá pole —
 * tenhle má pro viditelná pole místo mezi popisem a tlačítky. Vzhled, pohyb
 * i chování (past na fokus, Escape, klik mimo nezavírá) jsou stejné, oba
 * staví na Base UI AlertDialog.
 *
 * `defaultOpen` dialog otevře hned po načtení: server po neúspěšném pokusu
 * přesměruje zpátky s kódem chyby a hláška patří k poli, ne na zavřenou
 * stránku.
 */
export function ConfirmFormDialog({
  trigger,
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel = 'Zrušit',
  action,
  defaultOpen = false,
  children,
}: {
  trigger: React.ReactElement<Record<string, unknown>>;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  cancelLabel?: string;
  action: (formData: FormData) => void | Promise<void>;
  defaultOpen?: boolean;
  /** Viditelná pole formuláře. */
  children: React.ReactNode;
}) {
  return (
    <AlertDialog.Root defaultOpen={defaultOpen}>
      <AlertDialog.Trigger render={trigger} />
      <AlertDialog.Portal>
        <AlertDialog.Backdrop
          className={cn(
            'fixed inset-0 z-50 bg-(--scrim) transition-opacity duration-200 ease-(--ease-out)',
            'data-starting-style:opacity-0 data-ending-style:opacity-0',
          )}
        />
        <AlertDialog.Popup
          className={cn(
            'fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto',
            // V tmavém režimu `canvas`, ne `control` jako u sdíleného dialogu: na
            // světlejší ploše by červená chybová hláška neměla kontrast AA (4,09 : 1).
            'rounded-2xl bg-surface p-6 text-left shadow-floating outline-none dark:bg-canvas',
            'transition-[transform,opacity] duration-200 ease-(--ease-out)',
            'data-starting-style:scale-95 data-starting-style:opacity-0',
            'data-ending-style:scale-95 data-ending-style:opacity-0',
            'motion-reduce:data-starting-style:scale-100 motion-reduce:data-ending-style:scale-100',
          )}
        >
          <AlertDialog.Title className="type-title-3 text-balance">{title}</AlertDialog.Title>
          <AlertDialog.Description className="type-callout mt-2 text-pretty text-ink-muted">
            {description}
          </AlertDialog.Description>
          <form action={action}>
            <div className="mt-5 space-y-4">{children}</div>
            {/* na telefonu tlačítka pod sebou, potvrzení nahoře (blíž palci je Zrušit) */}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
              <ConfirmButton label={confirmLabel} pendingLabel={pendingLabel} />
              <AlertDialog.Close
                type="button"
                className={cn(buttonVariants({ variant: 'secondary' }), 'w-full sm:w-auto')}
              >
                {cancelLabel}
              </AlertDialog.Close>
            </div>
          </form>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
