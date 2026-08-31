import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { analyzeTaxYear } from '@danero/engine';
import { d, parseTransactions, type Transaction } from '@danero/shared';
import { ReportView } from '@/components/views/report-view';
import { createPgliteDb } from '@/db';
import { taxpayerProfiles, user } from '@/db/schema';
import { currentTaxYear, today } from '@/lib/clock';
import { isSellableTaxYear } from '@/lib/entitlements';
import { czk } from '@/lib/format';
import {
  engineInputForUser,
  getProfile,
  listPinnedTaxYears,
  pinTaxYear,
  type ProfileRow,
} from '@/lib/portfolio';
import { configForYear, isConfiguredTaxYear, LAST_CONFIGURED_TAX_YEAR } from '@/lib/tax-config';

/**
 * Co aplikace udělá 1. 1. 2027 — tedy v den, kdy přijde rok, pro který stát
 * ještě nevyhlásil ani hranici 23% sazby, ani výši paušální zálohy (R-15).
 *
 * Do 31. 8. 2026 se ten rok počítal recyklovanou konfigurací roku 2026, mlčky
 * a bez varování (nález K1-01), a hodiny se navíc četly v UTC, takže první
 * pražskou hodinu nového roku aplikace tvrdila, že je pořád loni (K1-05).
 * Testy si čas podstrčí přes `DANERO_NOW` (lib/clock.ts) — bez toho se přechod
 * roku otestovat nedal vůbec (K1-07).
 */

/** Pražská 00:30 na Nový rok 2027 — v UTC je to pořád 31. 12. 2026. */
const NOVOROCNI_PULNOC = '2026-12-31T23:30:00Z';
/** Silvestrovský podvečer v Praze — tentýž kalendářní den v UTC i v Praze. */
const SILVESTR = '2026-12-31T18:00:00Z';

const setNow = (iso: string): void => {
  process.env.DANERO_NOW = iso;
};

afterEach(() => {
  delete process.env.DANERO_NOW;
});

/**
 * Prodej v roce 2027 se ziskem 2 000 000 Kč: hranice 23% sazby (loni
 * 1 762 812 Kč) by na něj dopadla, kdyby se recyklovala — na výsledku je tedy
 * hned vidět, jestli se počítá loňským číslem, nebo poctivě celou nižší sazbou.
 */
const TXS_2027: Transaction[] = parseTransactions([
  {
    type: 'BUY',
    id: 'b1',
    isin: 'CZ0000000001',
    quantity: '100',
    pricePerShare: '10000',
    currency: 'CZK',
    tradeDate: '2027-01-11',
    settlementDate: '2027-01-13',
  },
  {
    type: 'SELL',
    id: 's1',
    isin: 'CZ0000000001',
    quantity: '100',
    pricePerShare: '30000',
    currency: 'CZK',
    tradeDate: '2027-06-10',
    settlementDate: '2027-06-14',
  },
]);

