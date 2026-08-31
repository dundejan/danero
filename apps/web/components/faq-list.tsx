/** Sdílený FAQ akordeon — jeden vzor pro landing i podstránky (details/summary). */

function IconPlus() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="h-4 w-4 shrink-0 text-inkoust-tlumeny transition-transform group-open:rotate-45"
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
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
    <div className="max-w-3xl space-y-3">
      {items.map((item) => (
        <details key={item.q} className="group rounded-lg border border-linka bg-plocha p-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-1 font-semibold [&::-webkit-details-marker]:hidden">
            {item.q}
            <IconPlus />
          </summary>
          <p className="mt-3 text-sm leading-relaxed text-inkoust-tlumeny">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
