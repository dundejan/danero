import { cn } from '@/lib/utils';

/**
 * Vodorovně scrollovatelná oblast (široké tabulky na úzkém displeji).
 *
 * `tabIndex={0}` je tu kvůli WCAG 2.1.1: bez něj se klávesnicí k pravé části
 * tabulky vůbec nedostaneš (myš scrolluje, klávesnice ne) — přesně to hlásí
 * axe pravidlem `scrollable-region-focusable`. `role="region"` + název pak
 * čtečce řeknou, do čeho fokus vstoupil; bez role by byl `aria-label` na
 * obyčejném divu zakázaný atribut.
 *
 * Stínovou affordanci na hranách nese třída `.scroll-stiny` z globals.css.
 */
export function ScrollArea({
  label,
  className,
  children,
}: {
  /** Název oblasti pro čtečku — nejčastěji nadpis tabulky uvnitř. */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn('scroll-stiny overflow-x-auto', className)}
    >
      {children}
    </div>
  );
}
