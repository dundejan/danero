import { cn } from '@/lib/utils';

/**
 * Řádek nastavení s polem nebo nabídkou: popisek vlevo, ovládací prvek
 * vpravo — a v úzkém okně pod sebou, protože nabídka s textem se vedle
 * popisku na telefon nevejde (sdílený `Row` se neskládá, drží jeden řádek;
 * pro přepínač a tlačítko je proto dál správný on).
 *
 * Patří do `Group` (ta kreslí oddělovače a je pro čtečku seznam). Šířku
 * rozhoduje okno s obsahem (`@container` na stránce), ne prohlížeč.
 *
 * - `hint` je tichá věta pod popiskem: pár slov, která chrání před špatným
 *   závěrem. `hintId` ji naváže na pole přes `aria-describedby`.
 * - `info` je `InfoPopover` s celým výkladem.
 */
export function SettingRow({
  label,
  htmlFor,
  info,
  hint,
  hintId,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor: string;
  info?: React.ReactNode;
  hint?: React.ReactNode;
  hintId?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="listitem"
      className={cn(
        'group/setting flex flex-col gap-x-6 gap-y-2 py-3 text-ink @lg:min-h-11 @lg:flex-row @lg:items-center @lg:py-2.5',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <span className="inline-flex items-center gap-1">
          <label htmlFor={htmlFor}>{label}</label>
          {info}
        </span>
        {hint && (
          <div id={hintId} className="type-footnote text-pretty text-ink-muted">
            {hint}
          </div>
        )}
      </div>
      <div className="shrink-0 @lg:w-64">{children}</div>
    </div>
  );
}

/**
 * Tichá věta u sporného výkladu, která se mění podle zvolené varianty — bez
 * JavaScriptu, jen podle toho, která `<option data-disputed>` je vybraná
 * (`:has()` nad řádkem). Bezpečná varianta ukazuje, co by mírnější přinesla
 * a co stojí; mírnější varianta barvou i slovem říká, že je zapnutá.
 */
export function DisputedHint({ safe, lenient }: { safe: string; lenient: string }) {
  return (
    <>
      <span className="group-has-[option[data-disputed]:checked]/setting:hidden">{safe}</span>
      <span className="hidden font-medium text-caution-text group-has-[option[data-disputed]:checked]/setting:inline">
        {lenient}
      </span>
    </>
  );
}
