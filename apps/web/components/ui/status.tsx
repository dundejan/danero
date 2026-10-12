import { cn } from '@/lib/utils';

export type Tone = 'neutral' | 'accent' | 'success' | 'caution' | 'warning' | 'danger';

/** Textová barva stavu — odstíny, které drží AA na `surface` i `canvas`. */
export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-ink-muted',
  accent: 'text-accent-text',
  success: 'text-success-text',
  caution: 'text-caution-text',
  warning: 'text-warning-text',
  danger: 'text-danger',
};

/**
 * Stav jednou větou: barevná tečka a text téže barvy („● přes limit“).
 * Tečka je jen zdvojení barvy — stav musí být čitelný i ze samotného textu,
 * barva sama informaci nenese. Žádné štítky s výplní.
 *
 * Barvy stavů: zelená = v pořádku / osvobozeno, žlutá = zvýšené čerpání,
 * oranžová = těsně pod limitem, červená = přes limit / chyba. Akcentní modrá
 * stav NIKDY nenese — je to barva ovládání.
 */
export function StatusLabel({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'type-callout inline-flex items-start gap-2 font-medium',
        TONE_TEXT[tone],
        className,
      )}
    >
      {/* tečka patří k PRVNÍMU řádku (svisle na jeho střed), ne doprostřed
          bloku — u textu na dva řádky jinak visela mezi nimi */}
      <span
        aria-hidden
        className="mt-[calc((1lh-0.5rem)/2)] size-2 shrink-0 rounded-full bg-current"
      />
      <span>{children}</span>
    </span>
  );
}
