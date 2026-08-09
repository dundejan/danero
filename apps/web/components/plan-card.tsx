import { IconCheck } from '@/components/marketing-icons';
import type { Plan } from '@/lib/plans';
import { cn } from '@/lib/utils';

/**
 * Karta tarifu — společná pro veřejný ceník i pro /predplatne, ať uživatel
 * u placení vidí přesně to, co mu slíbil ceník (obsah drží `lib/plans.ts`).
 *
 * `active` je stav uvnitř aplikace: „tohle už máš“. Kreslí se ODZNAKEM
 * a rámečkem, ne jen barvou — samotná barva by pro barvosleposti a čtečky
 * nebyla informace (WCAG 1.4.1). Odznak nese i `aria-label`, protože „Aktivní“
 * u tarifu Zdarma a u hlídání znamená v kontextu totéž a musí jít přečíst
 * i mimo vizuální pořadí.
 */
export function PlanCard({
  plan,
  active,
  activeNote,
  children,
}: {
  plan: Plan;
  /** Tarif, který uživatel právě má. Na veřejném ceníku se nepředává. */
  active?: boolean;
  /** Doplněk k aktivnímu stavu (do kdy platí, které roky jsou koupené). */
  activeNote?: React.ReactNode;
  /** Akce karty — odkaz na registraci, nebo objednávkový formulář. */
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border bg-plocha p-8',
        active
          ? 'border-zelena/50 bg-zelena/5'
          : plan.highlight
            ? 'border-ruzova/30 bg-ruzova/5'
            : 'border-linka',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p
          className={cn(
            'font-mono text-xs font-semibold uppercase tracking-wide',
            plan.highlight && !active ? 'text-ruzova-text' : 'text-inkoust-tlumeny',
          )}
        >
          {plan.name}
        </p>
        {active && (
          <span
            className="shrink-0 rounded-full bg-zelena/15 px-2.5 py-1 text-xs font-semibold text-zelena-text"
            aria-label={`Tarif ${plan.name} máš aktivní`}
          >
            Máš aktivní
          </span>
        )}
      </div>

      <p className="mt-3 font-display text-4xl font-bold tracking-tight">{plan.price}</p>
      <p className="mt-2 text-sm text-inkoust-tlumeny">{plan.priceNote}</p>
      {activeNote && <p className="mt-2 text-sm text-zelena-text">{activeNote}</p>}

      <ul className="mt-6 grid gap-3">
        {plan.features.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-sm">
            <IconCheck />
            <span>{item}</span>
          </li>
        ))}
      </ul>

      {/* mt-auto: karty v řadě mají akci u spodní hrany bez ohledu na to,
          kolik má který tarif odrážek */}
      {children && <div className="mt-auto pt-6">{children}</div>}
    </div>
  );
}
