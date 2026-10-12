import { describe, expect, it } from 'vitest';
import {
  projectMomentum,
  releaseVelocity,
  rubberBand,
  spring,
  SPRING_DEFAULT,
  SPRING_MOMENTUM,
  SPRING_QUICK,
} from '@/lib/motion';

describe('pružiny rozhraní', () => {
  it('jsou zadané fyzikou, ne časem (R3-04)', () => {
    // `motion` 14 pružině zadané přes `duration`/`bounce` počáteční rychlost
    // zahazuje — sheet po puštění narazil „do zdi“. Kdo sem vrátí časový zápis,
    // rozbije předání rychlosti prstu, a nespadne na tom nic jiného než tohle.
    for (const config of [SPRING_DEFAULT, SPRING_QUICK, SPRING_MOMENTUM]) {
      expect(config.type).toBe('spring');
      expect(config.stiffness).toBeGreaterThan(0);
      expect(config.damping).toBeGreaterThan(0);
      expect(config.mass).toBe(1);
      expect(config).not.toHaveProperty('duration');
      expect(config).not.toHaveProperty('bounce');
      expect(config).not.toHaveProperty('visualDuration');
    }
  });

  it('převádí tlumení a odezvu na tuhost a tlumení pružiny', () => {
    // tuhost = (2π / odezva)², tlumení = 4π · ζ / odezva při hmotnosti 1
    const sheet = spring(0.8, 0.3);
    expect(sheet.stiffness).toBeCloseTo(438.6, 0);
    expect(sheet.damping).toBeCloseTo(33.5, 1);
    const tap = spring(1, 0.35);
    expect(tap.stiffness).toBeCloseTo(322.3, 0);
    expect(tap.damping).toBeCloseTo(35.9, 1);
  });

  it('bez překmitu všude kromě puštění z tahu', () => {
    const ratio = (config: { stiffness: number; damping: number }) =>
      config.damping / (2 * Math.sqrt(config.stiffness));
    expect(ratio(SPRING_DEFAULT)).toBeCloseTo(1, 5);
    expect(ratio(SPRING_QUICK)).toBeCloseTo(1, 5);
    expect(ratio(SPRING_MOMENTUM)).toBeCloseTo(0.8, 5);
  });

  it('odchod a malý častý pohyb jsou rychlejší než příchod', () => {
    expect(SPRING_QUICK.stiffness).toBeGreaterThan(SPRING_DEFAULT.stiffness);
  });
});

describe('rychlost při puštění', () => {
  const steady = (from: number, step: number, count: number, interval = 16) =>
    Array.from({ length: count }, (_, index) => ({
      time: index * interval,
      offset: from + index * step,
    }));

  it('odpovídá rychlosti prstu v posledních vzorcích', () => {
    // 20 px za snímek při 60 Hz = 1 250 px/s
    const samples = steady(0, 20, 6);
    expect(releaseVelocity(samples, samples.at(-1)!.time + 4)).toBeCloseTo(1250, 0);
  });

  it('prst, který před puštěním zastavil, nic neodhazuje (R3-07)', () => {
    // dřív se okno počítalo od posledního POHYBU, takže rychlý tah následovaný
    // půlvteřinovým držením sheet po puštění odhodil
    const samples = steady(0, 20, 6);
    expect(releaseVelocity(samples, samples.at(-1)!.time + 600)).toBe(0);
    expect(releaseVelocity(samples, samples.at(-1)!.time + 100)).toBe(0);
  });

  it('po obrácení směru platí nový směr, ne průměr obou', () => {
    // pomalu dolů, pak čtyři rychlé kroky nahoru — stará část tahu se do
    // rychlosti nesmí míchat, jinak by hod nahoru vyšel poloviční
    const down = steady(0, 10, 12, 12);
    const turn = down.at(-1)!;
    const up = Array.from({ length: 4 }, (_, index) => ({
      time: turn.time + (index + 1) * 16,
      offset: turn.offset - (index + 1) * 24,
    }));
    const velocity = releaseVelocity([...down, ...up].slice(-8), up.at(-1)!.time + 2);
    expect(velocity).toBeLessThan(-1200);
  });

  it('bez pohybu je nulová', () => {
    expect(releaseVelocity([], 0)).toBe(0);
    expect(releaseVelocity([{ time: 10, offset: 5 }], 12)).toBe(0);
  });
});

describe('hybnost a odpor na hraně', () => {
  it('promítne rychlost dopředu jako doběh rolování', () => {
    expect(projectMomentum(1000)).toBeCloseTo(499, 0);
    expect(projectMomentum(-1000)).toBeCloseTo(-499, 0);
    expect(projectMomentum(0)).toBe(0);
  });

  it('za hranou klade rostoucí odpor', () => {
    const near = rubberBand(-50, 400);
    const far = rubberBand(-150, 400);
    expect(near).toBeGreaterThan(-50);
    expect(far).toBeGreaterThan(-150);
    // dál za hranou sleduje prst hůř než blíž
    expect(far / -150).toBeLessThan(near / -50);
  });
});
