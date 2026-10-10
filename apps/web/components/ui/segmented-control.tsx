'use client';

import Link, { useLinkStatus } from 'next/link';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { thumbHandoff } from '@/components/ui/segmented-thumb';
import { type MotionSample, releaseVelocity, SPRING_QUICK } from '@/lib/motion';
import { cn } from '@/lib/utils';

export interface Segment {
  key: string;
  label: React.ReactNode;
  /** Přístupný název, když `label` není text (ikona) nebo je zkrácený. */
  ariaLabel?: string;
  /** Segment jako odkaz (přepínač roku mění adresu, ne stav komponenty). */
  href?: string;
}

/** Zaoblení palce v pixelech — o půl kroku menší než dráha (`rounded-lg`). */
const THUMB_RADIUS = 7;

/**
 * Hlásí, že navigace na odkaz skončila — ať už novou stránkou, nebo ničím
 * (chyba, přesměrování zpátky). Musí stát UVNITŘ odkazu, jinak stav nevidí.
 */
function NavigationProbe({ onSettled }: { onSettled: () => void }) {
  const { pending } = useLinkStatus();
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) onSettled();
    wasPending.current = pending;
  }, [pending, onSettled]);
  return null;
}

/**
 * Segmentový přepínač: šedá dráha a bílý palec, který se mezi segmenty přesune
 * kriticky tlumenou pružinou (žádný překmit — nic ho nevrhlo). Pružina je
 * zadaná fyzikou, takže další klepnutí uprostřed pohybu naváže z místa
 * i rychlosti, kterou palec zrovna má.
 *
 * **Palec se pohne hned při klepnutí.** U `kind="nav"` (segment je odkaz —
 * přepínač roku) se výběr odvozuje z adresy a nová stránka přijde až ze
 * serveru; čekat s pohybem na ni by z nejčastějšího ovládacího prvku udělalo
 * ten nejpomalejší. Palec proto skočí na cíl okamžitě (optimisticky) a vrátí
 * se jen tehdy, když navigace nedopadne. `aria-current` mezitím dál říká
 * pravdu — označuje stránku, která je opravdu na obrazovce.
 *
 * **Když se nevejde, posouvá se — a jen on.** Přepínač nikdy nepřeteče
 * z rodiče ani nenechá popisky vykreslit přes sebe: dráha je vždy široká
 * podle popisků a obal ji ořízne a nechá vodorovně rolovat (hodně let na
 * telefonu, dvojnásobné písmo). Vybraný segment se při vykreslení i při změně
 * srovná do zorného pole a okraj, za kterým dráha pokračuje, se rozplývá.
 * Vlastní posuvný obal kolem přepínače už není potřeba.
 *
 * Velikost:
 * - `sm` (výchozí) — přepínač pohledu v liště a v hlavičce sekce: viditelná
 *   výška 28 px (32 px pro prst), klikací plocha segmentu je pseudo-prvkem
 *   natažená na 44 px, jak to dělá systém;
 * - `md` — přepínač, který je hlavním ovládáním (odpověď v kalkulačce):
 *   36 px, na dotyku rovnou 44 px.
 *
 * Šířka segmentů:
 * - `equal` (výchozí) — všechny stejně široké podle nejdelšího popisku
 *   (roky, „Graf / Tabulka“);
 * - `content` — každý podle svého popisku; pro různě dlouhé popisky, které
 *   by ve stejné šířce na telefon nevešly („Daň a výpočet / Upozornění / Účet“).
 *
 * Přepínač je široký podle obsahu; `className="w-full"` ho roztáhne a segmenty
 * si místo rozdělí. `className` dostává vnější obal (šířka, okraje).
 */
