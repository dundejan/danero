'use client';

import { useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * Tlačítko nevratné akce: otevře potvrzení a samo ukazuje, že akce běží.
 * Musí stát uvnitř formuláře — stav bere z něj (`useFormStatus`).
 */
function Trigger({
  label,
  pendingLabel,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  label: string;
  pendingLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const { pending } = useFormStatus();
  return (
    <ConfirmDialog
      trigger={
        <Button type="button" variant="danger" size="sm" disabled={pending}>
          {pending ? pendingLabel : label}
        </Button>
      }
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      onConfirm={onConfirm}
    />
  );
}

/**
 * Nevratná akce nad server action: tlačítko → potvrzovací dialog → odeslání.
 *
 * `ConfirmDialog` umí server action odeslat i sám, jenže jeho potvrzovací
 * tlačítko nemá stav „probíhá“: dialog by po potvrzení zůstal viset beze
 * změny a druhé klepnutí by akci poslalo podruhé (u vrácení importu pak
 * skončí hláškou „už vrácený je“ — L7d-04). Tady se dialog po potvrzení zavře
 * hned a běh akce ukazuje samo tlačítko („Vracím…“), dokud nepřijde výsledek.
 */
export function ConfirmedAction({
  action,
  fields,
  label,
  pendingLabel,
  title,
  description,
  confirmLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  /** Skrytá pole formuláře — jména česky, čte je server action. */
  fields: Record<string, string>;
  /** Popisek tlačítka v klidu a během akce. */
  label: string;
  pendingLabel: string;
  /** Otázka se slovesem („Vrátit import zpět?“). */
  title: string;
  /** Co se stane — čte se v dialogu, ne až po akci. */
  description: string;
  /** Potvrzení opakuje sloveso. */
  confirmLabel: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={action}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Trigger
        label={label}
        pendingLabel={pendingLabel}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        onConfirm={() => formRef.current?.requestSubmit()}
      />
    </form>
  );
}
