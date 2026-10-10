'use client';

import { AlertDialog } from '@base-ui/react/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Potvrzovací dialog pro akci, která se nedá vrátit (smazání účtu, vrácení
 * importu, odpojení brokera). Jen pro takové — na všechno ostatní je lepší
 * akci rovnou provést a nabídnout návrat; dialog u každé maličkosti naučí
 * lidi odklikávat bez čtení.
 *
 * Staví na Base UI AlertDialog: past na fokus, Escape, návrat fokusu na
 * spouštěč a `role="alertdialog"` řeší knihovna. Klik mimo dialog NEZAVÍRÁ —
 * rozhodnutí má být vědomé. Dialog je uprostřed okna a roste ze středu
 * (není ukotvený ke spouštěči).
 *
 * Potvrzení má dvě podoby:
 * - `action` — server action; potvrzovací tlačítko je pak `submit` formuláře
 *   a `children` jsou jeho skrytá pole (`<input type="hidden" …>`),
 * - `onConfirm` — klientská funkce.
 *
 * Titulek je otázka se slovesem („Smazat účet?“), popis říká, co se stane,
 * a potvrzovací tlačítko opakuje sloveso („Smazat účet“), ne „OK“.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Zrušit',
  destructive = true,
  action,
  onConfirm,
  children,
}: {
  /** Prvek, který dialog otevírá — typicky `<Button variant="danger">`. */
  trigger: React.ReactElement<Record<string, unknown>>;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Potvrzení je nevratné a ničivé → červené tlačítko. */
  destructive?: boolean;
  action?: (formData: FormData) => void | Promise<void>;
  onConfirm?: () => void;
  /** Skrytá pole formuláře (jen s `action`). */
  children?: React.ReactNode;
}) {
  const confirmClass = cn(
    buttonVariants({ variant: 'primary' }),
    'w-full sm:w-auto',
    destructive && 'bg-danger-fill',
  );
  const cancelClass = cn(buttonVariants({ variant: 'secondary' }), 'w-full sm:w-auto');

  return (
    <AlertDialog.Root>
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
            'fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2',
            'rounded-2xl bg-surface p-6 shadow-floating outline-none dark:bg-control',
            'transition-[transform,opacity] duration-200 ease-(--ease-out)',
            'data-starting-style:scale-95 data-starting-style:opacity-0',
            'data-ending-style:scale-95 data-ending-style:opacity-0',
            'motion-reduce:data-starting-style:scale-100 motion-reduce:data-ending-style:scale-100',
          )}
        >
          <AlertDialog.Title className="type-title-3 text-balance">{title}</AlertDialog.Title>
          {description && (
            <AlertDialog.Description className="type-callout mt-2 text-pretty text-ink-muted">
              {description}
            </AlertDialog.Description>
          )}
          {/* na telefonu tlačítka pod sebou, potvrzení nahoře (blíž palci je Zrušit) */}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
            {action ? (
              <form action={action} className="contents">
                {children}
                <button type="submit" className={confirmClass}>
                  {confirmLabel}
                </button>
              </form>
            ) : (
              <AlertDialog.Close className={confirmClass} onClick={onConfirm}>
                {confirmLabel}
              </AlertDialog.Close>
            )}
            <AlertDialog.Close className={cancelClass}>{cancelLabel}</AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
