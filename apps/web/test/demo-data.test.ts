import { describe, expect, it } from 'vitest';
import { d } from '@danero/shared';
import { compareVariants } from '@danero/engine';
import { demoDataset, demoToday } from '@/lib/demo-data';
import { analysisFingerprint } from '@/lib/engine-cache';
import { feesByYear } from '@/lib/charts-data';
import { analyzeForUser, availableYears, engineInputForUser, instrumentNames } from '@/lib/portfolio';
import { valuePositions } from '@/lib/portfolio-value';
import { computeNotificationCandidates } from '@/lib/notifications';
import { UNIFIED_RATES } from '@/lib/tax-config';

/**
 * Engine-validita demo datasetu v2: prohlídka musí věčně ukazovat týž příběh —
 * limit 100k v CRITICAL, prolomený limit 50k, krypto v zeleném, blížící se
 * osvobození, dividendy z několika států, 50+ otevřených pozic a aktivita
 * (prodeje, dividendy, poplatky) v KAŽDÉM roce Y−5…Y. Kontroluje se ve třech
 * okamžicích roku (začátek, střed, konec), protože datumy jsou relativní
 * k „dnešku“.
 */
const TODAYS = [
  demoToday(new Date('2026-01-02T10:00:00Z')),
  demoToday(new Date('2026-07-10T10:00:00Z')),
  demoToday(new Date('2026-12-31T10:00:00Z')),
];

