import type { LimitStatus } from '@danero/engine';
import { czk, pct } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Výplň odměrky vůči dráze (`bg-line/40`). WCAG 1.4.11 chce u grafiky, která
 * nese informaci, aspoň 3:1 — systémové barvy stavů v plné sytosti (zelená
 * #34c759, žlutá #ffcc00) by proti světlé dráze neprošly, proto jsou tokeny
 * ve světlém režimu tmavší odstíny týchž barev. Poměry ověřuje
 * test/design-tokens.test.ts (H-3-04) a čte je přímo z téhle mapy.
 */
const ZONE_COLOR: Record<LimitStatus['zone'], string> = {
  OK: 'bg-success',
  WARNING: 'bg-caution',
  CRITICAL: 'bg-warning',
  EXCEEDED: 'bg-danger',
};

export const ZONE_TEXT: Record<LimitStatus['zone'], string> = {
  OK: 'text-success-text',
  WARNING: 'text-caution-text',
  CRITICAL: 'text-warning-text',
  EXCEEDED: 'text-danger',
};

export const ZONE_LABEL: Record<LimitStatus['zone'], string> = {
  OK: 'v pořádku',
  WARNING: 'zvýšené čerpání',
  CRITICAL: 'těsně pod limitem',
  EXCEEDED: 'přes limit',
};

/** Pásmo z poměru čerpání — stejné prahy jako engine (60/85/100 %). */
export const zoneForRatio = (ratio: number): LimitStatus['zone'] =>
  ratio > 1 ? 'EXCEEDED' : ratio >= 0.85 ? 'CRITICAL' : ratio >= 0.6 ? 'WARNING' : 'OK';

/**
 * Vodorovná odměrka čerpání limitu: dráha 0–100 % limitu, výplň barvou pásma,
 * svislá ryska na 100 %. Při přetečení se škála protáhne na 130 % — výplň se
 * zastaví na rysce a dál pokračuje šrafovaně (poctivé „kolik přes“).
 *
 * Výplň se při načtení neanimuje: přehled člověk otevírá denně a číslo má být
 * na místě hned, ne po sedmi stech milisekundách.
 */
export function LimitBar({
  ratio,
  zone,
  className,
}: {
  ratio: number;
  zone: LimitStatus['zone'];
  className?: string;
}) {
  const exceeded = zone === 'EXCEEDED';
  const scale = exceeded ? 1.3 : 1;
  const markPct = (1 / scale) * 100;
  const fillPct = (Math.min(ratio, 1) / scale) * 100;
  const overPct = exceeded ? ((Math.min(ratio, 1.3) - 1) / scale) * 100 : 0;

  // `span`, ne `div`: odměrka stojí i uvnitř tlačítka (řádek seznamu limitů),
  // kam smí jen frázový obsah
  return (
    <span
      className={cn(
        'relative block h-1.5 w-full overflow-hidden rounded-full bg-line/40',
        className,
      )}
    >
      <span
        className={cn('absolute inset-y-0 left-0 rounded-l-full', ZONE_COLOR[zone])}
        style={{ width: `${fillPct}%` }}
      />
      {exceeded && overPct > 0 && (
        <span
          aria-hidden
          className="absolute inset-y-0"
          style={{
            left: `${markPct}%`,
            width: `${overPct}%`,
            background:
              'repeating-linear-gradient(135deg, var(--danger) 0 3px, transparent 3px 6px)',
          }}
        />
      )}
      <span
        aria-hidden
        className="absolute inset-y-0 w-0.5 bg-ink/70"
        style={{ left: `calc(${markPct}% - 1px)` }}
      />
    </span>
  );
}

/**
 * Jeden limit jako samostatný blok: název, čerpání, odměrka a vysvětlení.
 * Bez rámečku — hierarchii nese velikost čísla a barva stavu. Na přehledu
 * limity zobrazuje `LimitsInspector`; tenhle blok slouží tam, kde stojí
 * limit sám (veřejné stránky).
 */
export function LimitGauge({
  label,
  hint,
  status,
  headingAs: Heading = 'h2',
  className,
}: {
  label: string;
  hint: string;
  status: LimitStatus;
  headingAs?: 'h2' | 'h3' | 'p';
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <Heading className="type-callout font-medium text-ink">{label}</Heading>
      <p className="type-figure">
        {czk(status.usedCzk)}
        <span className="type-callout font-normal text-ink-muted"> z {czk(status.limitCzk)}</span>
      </p>
      <LimitBar ratio={status.ratio} zone={status.zone} />
      <p className={cn('type-footnote font-medium', ZONE_TEXT[status.zone])}>
        {pct(status.ratio * 100)} · {ZONE_LABEL[status.zone]}
      </p>
      <p className="type-footnote text-ink-muted">{hint}</p>
    </div>
  );
}
