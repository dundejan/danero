import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THUMB_AT_REST, thumbHandoff } from '@/components/ui/segmented-thumb';

describe('přesun palce segmentového přepínače', () => {
  const first = { left: 2, width: 60 };
  const third = { left: 122, width: 60 };
  const wide = { left: 62, width: 110 };

  it('z klidu začíná přesně na místě minulého segmentu', () => {
    // palec je vykreslený ve třetím segmentu; posun ho vrátí nad první
    expect(thumbHandoff(first, third)).toEqual({ x: -120, scale: 1 });
    expect(thumbHandoff(third, first)).toEqual({ x: 120, scale: 1 });
  });

  it('mezi různě širokými segmenty přenáší i šířku', () => {
    const start = thumbHandoff(first, wide);
    expect(start.x).toBe(-60);
    expect(start.scale).toBeCloseTo(60 / 110, 6);
  });

  it('klepnutí uprostřed pohybu naváže z místa, kde palec zrovna je (R3-16)', () => {
    // palec jede z prvního segmentu do třetího a je v půli cesty: vůči třetímu
    // segmentu má posun -60. Další klepnutí ho posílá zpátky na první.
    const midway = { x: -60, scale: 1 };
    const start = thumbHandoff(third, first, midway);
    // vidět byl na 122 - 60 = 62; vůči prvnímu segmentu (2) je to +60, ne +120
    expect(start).toEqual({ x: 60, scale: 1 });
  });

  it('rozpracované měřítko se nezahodí', () => {
    const start = thumbHandoff(wide, first, { x: -30, scale: 0.8 });
    // viditelná šířka 110 × 0,8 = 88 px; vůči cíli širokému 60 px
    expect(start.scale).toBeCloseTo(88 / 60, 6);
    expect(start.x).toBe(62 - 30 - 2);
  });

  it('segment bez šířky (skrytý přepínač) nic neanimuje', () => {
    expect(thumbHandoff({ left: 0, width: 0 }, third)).toEqual(THUMB_AT_REST);
    expect(thumbHandoff(first, { left: 0, width: 0 })).toEqual(THUMB_AT_REST);
  });
});

describe('segmentový přepínač jako navigace', () => {
  const source = readFileSync(
    join(import.meta.dirname, '..', 'components', 'ui', 'segmented-control.tsx'),
    'utf8',
  );

  it('palec se pohne hned při klepnutí, nečeká na odpověď serveru (R3-05)', () => {
    // výběr se kreslí z optimistického stavu, ne jen z `value`
    expect(source).toContain('setPending({ key: segment.key, from: value })');
    expect(source).toMatch(/const active = segment\.key === shown;/);
  });

  it('`aria-current` dál označuje stránku, která je opravdu na obrazovce', () => {
    expect(source).toContain("aria-current={segment.key === value ? 'page' : undefined}");
  });

  it('optimistický výběr se vrátí, když navigace nedopadne', () => {
    expect(source).toContain('useLinkStatus');
    expect(source).toMatch(/pending\.from === value/);
  });

  it('vybraný segment se srovná do zorného pole bez posunu stránky (R2-03)', () => {
    expect(source).toContain('scroller.scrollLeft =');
    // `scrollIntoView` by posunul i stránku, když přepínač leží pod ohybem
    expect(source.replace(/\/\/.*$/gm, '')).not.toContain('scrollIntoView');
  });

  it('palec jede pružinou zadanou fyzikou a přebírá rychlost', () => {
    expect(source).toContain('SPRING_QUICK');
    // rychlost z vlastních vzorků: `x.getVelocity()` po přesunu palce do jiného
    // segmentu vrací nulu (nově připojený prvek měření vynuluje)
    expect(source).toContain('releaseVelocity(flight.current');
    expect(source).toMatch(/animate\(x, 0, \{ \.\.\.SPRING_QUICK, velocity \}\)/);
    expect(source).not.toContain('layoutId');
  });
});
