import type { Money } from '@danero/shared';
import { czk } from '@/lib/format';

/**
 * Jména limitů — jedno pro každý limit, stejné na přehledu, v reportu
 * i v simulátoru (nález R1B-10).
 *
 * Do 10. 10. 2026 se týž limit jmenoval pokaždé jinak: „Osvobození prodejů
 * cenných papírů“ v seznamu limitů, „úhrn 100 000 Kč“ v nadpisu simulátoru,
 * „Limit 100 000 Kč“ v metodě výpočtu; paušální limit byl „Limit paušální
 * daně“, „limit 50 000 Kč pro paušální daň“ i „Paušální limit“. Čtenář hledal
 * rozdíl, který není.
 *
 * Jméno je bez částky — ta se rok od roku mění (limity § 38g od roku 2027)
 * a připojuje se ze stavu limitu (`limitWithAmount`).
 */
export const LIMIT_NAME = {
  FLAT_TAX: 'Limit paušální daně',
  EMPLOYEE_SIDE_INCOME: 'Limit vedlejších příjmů',
  GENERAL_FILING: 'Limit pro podání přiznání',
  SECURITIES: 'Osvobození prodejů cenných papírů',
  CRYPTO: 'Osvobození krypta',
} as const;

export type LimitKind = keyof typeof LIMIT_NAME;

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/** Jméno limitu uprostřed věty, s částkou: „limit paušální daně (50 000 Kč)“. */
export const limitWithAmount = (kind: LimitKind, limitCzk: Money): string =>
  `${lowerFirst(LIMIT_NAME[kind])} (${czk(limitCzk)})`;

/** Titulek detailu limitu: „Limit paušální daně — 50 000 Kč“. */
export const limitTitle = (kind: LimitKind, limitCzk: Money): string =>
  `${LIMIT_NAME[kind]} — ${czk(limitCzk)}`;
