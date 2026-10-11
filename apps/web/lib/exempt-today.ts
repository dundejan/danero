import { ZERO, type Money } from '@danero/shared';
import { czk, pct, plural, qty } from '@/lib/format';

/**
 * Číslo „Bez daně už dnes“ na portfoliu: kolik z toho, co držíš, jde dnes
 * prodat bez daně (kusy po tříletém časovém testu).
 *
 * Částku umíme jen u pozic s cenou od brokera — a kdo jen nahrává výpisy,
 * nemá cenu žádnou. Do 11. 10. 2026 se v takovém a smíšeném portfoliu psalo
 * „0 Kč · 0 % z oceněných pozic · 3 bez ceny“: nula vypadala jako výsledek,
 * přitom jen chyběly ceny u pozic, které kusy bez daně mají. Pravidla:
 *
 * - **částka je úplná**, když žádná pozice BEZ ceny kusy bez daně nemá —
 *   pozice bez ceny, která na osvobození teprve čeká, do částky nepatří ani
 *   s cenou;
 * - **částka má díru**, když takové pozice jsou — řekne se, kolik jich chybí;
 * - **částka by byla 0 Kč jen proto, že chybí ceny** (nebo není cena žádná) —
 *   místo nuly stojí počet pozic, které kusy bez daně mají. Kusy různých
 *   titulů se nesčítají (R2-10); počet kusů se píše jen u jediné pozice.
 *
 * Čistá funkce nad oceněním — žádný nový přepočet, jen to, co už stránka má.
 */
export interface ExemptTodayRow {
  quantity: Money;
  exemptQuantity: Money;
  /** Hodnota pozice v CZK; chybí, když broker cenu nedodal nebo měna nemá kurz. */
  valueCzk?: Money;
}

export interface ExemptToday {
  value: string;
  note?: string;
  /** Zelená jen pro skutečně pozitivní stav — nula není úspěch. */
  positive: boolean;
  /** Kolik pozic s kusy bez daně v částce chybí, protože nemají cenu. */
  missing: number;
}

const positionsWord = (count: number): string => plural(count, 'pozice', 'pozice', 'pozic');

export function exemptToday(rows: readonly ExemptTodayRow[]): ExemptToday | null {
  if (rows.length === 0) return null;

  const priced = rows.filter((row) => row.valueCzk !== undefined);
  const withExempt = rows.filter((row) => row.exemptQuantity.gt(0));
  const missing = withExempt.filter((row) => row.valueCzk === undefined).length;
  const positive = withExempt.length > 0;

  const totalCzk = priced.reduce((sum, row) => sum.plus(row.valueCzk!), ZERO);
  const exemptCzk = priced.reduce(
    (sum, row) =>
      row.quantity.gt(0) ? sum.plus(row.valueCzk!.mul(row.exemptQuantity).div(row.quantity)) : sum,
    ZERO,
  );

  // částka má smysl, když ji aspoň jedna oceněná pozice tvoří, nebo když je
  // nula pravdivá (všechno oceněné a nic bez daně; pozice bez ceny nic nedluží)
  if (priced.length > 0 && (exemptCzk.gt(0) || missing === 0)) {
    const share = totalCzk.gt(0) ? pct(exemptCzk.div(totalCzk).mul(100).toNumber(), 1) : null;
    const note =
      missing > 0
        ? `chybí ${missing} ${positionsWord(missing)} bez ceny`
        : share === null
          ? undefined
          : priced.length === rows.length
            ? `${share} portfolia`
            : `${share} z oceněných pozic`;
    return { value: czk(exemptCzk), note, positive, missing };
  }

  // jediná pozice bez ceny: kusy téhož titulu sečíst jde
  const [only, ...others] = rows;
  if (only && others.length === 0) {
    return {
      value: `${qty(only.exemptQuantity)} z ${qty(only.quantity)} ks`,
      positive,
      missing,
    };
  }

  // víc titulů a částku nemáme z čeho složit: počet pozic, ne „0 Kč“
  return {
    value: `${withExempt.length} z ${rows.length} pozic`,
    note: positive ? (priced.length > 0 ? 'aspoň zčásti · bez ceny' : 'aspoň zčásti') : undefined,
    positive,
    missing,
  };
}
