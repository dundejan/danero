import { cn } from '@/lib/utils';
import { TONE_TEXT, type Tone } from '@/components/ui/status';

/**
 * Sdělení nad obsahem, které se týká celé stránky nebo sekce: něco chybí,
 * něco je potřeba udělat, něco se právě stalo. Tichá zaoblená výplň, barevná
 * tečka a titulek v barvě stavu — žádný rámeček ani barevný pruh na boku.
 *
 * Titulek je jedna věta, která obstojí sama. `children` je nejvýš jedna
 * krátká věta navíc; delší výklad dej do `Disclosure` uvnitř, nebo za odkaz.
 * `action` je tlačítko nebo odkaz vpravo (na telefonu pod textem).
 *
 * `role`: `status` pro informaci, `alert` jen pro chybu, která právě vznikla.
 */
export function Notice({
  tone = 'neutral',
  title,
  children,
  action,
  role,
  className,
}: {
  tone?: Tone;
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  role?: 'status' | 'alert';
  className?: string;
}) {
  return (
    <div
      role={role}
      className={cn(
        'flex flex-col gap-x-6 gap-y-3 rounded-xl bg-canvas px-4 py-3.5 sm:flex-row sm:items-center',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className={cn('type-callout flex items-baseline gap-2 font-medium', TONE_TEXT[tone])}>
          <span
            aria-hidden
            className="size-2 shrink-0 translate-y-[-0.05em] rounded-full bg-current"
          />
          <span className={cn(tone === 'neutral' && 'text-ink')}>{title}</span>
        </p>
        {children && (
          <div className="type-footnote mt-1 pl-4 text-pretty text-ink-muted">{children}</div>
        )}
      </div>
      {/* akce si vedle textu bere nejvýš polovinu — tlačítko s dlouhým popiskem
          se v ní zalomí, místo aby ze sdělení vyjelo */}
      {action && <div className="min-w-0 shrink-0 pl-4 sm:max-w-[50%] sm:pl-0">{action}</div>}
    </div>
  );
}
