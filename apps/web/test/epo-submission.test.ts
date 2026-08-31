import { describe, expect, it } from 'vitest';
import { classifyResponse, parseChecks } from '@/lib/epo-submission';

/** Odpověď zkušební podatelny, jak vypadá v úspěšném běhu (jen informace o testu). */
const TEST_REZIM = `<?xml version="1.0" encoding="UTF-8"?>
<Odpoved><Chyby><Chyba Typ="I" Zkr="TEST_REZIM"><Text>Podání bylo přijato v testovacím režimu.</Text></Chyba></Chyby></Odpoved>`;

const VECNA_CHYBA = `<?xml version="1.0" encoding="UTF-8"?>
<Odpoved><Chyby><Chyba Typ="I" Zkr="TEST_REZIM"><Text>Testovací režim.</Text></Chyba>
<Chyba Typ="N" Polozka="kc_zbyvpred" Zkr="P7_91"><Text>Oddíl 7/ř.91 - hodnota položky se nerovná hodnotě vzorce.</Text></Chyba></Chyby></Odpoved>`;

/** Údržbová stránka ADIS: stav 200, ale ani jedna kontrola v těle. */
const UDRZBA = '<html><body><h1>Systém je z důvodu údržby nedostupný.</h1></body></html>';

describe('K3-12: výpadek podatelny není odmítnutí obsahu', () => {
  it('kontroly se vytáhnou i s atributy a dekódovanými entitami', () => {
    const checks = parseChecks(VECNA_CHYBA);
    expect(checks).toHaveLength(2);
    expect(checks[1]).toMatchObject({ Typ: 'N', Polozka: 'kc_zbyvpred', Zkr: 'P7_91' });
    expect(checks[1]!.text).toContain('ř.91');
  });

  it('jen informace a propustné chyby → podání je v pořádku', () => {
    expect(classifyResponse({ status: 200, body: TEST_REZIM }).verdict).toBe('ok');
  });

  it('věcná chyba typu N → odmítnuto (verdikt podatelna opravdu vydala)', () => {
    expect(classifyResponse({ status: 200, body: VECNA_CHYBA }).verdict).toBe('rejected');
  });

  it('neznámý typ kontroly blokuje — allowlist, ne denylist (A3-02)', () => {
    const kriticka = TEST_REZIM.replace('Typ="I"', 'Typ="K"');
    expect(classifyResponse({ status: 200, body: kriticka }).verdict).toBe('rejected');
  });

  it('HTTP 503 je nedostupná služba, ne odmítnuté XML', () => {
    const result = classifyResponse({ status: 503, body: 'Service Unavailable' });
    expect(result.verdict).toBe('unreachable');
    expect(result.reason).toContain('503');
  });

  it('údržbová stránka se stavem 200 je taky nedostupnost — v těle není jediná kontrola', () => {
    const result = classifyResponse({ status: 200, body: UDRZBA });
    expect(result.verdict).toBe('unreachable');
    expect(result.reason).toContain('Chyba');
  });
});
