import { cn } from '@/lib/utils';

/**
 * Tisková kopie vysvětlivky. Obsah `InfoPopover` se vykresluje až po otevření,
 * takže na papír by se nedostal — a vytištěný podklad je dokument: co jde na
 * obrazovce rozkliknout, musí v něm stát rovnou. `InfoPrint` dostane tentýž
 * obsah jako vysvětlivka a je vidět JEN v tisku.
 *
 * Stojí zvlášť, ne uvnitř `InfoPopover`: tlačítko „i“ bývá v řádku s nadpisem
 * nebo popiskem, kam odstavec textu nepatří — kopii dej pod blok, kterého se
 * týká (pod tabulku, pod skupinu řádků).
 */
export function InfoPrint({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'type-footnote mt-3 hidden max-w-[80ch] text-ink-muted print:block [&>*+*]:mt-1.5',
        className,
      )}
    >
      {children}
    </div>
  );
}
