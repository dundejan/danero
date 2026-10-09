import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fxMethodLabel, mixesFxSystems, xmlBlockedByFxMix } from '@/lib/fx-method';

/**
 * R-06b (rozhodnutí R5): chybí-li denní kurz ČNB, engine u té transakce
 * použije jednotný kurz téhož roku a přidá varování. Report, tisk i XML do
 * revize 5 dál tvrdily jen zvolenou metodu — podklad pro finanční úřad tak
 * mohl nést čísla ze dvou kurzových soustav bez jediné poznámky.
 */
type FxResult = Parameters<typeof fxMethodLabel>[0];

const result = (fxMethod: 'UNIFIED' | 'CNB_DAILY', codes: string[] = []): FxResult =>
  ({
    options: { fxMethod },
    warnings: codes.map((code) => ({ code, severity: 'WARNING', message: code })),
  }) as unknown as FxResult;

const source = (...path: string[]): string =>
  readFileSync(join(import.meta.dirname, '..', ...path), 'utf8');

describe('označení kurzové soustavy říká, co čísla opravdu nesou (R-06b)', () => {
  it('čistá soustava se jmenuje tak jako dřív', () => {
    expect(fxMethodLabel(result('UNIFIED'))).toBe('jednotný kurz GFŘ');
    expect(fxMethodLabel(result('CNB_DAILY'))).toBe('denní kurzy ČNB');
    expect(mixesFxSystems(result('CNB_DAILY'))).toBe(false);
    expect(xmlBlockedByFxMix(result('CNB_DAILY'))).toBeNull();
  });

  it('denní kurzy s chybějícím kurzem: označení přizná jednotný kurz u části transakcí', () => {
    const mixed = result('CNB_DAILY', ['FX_DAILY_RATE_MISSING']);
    expect(mixesFxSystems(mixed)).toBe(true);
    expect(fxMethodLabel(mixed)).toContain('denní kurzy ČNB');
    expect(fxMethodLabel(mixed)).toContain('jednotný kurz GFŘ');
    expect(fxMethodLabel(mixed)).toContain('denní kurz chyběl');
  });

  it('a XML se nevydá — s radou, co udělat', () => {
    const reason = xmlBlockedByFxMix(result('CNB_DAILY', ['FX_DAILY_RATE_MISSING']));
    expect(reason).toContain('XML teď nevydáme');
    expect(reason).toContain('dvou kurzových soustav');
    expect(reason).toContain('jednotný kurz');
  });

  it('rada počítá se zafixovaným rokem — přepnutí kurzů se na něj samo nepropíše', () => {
    expect(xmlBlockedByFxMix(result('CNB_DAILY', ['FX_DAILY_RATE_MISSING']))).toContain('fixaci');
  });

  it('obráceně: jednotný kurz doplněný denním označení přizná, ale XML neblokuje', () => {
    // tabulka jednotných kurzů začíná rokem 2020; u nákupu ze starších let
    // engine po denním kurzu sahá vědomě a uživatel s tím nic nenadělá —
    // blokace by mu XML vzala natrvalo
    const mixed = result('UNIFIED', ['FX_UNIFIED_RATE_MISSING']);
    expect(fxMethodLabel(mixed)).toContain('denní kurz ČNB');
    expect(xmlBlockedByFxMix(mixed)).toBeNull();
  });

  it('varování druhé soustavy se k té zvolené nepočítá', () => {
    // varování o denním kurzu může vzniknout při srovnání variant, i když
    // zvolená metoda je jednotný kurz — ten výsledek smíšený není
    const unified = result('UNIFIED', ['FX_DAILY_RATE_MISSING']);
    expect(mixesFxSystems(unified)).toBe(false);
    expect(fxMethodLabel(unified)).toBe('jednotný kurz GFŘ');
  });

  it('jiná varování označení nemění', () => {
    expect(fxMethodLabel(result('CNB_DAILY', ['ASSET_CLASS_NORMALIZED']))).toBe('denní kurzy ČNB');
  });
});

describe('výstupy berou označení z jednoho místa', () => {
  it('report ani tisk nemají metodu natvrdo podle nastavení', () => {
    const report = source('components', 'views', 'report-view.tsx');
    expect(report).not.toMatch(/fxMethod === 'UNIFIED' \? 'jednotný kurz GFŘ' : 'denní kurzy ČNB'/);
    expect(report.match(/fxMethodLabel\(result\)/g)).toHaveLength(2);
  });

  it('export XML se před vydáním ptá, jestli výsledek nemíchá soustavy', () => {
    const route = source('app', 'api', 'epo', 'route.ts');
    const check = route.indexOf('xmlBlockedByFxMix(');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(route.indexOf('generateDpfdp7('));
    // a dřív, než rok zafixuje — odmítnutý export nemá nic zamykat
    expect(check).toBeLessThan(route.indexOf('pinTaxYear(db'));
  });

  it('věty odpovídají textům varování enginu (kódy se nepřejmenovaly)', () => {
    const fx = source('..', '..', 'packages', 'engine', 'src', 'fx', 'fx.ts');
    expect(fx).toContain("'FX_DAILY_RATE_MISSING'");
    expect(fx).toContain("'FX_UNIFIED_RATE_MISSING'");
  });
});
