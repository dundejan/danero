import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { EngineWarning } from '@danero/engine';
import { opensByDefault, warningBody, WarningsList } from '@/components/warnings-list';

/**
 * Zobrazení kontrol výpočtu (nálezy R5-02, R2-12, R1B-20). Seskupení a souhrny
 * testuje `warnings-list.test.ts`; tady jde o to, co je vidět hned a jak se
 * text láme.
 */
const w = (over: Partial<EngineWarning>): EngineWarning => ({
  code: 'X',
  level: 'WARNING',
  message: 'x',
  ...over,
});

const NBSP = ' ';

const render = (warnings: EngineWarning[], more?: { label: string; href: string }): string =>
  renderToStaticMarkup(createElement(WarningsList, { warnings, labels: new Map(), more }));

/** Značka `<details>` řádku, který nese daný titulek. */
const detailsOf = (html: string, title: string): string => {
  const at = html.indexOf(title);
  expect(at, title).toBeGreaterThan(-1);
  const open = html.lastIndexOf('<details', at);
  expect(open).toBeGreaterThan(-1);
  return html.slice(open, html.indexOf('>', open) + 1);
};

describe('chyby jsou rozbalené, varování a informace sbalené (R5-02)', () => {
  it('rozhoduje jen úroveň', () => {
    expect(opensByDefault('ERROR')).toBe(true);
    expect(opensByDefault('WARNING')).toBe(false);
    expect(opensByDefault('INFO')).toBe(false);
  });

  const html = render([
    w({ code: 'E', level: 'ERROR', message: 'Chybí kurz: bez něj nejde přepočítat prodej.' }),
    w({ code: 'W', level: 'WARNING', message: 'Pozor na limit: zbývá málo.' }),
    w({ code: 'I', level: 'INFO', message: 'Pro informaci: nic se neděje.' }),
  ]);

  it('chyba má plné znění vidět hned', () => {
    expect(detailsOf(html, 'Chybí kurz')).toContain('open');
    expect(html).toContain('Chyba');
  });

  it('varování a informace zůstávají sbalené', () => {
    expect(detailsOf(html, 'Pozor na limit')).not.toContain('open');
    expect(detailsOf(html, 'Pro informaci')).not.toContain('open');
  });

  it('skupina s chybou je rozbalená i s výčtem případů', () => {
    const group = render([
      w({ code: 'G', level: 'ERROR', message: 'Prodáno víc: první' }),
      w({ code: 'G', level: 'ERROR', message: 'Prodáno víc: druhý' }),
    ]);
    expect(detailsOf(group, 'Prodáno víc')).toContain('open');
  });

  it('slovo závažnosti stojí jen u chyby — seznam vypadá stejně na přehledu i v reportu (R1B-20)', () => {
    expect(html).not.toContain('Upozornění');
    expect(html).not.toContain('>Info<');
    expect(html.match(/>Chyba</g)).toHaveLength(1);
  });
});

describe('text kontroly se neláme uprostřed částky (R2-12)', () => {
  // hlášky enginu mají v částkách obyčejné mezery
  const MESSAGE =
    'Prolomen limit 50 000 Kč pro paušální daň: zdanitelné příjmy činí 64 285 Kč a nárok na osvobození 100 000 Kč nemají.';
  const html = render([w({ code: 'L', message: MESSAGE })]);

  it('částka drží pohromadě v titulku i ve znění', () => {
    expect(html).toContain(`50${NBSP}000${NBSP}Kč`);
    expect(html).toContain(`64${NBSP}285${NBSP}Kč`);
    expect(html).toContain(`100${NBSP}000${NBSP}Kč`);
    expect(html).not.toContain('100 000 Kč');
  });

  it('drží i ve výčtu případů u skupiny', () => {
    const group = render([
      w({ code: 'G', message: 'Převod bez nabytí: 12 000 Kč' }),
      w({ code: 'G', message: 'Převod bez nabytí: 8 500 Kč' }),
    ]);
    expect(group).toContain(`12${NBSP}000${NBSP}Kč`);
    expect(group).toContain(`8${NBSP}500${NBSP}Kč`);
  });
});

describe('rozbalené znění neopakuje titulek (R1B-20)', () => {
  it('pokračování za dvojtečkou nebo pomlčkou začíná velkým písmenem', () => {
    expect(warningBody('Osvobozené příjmy 46 000 Kč: hlavní stablecoiny se počítají.', 'Osvobozené příjmy 46 000 Kč')).toBe(
      'Hlavní stablecoiny se počítají.',
    );
    expect(warningBody('1 pozice je stále otevřená — u futures se daní až uzavření.', '1 pozice je stále otevřená')).toBe(
      'U futures se daní až uzavření.',
    );
  });

  it('zdroj se nezkracuje, když jím titulek přesně nezačíná', () => {
    // titulek přišel o odkaz na paragraf — hláška by o něj přišla taky
    const message = 'Prolomen limit pro daň rovnou paušální dani (§ 7a): příjmy činí 60 000 Kč.';
    expect(warningBody(message, 'Prolomen limit pro daň rovnou paušální dani')).toBe(message);
    // lidský název kódu není začátek hlášky
    expect(warningBody('Dividenda X: sraženo 30 %.', 'Srážková daň nad smluvní strop')).toBe(
      'Dividenda X: sraženo 30 %.',
    );
    // hláška, která je celá titulkem, se nevyprázdní
    expect(warningBody('Jen titulek: ', 'Jen titulek')).toBe('Jen titulek: ');
  });

  it('ve vykresleném řádku stojí titulek jednou', () => {
    const html = render([
      w({ code: 'C', message: 'Osvobozené příjmy z krypta: stablecoiny se nepočítají.' }),
    ]).replaceAll(NBSP, ' ');
    expect(html.match(/Osvobozené příjmy z krypta/g)).toHaveLength(1);
    expect(html).toContain('Stablecoiny se nepočítají.');
  });
});

describe('odkaz na úplný seznam (R1B-20)', () => {
  it('přehled jím řekne, že report má kontrol víc', () => {
    const html = render([w({ message: 'Něco: podrobnosti.' })], {
      label: '1 další informace v reportu',
      href: '/report?rok=2026',
    });
    expect(html).toContain('href="/report?rok=2026"');
    expect(html).toContain('1 další informace v reportu');
  });

  it('bez něj zůstává jen cesta k metodice', () => {
    const html = render([w({ message: 'Něco: podrobnosti.' })]);
    expect(html).toContain('/jak-pocitame');
    expect(html).not.toContain('v reportu');
  });
});
