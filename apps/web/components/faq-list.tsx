/**
 * Seznam otázek a odpovědí nad nativním `<details>`: otázka je řádek s šipkou,
 * odpověď se rozbalí pod ní. Řádky dělí vlásová linka — žádné karty. Stejný
 * jazyk jako `DisclosureRow` v aplikaci, jen s větším písmem: odpověď je text
 * ke čtení, ne poznámka pod čarou.
 */

/** Šipka rozbalovátka: zavřená míří doprava, otevřená dolů. */
function Chevron() {
  return (
    <svg
      viewBox="0 0 8 12"
      aria-hidden
      className="h-3 w-auto shrink-0 fill-none stroke-current text-ink-muted transition-transform duration-150 ease-(--ease-out) group-open/disclosure:rotate-90"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1.5 1.5L6 6l-4.5 4.5" />
    </svg>
  );
}

export interface FaqItem {
  q: string;
  a: React.ReactNode;
  /**
   * Prostý text odpovědi pro strukturovaná data (`faqPageJsonLd`). Povinný
   * jen tam, kde je `a` JSX — z něj se text spolehlivě nevytáhne.
   */
  plain?: string;
}

export function FaqList({ items }: { items: FaqItem[] }) {
  return (
    <div className="divide-y divide-line/70 border-y border-line/70">
      {items.map((item) => (
        <details key={item.q} className="disclosure group/disclosure">
          <summary className="row-pressable -mx-2 flex min-h-11 items-center gap-4 rounded-lg px-2 py-4 hover:bg-(--highlight)">
            <span className="type-title-3 min-w-0 flex-1 text-pretty">{item.q}</span>
            <Chevron />
          </summary>
          <p className="type-body measure pb-5 text-pretty text-ink-muted">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
