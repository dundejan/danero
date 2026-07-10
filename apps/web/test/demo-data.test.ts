import { describe, expect, it } from 'vitest';
import { demoDataset, demoToday } from '@/lib/demo-data';
import { analyzeForUser, availableYears, instrumentNames } from '@/lib/portfolio';
import { valuePositions } from '@/lib/portfolio-value';
import { computeNotificationCandidates } from '@/lib/notifications';

/**
 * Engine-validita demo datasetu: prohlídka musí věčně ukazovat týž příběh —
 * limit 100k v CRITICAL, prolomený limit 50k, krypto v zeleném, blížící se
 * osvobození a dividendy z několika států. Kontroluje se ve třech okamžicích
 * roku (začátek, střed, konec), protože datumy jsou relativní k „dnešku".
 */
const TODAYS = [
  demoToday(new Date('2026-01-02T10:00:00Z')),
  demoToday(new Date('2026-07-10T10:00:00Z')),
  demoToday(new Date('2026-12-31T10:00:00Z')),
];

describe.each(TODAYS)('demo dataset k %s', (today) => {
  const { txs, profile, prices } = demoDataset(today);
  const year = Number(today.slice(0, 4));
  const analysis = analyzeForUser(txs, profile, year, today);
  const { result, positions, labels } = analysis;

  it('projde enginem bez ERROR varování', () => {
    const errors = result.warnings.filter((w) => w.level === 'ERROR');
    expect(errors, JSON.stringify(errors, null, 2)).toHaveLength(0);
  });

  it('varování o srážce nad smlouvu je záměr (US 30 % bez W-8BEN, DE, NL)', () => {
    expect(result.warnings.some((w) => w.code === 'WITHHOLDING_ABOVE_TREATY')).toBe(true);
  });

  it('limit 100k pro CP je v pásmu CRITICAL (oranžová odměrka)', () => {
    expect(result.limits.limit100k.zone).toBe('CRITICAL');
    expect(result.limits.limit100k.ratio).toBeGreaterThan(0.85);
    expect(result.limits.limit100k.ratio).toBeLessThanOrEqual(1);
    // do 100k včetně → letošní prodeje CP jsou osvobozené úhrnem
    expect(result.securities.exemptUnder100k).toBe(true);
  });

  it('limit 50k paušální daně je prolomený → verdikt „podáš přiznání"', () => {
    expect(result.limits.flatTax50k.applicable).toBe(true);
    expect(result.limits.flatTax50k.status.exceeded).toBe(true);
    // s rezervou na roční posun orientačních kurzů, ale ne přestřelený
    expect(result.limits.flatTax50k.status.ratio).toBeGreaterThan(1);
    expect(result.limits.flatTax50k.status.ratio).toBeLessThan(1.6);
  });

  it('krypto limit je v zeleném (prodej BTC osvobozen úhrnem do 100k)', () => {
    expect(result.limits.cryptoLimit100k.zone).toBe('OK');
    expect(result.crypto.exemptUnder100k).toBe(true);
    expect(result.crypto.disposals.length).toBeGreaterThan(0);
  });

  it('orientační daň je kladná (deriváty + dividendy)', () => {
    const tax =
      result.tax.recommended === 'GENERAL' ? result.tax.general.taxCzk : result.tax.separate16a.taxCzk;
    expect(tax.gt(0)).toBe(true);
  });

  it('deriváty: uzavřený obchod v reportu i otevřená pozice v portfoliu', () => {
    expect(result.derivatives.items.length).toBeGreaterThan(0);
    expect(result.derivatives.openPositions.length).toBeGreaterThan(0);
  });

  it('aspoň jedna pozice je celá osvobozená a jedné doběhne test do 14 dní', () => {
    const fullyExempt = positions.filter(
      (p) => p.totalRemaining.gt(0) && p.lots.every((lot) => lot.isExempt),
    );
    expect(fullyExempt.length).toBeGreaterThan(0);

    const soon = positions.flatMap((p) => p.lots).filter(
      (lot) => !lot.isExempt && lot.daysToExempt <= 14,
    );
    expect(soon.length).toBeGreaterThan(0);
  });

  it('horizont osvobození žije v různých vzdálenostech (~12 dní až ~2 roky)', () => {
    const pendingDays = positions
      .flatMap((p) => p.lots)
      .filter((lot) => !lot.isExempt)
      .map((lot) => lot.daysToExempt);
    expect(pendingDays.some((days) => days <= 14)).toBe(true); // CSPX
    expect(pendingDays.some((days) => days > 30 && days <= 100)).toBe(true); // MSFT ~2 měsíce
    expect(pendingDays.some((days) => days > 150 && days <= 300)).toBe(true); // NVDA ~8 měsíců
    expect(pendingDays.some((days) => days > 600)).toBe(true); // VUAA ~2 roky
  });

  it('dividendy přišly aspoň ze 4 států', () => {
    const countries = Object.keys(result.dividends.creditableByCountry);
    expect(countries.length).toBeGreaterThanOrEqual(4);
    expect(countries).toEqual(expect.arrayContaining(['US', 'DE', 'NL', 'JP']));
  });

  it('portfolio má ceny pro všechny pozice a hodnotu ~1,2 mil. Kč', () => {
    const valuation = valuePositions(positions, labels, instrumentNames(txs), prices, year);
    expect(valuation.unpricedCount).toBe(0);
    expect(valuation.totalCzk.toNumber()).toBeGreaterThan(900_000);
    expect(valuation.totalCzk.toNumber()).toBeLessThan(1_500_000);
    // nerealizovaný P/L kladný i záporný
    expect(valuation.rows.some((row) => row.unrealized?.gt(0))).toBe(true);
    expect(valuation.rows.some((row) => row.unrealized?.lt(0))).toBe(true);
  });

  it('pestrost: 18–22 instrumentů, frakční kusy, roky Y−5 až Y, poplatky', () => {
    const isins = new Set(txs.filter((tx) => 'isin' in tx && tx.isin).map((tx) => (tx as { isin: string }).isin));
    expect(isins.size).toBeGreaterThanOrEqual(18);
    expect(isins.size).toBeLessThanOrEqual(22);

    const fractional = positions.some((p) => !p.totalRemaining.isInteger());
    expect(fractional).toBe(true);

    const years = availableYears(txs, year);
    expect(years.length).toBeGreaterThanOrEqual(6); // Y−5 … Y

    const withFee = txs.filter((tx) => (tx.type === 'BUY' || tx.type === 'SELL') && tx.fee);
    expect(withFee.length).toBeGreaterThan(10);
  });

  it('hlídač nad demo daty vyrobí upozornění (limity + časové testy)', () => {
    const candidates = computeNotificationCandidates({
      result,
      positions,
      labels,
      today,
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((c) => c.type === 'LIMIT_EXCEEDED')).toBe(true); // 50k
    expect(candidates.some((c) => c.type === 'LIMIT_CRITICAL')).toBe(true); // 100k
  });
});

it('demoToday drží rok s dostupnými kurzy a zvládá přestupný den', () => {
  expect(demoToday(new Date('2026-05-04T10:00:00Z'))).toBe('2026-05-04');
  // rok bez kurzů se přiskřípne na poslední známý
  expect(demoToday(new Date('2099-02-28T10:00:00Z')).slice(5)).toBe('02-28');
  expect(Number(demoToday(new Date('2099-06-01T00:00:00Z')).slice(0, 4))).toBeLessThan(2099);
});
