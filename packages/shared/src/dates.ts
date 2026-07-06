/**
 * Práce s daty výhradně přes ISO řetězce `YYYY-MM-DD` (bez časových zón).
 * ISO řetězce se porovnávají lexikograficky, takže `<`, `>`, `===` fungují přímo.
 */
export type IsoDate = string;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(value: string): IsoDate {
  if (!ISO_DATE_RE.test(value)) {
    throw new Error(`Neplatné datum "${value}" — očekáván formát YYYY-MM-DD`);
  }
  return value;
}

const pad = (n: number): string => String(n).padStart(2, '0');

export const yearOf = (date: IsoDate): number => Number(date.slice(0, 4));

export function addDays(date: IsoDate, days: number): IsoDate {
  const dt = new Date(`${date}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Přičte kalendářní roky; přetečení měsíce (29. 2.) se zarovná na poslední den měsíce.
 * Pro časový test (R-01) je toto zarovnání konzervativní (osvobození o den později).
 */
export function addYears(date: IsoDate, years: number): IsoDate {
  const [y, m, day] = date.split('-').map(Number) as [number, number, number];
  const targetYear = y + years;
  const daysInMonth = new Date(Date.UTC(targetYear, m, 0)).getUTCDate();
  return `${targetYear}-${pad(m)}-${pad(Math.min(day, daysInMonth))}`;
}

/** Přičte pracovní dny (přeskakuje so+ne; svátky neřeší — aproximace pro dopočet vypořádání). */
export function addBusinessDays(date: IsoDate, days: number): IsoDate {
  let current = date;
  let remaining = days;
  while (remaining > 0) {
    current = addDays(current, 1);
    const dow = new Date(`${current}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return current;
}

/** Počet dní od `from` do `to` (kladný, když `to` je později). */
export function diffDays(from: IsoDate, to: IsoDate): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}