const PROFILE: ProfileRow = {
  userId: 'u1',
  regime: 'PAUSAL',
  hasBusinessAssets: false,
  w8benFiled: true,
  otherIncomeCzk: '0',
  matchingMethod: 'FIFO',
  fxMethod: 'UNIFIED',
  limit100kStrict: true,
  derivativesExpensesPerType: false,
  emtTimeTestExempt: false,
  returnOfCapitalReducesBasis: false,
  timeTestBasis: 'settlement',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('přechod roku: hodiny se čtou v české zóně (K1-05, K1-07)', () => {
  it('pražská 00:30 na Nový rok už patří novému roku, i když v UTC je pořád Silvestr', () => {
    setNow(NOVOROCNI_PULNOC);
    expect(today()).toBe('2027-01-01');
    expect(currentTaxYear()).toBe(2027);
    // kontrola, že podstrčený čas je opravdu ten sporný okamžik
    expect(new Date(NOVOROCNI_PULNOC).toISOString().slice(0, 10)).toBe('2026-12-31');
  });

  it('silvestrovský podvečer zůstává starým rokem', () => {
    setNow(SILVESTR);
    expect(today()).toBe('2026-12-31');
    expect(currentTaxYear()).toBe(2026);
  });

  it('podklady za právě skončený rok jdou v tu hodinu koupit', () => {
    setNow(NOVOROCNI_PULNOC);
    expect(isSellableTaxYear(2027)).toBe(true);
    expect(isSellableTaxYear(2026)).toBe(true);
    expect(isSellableTaxYear(2028)).toBe(false);
  });

  it('nesmyslné DANERO_NOW spadne zpátky na systémový čas, ne na „Invalid Date“', () => {
    setNow('vcera vecer');
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it(
    'fixace konfigurace se v tu hodinu zapíše — právě skončený rok už je uzavřený',
    { timeout: 30_000 },
    async () => {
      setNow(NOVOROCNI_PULNOC);
      const db = await createPgliteDb();
      await db.insert(user).values({ id: 'u1', name: 'Test', email: 'test@danero.cz' });
      await db.insert(taxpayerProfiles).values({ userId: 'u1', regime: 'PAUSAL' });
      const profile = (await getProfile(db, 'u1'))!;

      // bez explicitního currentYear → bere ho z hodin (tady je to celá pointa)
      const after = await pinTaxYear(db, profile, 2026);

      expect(after.pinnedTaxYears?.[2026]).toBeDefined();
      expect(await listPinnedTaxYears(db, 'u1')).toHaveLength(1);
    },
  );
});

describe('přechod roku: rok mimo registr konfigurací (R-15, K1-01)', () => {
  it('rok za registrem nenese ani hranici 23 %, ani výši paušální zálohy', () => {
    const rok = LAST_CONFIGURED_TAX_YEAR + 1;
    expect(isConfiguredTaxYear(rok)).toBe(false);
    const config = configForYear(rok);
    expect(config.progressiveThreshold).toBeNull();
    expect(config.flatTaxAdvance ?? null).toBeNull();
    // struktura právního stavu se ale přenáší (R-15b) — jinak by zmizely limity
    expect(config.limits.securitiesProceedsExemption).toBe('100000');
    expect(config.limits.flatTaxOtherIncome).toBe('50000');
    expect(config.cryptoRules.exemptionsAvailable).toBe(true);
  });

  it('roky v registru si drží svá vyhlášená čísla beze změny', () => {
    expect(configForYear(2024).progressiveThreshold).toBe('1582812');
    expect(configForYear(2025).progressiveThreshold).toBe('1676052');
    expect(configForYear(2026).progressiveThreshold).toBe('1762812');
    expect(configForYear(2026).flatTaxAdvance?.monthlyTotalCzk).toBe('9162');
  });

  it('rok před registrem taky nehádá — hranici 23 % pro něj neznáme', () => {
    expect(configForYear(2023).progressiveThreshold).toBeNull();
    expect(configForYear(2023).flatTaxAdvance ?? null).toBeNull();
    // a právní stav roku 2023: strop 40M ještě neplatil, krypto nemělo osvobození
    expect(configForYear(2023).limits.timeTestCap).toBeNull();
    expect(configForYear(2023).cryptoRules.exemptionsAvailable).toBe(false);
  });

  it('daň za rok 2027 se nespočítá loňskou hranicí a engine to řekne', () => {
    const result = analyzeTaxYear(engineInputForUser(TXS_2027, PROFILE, 2027));

    expect(result.securities.base10Czk.toString()).toBe('2000000');
    // loňská hranice by z 237 188 Kč nad ní udělala 23 % → 318 975,04 Kč
    expect(result.tax.general.taxCzk.toString()).toBe('300000');
    const warning = result.warnings.find((w) => w.code === 'PROGRESSIVE_THRESHOLD_UNKNOWN');
    expect(warning?.message).toContain('2027');
  });

  it('paušalistovi se nezapočtou zálohy, které pro ten rok neznáme', () => {
    const result = analyzeTaxYear(engineInputForUser(TXS_2027, PROFILE, 2027));
    const warning = result.warnings.find((w) => w.code === 'FLAT_TAX_BROKEN')!;

    expect(warning.message).toContain('Zálohy na daň za tento rok v konfiguraci nemáme');
    // věta o započtené záloze (a s ní loňských 9 162 Kč) se objevit nesmí
    expect(warning.message).not.toMatch(/paušální zálohy/);
    expect(result.limits.flatTax50k.breachImpact?.advancesCreditCzk.toString()).toBe('0');
    expect(result.limits.flatTax50k.breachImpact?.monthlyAdvanceCzk).toBeNull();
  });
});

describe('přechod roku: co uvidí uživatel v reportu za rok 2027 (R-15e)', () => {
  const html = (): string =>
    renderToStaticMarkup(
      createElement(ReportView, { txs: TXS_2027, profile: PROFILE, year: 2027, years: [2027] }),
    );

  it('report vysvětlí českou větou, že dvě čísla stát ještě nevyhlásil', () => {
    const out = html();
    expect(out).toContain('Pro rok 2027 ještě neznáme dvě státem vyhlašovaná čísla');
    // a řekne, co z toho plyne — bez daňového žargonu
    expect(out).toContain('hranice, nad kterou se z výdělku platí vyšší daň');
    expect(out).toContain('výši měsíční zálohy paušálního režimu');
  });

  it('report není prázdný — čísla, která na vyhlášení nezávisí, ukazuje dál', () => {
    const out = html();
    expect(out).toContain('Daňový report 2027');
    expect(out).toContain('Použité kurzy');
    // dílčí základ § 10 se spočítal normálně
    expect(out).toContain(czk(d('2000000')));
    expect(out).toContain(czk(d('300000')));
  });

  it('report za rok bez konfigurace neukáže loňskou hranici ani loňskou zálohu', () => {
    const out = html();
    // s recyklovanou hranicí 2026 by daň vyšla na 318 975,04 Kč
    expect(out).not.toContain(czk(d('318975.04')));
    expect(out).not.toContain(czk(d('9162')));
    expect(out).not.toContain(czk(d('1762812')));
  });

  it('rok v registru žádné takové vysvětlení nemá', () => {
    const out = renderToStaticMarkup(
      createElement(ReportView, { txs: TXS_2027, profile: PROFILE, year: 2026, years: [2026] }),
    );
    expect(out).not.toContain('státem vyhlašovaná čísla');
  });
});