export function SegmentedControl({
  segments,
  value,
  onChange,
  ariaLabel,
  kind = 'toggle',
  size = 'sm',
  fit = 'equal',
  className,
}: {
  segments: Segment[];
  value: string;
  onChange?: (key: string) => void;
  ariaLabel: string;
  /**
   * `toggle` — tlačítka s `aria-pressed` (přepnutí pohledu na stránce);
   * `nav` — odkazy s `aria-current` (každý segment je jiná adresa).
   */
  kind?: 'toggle' | 'nav';
  size?: 'sm' | 'md';
  fit?: 'equal' | 'content';
  className?: string;
}) {
  const Wrapper = kind === 'nav' ? 'nav' : 'div';
  const reducedMotion = useReducedMotion() ?? false;

  // Optimistický výběr odkazového přepínače: platí, jen dokud se `value`
  // nezmění — pak už palec stojí tam, kam ho poslala nová stránka.
  const [pending, setPending] = useState<{ key: string; from: string } | null>(null);
  const shown = pending !== null && pending.from === value ? pending.key : value;

  const scrollerRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef(new Map<string, HTMLElement>());
  const x = useMotionValue(0);
  const scaleX = useMotionValue(1);
  // měřítko by zaoblení rohů vodorovně protáhlo — poloměr se dělí zpátky
  const borderRadius = useTransform(
    scaleX,
    (scale) => `${THUMB_RADIUS / (scale || 1)}px / ${THUMB_RADIUS}px`,
  );
  const previous = useRef(shown);
  // Posledních pár poloh palce s časem. Rychlost si hodnota `x` umí spočítat
  // sama, jenže palec se při změně výběru vykresluje v jiném segmentu a nově
  // připojený prvek jí měření vynuluje — v okamžiku, kdy ji potřebujeme, vrací
  // vždy nulu.
  const flight = useRef<MotionSample[]>([]);
  useEffect(
    () =>
      x.on('change', (latest) => {
        flight.current.push({ time: performance.now(), offset: latest });
        if (flight.current.length > 4) flight.current.shift();
      }),
    [x],
  );

  useLayoutEffect(() => {
    const from = segmentRefs.current.get(previous.current);
    const to = segmentRefs.current.get(shown);
    const changed = previous.current !== shown;
    previous.current = shown;

    // Vybraný segment do zorného pole. Posouvá se jen obal přepínače —
    // `scrollIntoView` by pohnul i stránkou, když přepínač leží pod ohybem.
    const scroller = scrollerRef.current;
    if (scroller && to && scroller.scrollWidth > scroller.clientWidth) {
      const scrollerBox = scroller.getBoundingClientRect();
      const segmentBox = to.getBoundingClientRect();
      const center = segmentBox.left - scrollerBox.left + scroller.scrollLeft + segmentBox.width / 2;
      scroller.scrollLeft = center - scroller.clientWidth / 2;
    }

    if (!changed || !from || !to || reducedMotion) {
      x.jump(0);
      scaleX.jump(1);
      return;
    }
    // Rozměry z `getBoundingClientRect`, ne z `offsetWidth`: ten zaokrouhluje
    // na celé pixely a stejně široké segmenty (66,67 px) by vyšly jako 66 a 67
    // — palec by při každém přesunu o pixel pulzoval. Obě měření jsou ve
    // stejných souřadnicích, takže na poloze stránky ani rolování nezáleží.
    const fromBox = from.getBoundingClientRect();
    const toBox = to.getBoundingClientRect();
    const start = thumbHandoff(
      { left: fromBox.left, width: fromBox.width },
      { left: toBox.left, width: toBox.width },
      { x: x.get(), scale: scaleX.get() },
    );
    // Pružině se předá rychlost, kterou palec zrovna má — obrácení směru pak
    // není náraz do zdi. Bere se z vlastních vzorků (viz `flight`).
    const velocity = releaseVelocity(flight.current, performance.now());
    x.jump(start.x);
    scaleX.jump(start.scale);
    // skok do souřadnic nového segmentu není pohyb — vzorky začínají znovu
    flight.current = [];
    const moving = animate(x, 0, { ...SPRING_QUICK, velocity });
    const resizing = animate(scaleX, 1, SPRING_QUICK);
    return () => {
      moving.stop();
      resizing.stop();
    };
  }, [shown, reducedMotion, x, scaleX]);

  return (
    // Vnější obal je mřížka s jediným sloupcem `minmax(0, 1fr)`: bez omezení je
    // široká přesně podle dráhy, ale svému okolí hlásí NULOVOU nejmenší šířku.
    // Bez toho by dlouhý přepínač roztáhl sloupec stránky, ve kterém stojí
    // (položka mřížky nebo flexu se pod svůj nejmenší obsah nesmrští) — a místo
    // posouvání uvnitř by přetekla celá stránka.
    <div
      className={cn('inline-grid max-w-full min-w-0 grid-cols-[minmax(0,1fr)] align-middle', className)}
    >
      {/* Posuvný obal. Odsazení nechává místo tomu, co dráhu přesahuje (klikací
          plochy segmentů svisle, obrys fokusu vodorovně) — jinak by to
          `overflow` ořízl — a záporný okraj ho v rozvržení zase ruší. */}
      <div
        ref={scrollerRef}
        className="scroll-fade-x -m-2 flex min-w-0 overflow-x-auto overscroll-x-contain p-2 [scrollbar-width:none]"
      >
        <Wrapper
          role={kind === 'nav' ? undefined : 'group'}
          aria-label={ariaLabel}
          className={cn(
            // Mřížka, ne flex: stejně široké sloupce (`fr`) se řídí nejdelším
            // popiskem. `shrink-0` drží dráhu širokou podle popisků, i když se
            // do rodiče nevejde (pak roluje obal — jinak by se sloupce smáčkly
            // a popisky vykreslily přes sebe), `min-w-full` ji roztáhne, když
            // je místa víc.
            'relative grid min-w-full shrink-0 grid-flow-col rounded-lg bg-control p-0.5',
            fit === 'equal' ? 'auto-cols-fr' : 'auto-cols-auto',
            size === 'md' ? 'h-9 pointer-coarse:h-11' : 'h-7 pointer-coarse:h-8',
          )}
        >
          {segments.map((segment) => {
            const active = segment.key === shown;
            const content = (
              <>
                {active && (
                  <motion.span
                    style={{ x, scaleX, borderRadius }}
                    className="absolute inset-0 origin-left bg-surface shadow-thumb dark:bg-line-control/60"
                    aria-hidden
                  />
                )}
                <span className="relative">{segment.label}</span>
              </>
            );
            const itemClass = cn(
              'relative inline-flex min-w-11 items-center justify-center whitespace-nowrap rounded-[7px] px-3 leading-none tabular-nums',
              // klikací plocha 44 px na výšku bez změny vzhledu
              'after:absolute after:inset-x-0',
              size === 'md'
                ? 'text-sm after:-inset-y-1 pointer-coarse:after:-inset-y-0.5'
                : 'text-[0.8125rem] after:-inset-y-2',
              active ? 'font-semibold text-ink' : 'font-medium text-ink active:opacity-60',
            );
            const setRef = (element: HTMLElement | null) => {
              if (element) segmentRefs.current.set(segment.key, element);
              else segmentRefs.current.delete(segment.key);
            };
            return segment.href ? (
              <Link
                key={segment.key}
                ref={setRef}
                href={segment.href}
                aria-label={segment.ariaLabel}
                aria-current={segment.key === value ? 'page' : undefined}
                className={cn(itemClass, 'control-link')}
                // přepnutí roku nemá odskočit na začátek stránky
                scroll={false}
                onClick={(event) => {
                  // jen obyčejné klepnutí: s klávesou nebo prostředním
                  // tlačítkem se otevírá nový panel a tady se nic nemění
                  if (
                    event.defaultPrevented ||
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey ||
                    segment.key === value
                  ) {
                    return;
                  }
                  setPending({ key: segment.key, from: value });
                }}
              >
                <NavigationProbe
                  onSettled={() =>
                    setPending((current) => (current?.key === segment.key ? null : current))
                  }
                />
                {content}
              </Link>
            ) : (
              <button
                key={segment.key}
                ref={setRef}
                type="button"
                aria-label={segment.ariaLabel}
                title={segment.ariaLabel}
                aria-pressed={active}
                onClick={() => onChange?.(segment.key)}
                className={itemClass}
              >
                {content}
              </button>
            );
          })}
        </Wrapper>
      </div>
    </div>
  );
}