describe.each(TODAYS)('demo dataset k %s', (today) => {
  const { txs, profile, prices, dailyRates } = demoDataset(today);
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

  it('limit 50k paušální daně je prolomený → verdikt „podáš přiznání“', () => {
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

  it('portfolio: 50+ oceněných pozic v hodnotě 2,3–2,5 mil. Kč', () => {
    const open = positions.filter((p) => p.totalRemaining.gt(0));
    expect(open.length).toBeGreaterThanOrEqual(50);

    const valuation = valuePositions(positions, labels, instrumentNames(txs), prices, year);
    expect(valuation.unpricedCount).toBe(0);
    // dolní mez drží tvrzení na landingu („50+ pozic za víc než 2,3 milionu Kč“) —
    // do 7. 8. 2026 tam byl odhad „zhruba 2 miliony“, který nic nehlídalo (E-48)
    expect(valuation.totalCzk.toNumber()).toBeGreaterThan(2_300_000);
    expect(valuation.totalCzk.toNumber()).toBeLessThan(2_500_000);
    // nerealizovaný P/L kladný i záporný
    expect(valuation.rows.some((row) => row.unrealized?.gt(0))).toBe(true);
    expect(valuation.rows.some((row) => row.unrealized?.lt(0))).toBe(true);
  });

  it('pestrost: 50+ instrumentů, frakční kusy, rozumný počet transakcí, poplatky', () => {
    const isins = new Set(txs.filter((tx) => 'isin' in tx && tx.isin).map((tx) => (tx as { isin: string }).isin));
    expect(isins.size).toBeGreaterThanOrEqual(52); // 51 pozic + uzavřená opce

    const fractional = positions.some((p) => !p.totalRemaining.isInteger());
    expect(fractional).toBe(true);

    // dataset se počítá per request — počet transakcí musí zůstat rozumný
    expect(txs.length).toBeGreaterThanOrEqual(200);
    expect(txs.length).toBeLessThanOrEqual(350);

    const withFee = txs.filter((tx) => (tx.type === 'BUY' || tx.type === 'SELL') && tx.fee);
    expect(withFee.length).toBeGreaterThan(10);
  });

  it('aktivita v každém roce Y−5 … Y: prodeje, dividendy i poplatky', () => {
    const years = availableYears(txs, year);
    expect(years.length).toBeGreaterThanOrEqual(6); // Y−5 … Y

    for (let offset = -5; offset <= 0; offset += 1) {
      const y = year + offset;
      const inYear = (date: string) => date.startsWith(`${y}-`);
      expect(
        txs.some((tx) => tx.type === 'SELL' && inYear(tx.tradeDate)),
        `prodej v roce ${y}`,
      ).toBe(true);
      expect(
        txs.some((tx) => tx.type === 'DIVIDEND' && inYear(tx.date)),
        `dividenda v roce ${y}`,
      ).toBe(true);
    }

    // poplatky žijí každý rok (graf poplatků nemá díry)
    const fees = feesByYear(txs);
    expect(fees.skippedCurrencies).toEqual([]);
    expect(fees.bars.map((bar) => bar.year)).toEqual(
      Array.from({ length: 6 }, (_, i) => year - 5 + i),
    );
    for (const bar of fees.bars) expect(bar.valueCzk, `poplatky ${bar.year}`).toBeGreaterThan(0);
  });

  it('přehled za historické roky ukazuje smysluplná čísla (tržby i dividendy)', () => {
    for (let offset = -5; offset <= -1; offset += 1) {
      const y = year + offset;
      const past = analyzeForUser(txs, profile, y, `${y}-12-31`);
      expect(past.result.securities.disposals.length, `prodeje CP ${y}`).toBeGreaterThan(0);
      expect(
        past.result.securities.totalGrossProceedsCzk.toNumber(),
        `tržby CP ${y}`,
      ).toBeGreaterThan(10_000);
      expect(past.result.dividends.items.length, `dividendy ${y}`).toBeGreaterThan(0);
      expect(past.result.dividends.base8Czk.toNumber(), `základ § 8 ${y}`).toBeGreaterThan(0);
    }
  });

  it('varianty párování mají v historii co ukázat: rok Y−1 dává různé základy', () => {
    // Y−1 prolomil limit 100k (prodej SHOP) → prodeje jsou zdanitelné a SHOP
    // se dvěma loty za různé ceny dělá rozdíl mezi FIFO (zisk) a LIFO (ztráta);
    // letošní rok zůstává celý osvobozený úhrnem (viz test CRITICAL výše)
    const past = analyzeForUser(txs, profile, year - 1, `${year - 1}-12-31`);
    expect(past.result.securities.exemptUnder100k).toBe(false);

    const { variants } = compareVariants(engineInputForUser(txs, profile, year - 1, dailyRates));
    const bases = new Set(
      variants.filter((v) => v.fxMethod === 'UNIFIED').map((v) => v.base10Czk.toFixed(0)),
    );
    expect(bases.size).toBeGreaterThan(1);
  });

  it('denní kurzy: syntetické, ±2 % od jednotného kurzu, varianty reportu 8×', () => {
    // kurz existuje pro datum transakce a drží se v pásmu ±2 % jednotného kurzu
    const buy = txs.find((tx) => tx.type === 'BUY' && tx.currency === 'USD')!;
    const date = buy.type === 'BUY' ? buy.tradeDate : '';
    const rate = dailyRates!.getRate('USD', date);
    expect(rate).toBeDefined();
    const unified = d(UNIFIED_RATES[Number(date.slice(0, 4))]!.USD!);
    expect(rate!.div(unified).sub(1).abs().toNumber()).toBeLessThanOrEqual(0.02);

    // srovnání variant: 4 metody párování × 2 metody kurzů = 8 řádků
    const { variants } = compareVariants(engineInputForUser(txs, profile, year, dailyRates));
    expect(variants).toHaveLength(8);
    expect(variants.filter((v) => v.fxMethod === 'CNB_DAILY')).toHaveLength(4);
    expect(variants.filter((v) => v.fxMethod === 'UNIFIED')).toHaveLength(4);
  });

  it('otisk pro engine cache je pro stejný „dnešek“ stabilní', () => {
    const again = demoDataset(today);
    expect(
      analysisFingerprint('demo', txs, profile, year, today, false),
    ).toBe(analysisFingerprint('demo', again.txs, again.profile, year, today, false));
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
