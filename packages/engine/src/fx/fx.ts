import { addDays, d, yearOf, type IsoDate, type Money } from '@danero/shared';
import type { FxMethod } from '../config/options';
import type { TaxYearConfig } from '../config/taxYear';
import { czDateText } from '../format';
import { EngineError, WarningCollector } from '../warnings';

export interface DailyRateProvider {
  /** Kurz CZK za 1 jednotku měny k danému dni; undefined, pokud pro den není vyhlášen. */
  getRate(currency: string, date: IsoDate): Money | undefined;
}

export class FxConverter {
  constructor(
    private readonly config: TaxYearConfig,
    private readonly method: FxMethod,
    private readonly warnings: WarningCollector,
    private readonly daily?: DailyRateProvider,
  ) {}

  toCzk(amount: Money, currency: string, date: IsoDate): Money {
    if (currency === 'CZK') return amount;
    // GBX = pence sterling (kotace londýnských akcií, 1/100 GBP) — kurz existuje jen pro GBP
    if (currency === 'GBX') return this.toCzk(amount.div(100), 'GBP', date);
    const rate =
      this.method === 'UNIFIED' ? this.unifiedRate(currency, date) : this.dailyRate(currency, date);
    return amount.mul(rate);
  }

  /** R-06a: jednotný kurz roku, do kterého transakce spadá. */
  private unifiedRate(currency: string, date: IsoDate): Money {
    const year = yearOf(date);
    const rate = this.config.unifiedRatesByYear[year]?.[currency];
    if (rate !== undefined) return d(rate);
    const fallback = this.lookupDaily(currency, date);
    if (fallback) {
      this.warnings.add(
        'FX_UNIFIED_RATE_MISSING',
        'WARNING',
        `Jednotný kurz pro ${currency}/${year} není v konfiguraci — použit denní kurz ČNB k ${czDateText(date)}. Metody kurzů se nesmí v jednom roce kombinovat (§ 38 odst. 1), doplň tabulku kurzů.`,
        { currency, year },
      );
      return fallback;
    }
    throw new EngineError(
      'FX_RATE_MISSING',
      `Chybí jednotný kurz pro ${currency} v roce ${year} a denní kurz není k dispozici.`,
    );
  }

  /** R-06b: denní kurz ČNB; o víkendech/svátcích se hledá poslední vyhlášený (max 10 dní zpět). */
  private dailyRate(currency: string, date: IsoDate): Money {
    const rate = this.lookupDaily(currency, date);
    if (rate) return rate;
    const unified = this.config.unifiedRatesByYear[yearOf(date)]?.[currency];
    if (unified !== undefined) {
      this.warnings.add(
        'FX_DAILY_RATE_MISSING',
        'WARNING',
        `Denní kurz ${currency} k ${czDateText(date)} není k dispozici — použit jednotný kurz. Metody kurzů se nesmí v jednom roce kombinovat (§ 38 odst. 1), doplň denní kurzy.`,
        { currency, date },
      );
      return d(unified);
    }
    throw new EngineError(
      'FX_RATE_MISSING',
      `Chybí denní i jednotný kurz pro ${currency} k ${date}.`,
    );
  }

  private lookupDaily(currency: string, date: IsoDate): Money | undefined {
    if (!this.daily) return undefined;
    let cursor = date;
    for (let i = 0; i <= 10; i += 1) {
      const rate = this.daily.getRate(currency, cursor);
      if (rate) return rate;
      cursor = addDays(cursor, -1);
    }
    return undefined;
  }
}

/** Provider nad mapou `"MĚNA:YYYY-MM-DD"` → kurz — pro testy a data načtená z DB. */
export class MapRateProvider implements DailyRateProvider {
  constructor(private readonly rates: Record<string, string>) {}

  getRate(currency: string, date: IsoDate): Money | undefined {
    const value = this.rates[`${currency}:${date}`];
    return value === undefined ? undefined : d(value);
  }
}
