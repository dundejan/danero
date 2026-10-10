'use client';

import { AlertDialog } from '@base-ui/react/alert-dialog';
import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Tlačítka dialogu nad server action. Stojí uvnitř formuláře a berou z něj
 * stav (`useFormStatus`): dokud akce běží, potvrzení říká, že pracuje, a nejde
 * stisknout podruhé — druhé odeslání vrácení importu končilo hláškou „už
 * vrácený je“ (L7d-04). `onSettled` se zavolá, jakmile akce doběhne.
 */
function ActionButtons({
  confirmLabel,
  pendingLabel,
  cancelLabel,
  confirmClass,
  cancelClass,
  onSettled,
}: {
  confirmLabel: string;
  pendingLabel?: string;
  cancelLabel: string;
  confirmClass: string;
  cancelClass: string;
  onSettled?: () => void;
}) {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) onSettled?.();
    wasPending.current = pending;
  }, [pending, onSettled]);
  return (
    <>
      <button type="submit" disabled={pending} className={confirmClass}>
        {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
      </button>
      <AlertDialog.Close type="button" disabled={pending} className={cancelClass}>
        {cancelLabel}
      </AlertDialog.Close>
    </>
  );
}

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
 * - `action` — server action. Formulář žije UVNITŘ dialogu (ten se vykresluje
 *   mimo strom stránky), takže spouštěč smí stát kdekoli, i v řádku seznamu.
 *   `fields` jsou jeho skrytá pole, `children` viditelná (heslo, opsané
 *   slovo). Dokud akce běží, potvrzení ukazuje `pendingLabel` a nejde
 *   stisknout znovu.
 *   Bez viditelných polí se dialog po doběhnutí akce sám zavře. S nimi zůstává
 *   otevřený: neúspěch vrací server s hláškou k poli (a `defaultOpen` dialog
 *   otevře i po novém načtení stránky), úspěch stránku opouští.
 * - `onConfirm` — klientská funkce; dialog se zavře hned.
 *
 * Titulek je otázka se slovesem („Smazat účet?“), popis říká, co se stane,
 * a potvrzovací tlačítko opakuje sloveso („Smazat účet“), ne „OK“.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel = 'Zrušit',
  destructive = true,
  action,
  fields,
  onConfirm,
  defaultOpen = false,
  children,
}: {
  /** Prvek, který dialog otevírá — typicky `<Button variant="danger">`. */
  trigger: React.ReactElement<Record<string, unknown>>;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  /** Popisek potvrzení, dokud akce běží („Mažu…“). */
  pendingLabel?: string;
  cancelLabel?: string;
  /** Potvrzení je nevratné a ničivé → červené tlačítko. */
  destructive?: boolean;
  action?: (formData: FormData) => void | Promise<void>;
  /** Skrytá pole formuláře — jména česky, čte je server action. */
  fields?: Record<string, string | number>;
  onConfirm?: () => void;
  /** Otevřít hned po načtení (server vrátil chybu k poli v dialogu). */
  defaultOpen?: boolean;
  /** Viditelná pole formuláře (jen s `action`). */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const confirmClass = cn(
    buttonVariants({ variant: 'primary' }),
    'w-full sm:w-auto',
    destructive && 'bg-danger-fill',
  );
  const cancelClass = cn(buttonVariants({ variant: 'secondary' }), 'w-full sm:w-auto');
  // na telefonu tlačítka pod sebou, potvrzení nahoře (blíž palci je Zrušit)
  const buttonRow = 'mt-6 flex flex-col gap-2 sm:flex-row-reverse sm:justify-start';
  const hasVisibleFields = children != null && children !== false;

  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
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
            // V tmavém režimu `canvas`, ne `control`: na světlejší ploše by
            // červená chybová hláška pod polem neměla kontrast AA (4,09:1).
            'rounded-2xl bg-surface p-6 text-left shadow-floating outline-none dark:bg-canvas',
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
          {action ? (
            <form action={action}>
              {fields &&
                Object.entries(fields).map(([name, value]) => (
                  <input key={name} type="hidden" name={name} value={value} />
                ))}
              {hasVisibleFields && <div className="mt-5 space-y-4">{children}</div>}
              <div className={buttonRow}>
                <ActionButtons
                  confirmLabel={confirmLabel}
                  pendingLabel={pendingLabel}
                  cancelLabel={cancelLabel}
                  confirmClass={confirmClass}
                  cancelClass={cancelClass}
                  onSettled={hasVisibleFields ? undefined : () => setOpen(false)}
                />
              </div>
            </form>
          ) : (
            <div className={buttonRow}>
              <AlertDialog.Close className={confirmClass} onClick={onConfirm}>
                {confirmLabel}
              </AlertDialog.Close>
              <AlertDialog.Close className={cancelClass}>{cancelLabel}</AlertDialog.Close>
            </div>
          )}
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
