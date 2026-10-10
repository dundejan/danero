import { describe, expect, it } from 'vitest';
import { plainTitle, tidy, withoutLawRefs } from '@/lib/typography';

const NBSP = ' ';

describe('tidy: jednopísmenné předložky, částky a paragrafy se nelámou', () => {
  it('za jednopísmennou předložkou je nezlomitelná mezera', () => {
    expect(tidy('Daně z investic hlídáme za tebe.')).toBe(`Daně z${NBSP}investic hlídáme za tebe.`);
    expect(tidy('O limitu se dozvíš')).toBe(`O${NBSP}limitu se dozvíš`);
  });

  it('dvě předložky za sebou dostanou obě', () => {
    // první verze zachytávala mezeru PŘED předložkou, takže druhá předložka
    // v řadě o tu svou přišla a zůstala s obyčejnou mezerou
    expect(tidy('automaticky — a u českých bank')).toBe(
      `automaticky — a${NBSP}u${NBSP}českých bank`,
    );
  });

  it('částka drží pohromadě i s jednotkou', () => {
    expect(tidy('Osvobození krypta — 100 000 Kč')).toBe(
      `Osvobození krypta — 100${NBSP}000${NBSP}Kč`,
    );
    expect(tidy('při 60, 85 a 100 % ti přijde e-mail')).toBe(
      `při 60, 85 a${NBSP}100${NBSP}% ti přijde e‑mail`,
    );
    expect(tidy('po 3 let držení, 15 ks')).toBe(`po 3${NBSP}let držení, 15${NBSP}ks`);
  });

  it('paragraf se neodtrhne od čísla', () => {
    expect(tidy('podle § 72 odst. 6 daňového řádu')).toBe(
      `podle §${NBSP}72 odst.${NBSP}6 daňového řádu`,
    );
  });

  it('běžná slova, letopočty a už nezlomitelné mezery nechává být', () => {
    expect(tidy('Za rok 2026 podáš daňové přiznání')).toBe('Za rok 2026 podáš daňové přiznání');
    expect(tidy(`limit 20${NBSP}000${NBSP}Kč`)).toBe(`limit 20${NBSP}000${NBSP}Kč`);
  });
});

describe('plainTitle: titulek upozornění bez obrázkového znaku', () => {
  it('znak na konci zmizí i s mezerou před ním', () => {
    expect(plainTitle('CRM: osvobozeno 🎉')).toBe('CRM: osvobozeno');
  });

  it('titulek bez znaku se nemění', () => {
    expect(plainTitle('Prolomen limit 50 000 Kč pro paušální daň')).toBe(
      'Prolomen limit 50 000 Kč pro paušální daň',
    );
  });
});

describe('withoutLawRefs: titulek řádku bez čísla paragrafu', () => {
  it('odkaz na paragraf v závorce zmizí, zbytek zůstane', () => {
    expect(withoutLawRefs('Prolomen limit 50 000 Kč pro daň rovnou paušální dani (§ 7a)')).toBe(
      'Prolomen limit 50 000 Kč pro daň rovnou paušální dani',
    );
  });

  it('jiné závorky nechává být', () => {
    expect(withoutLawRefs('Srážková daň nad smluvní strop (8×)')).toBe(
      'Srážková daň nad smluvní strop (8×)',
    );
  });
});
