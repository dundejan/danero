import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toolbarShape } from '@/components/app-skeleton';
import { activeNavHref, APP_NAV_ITEMS, DEMO_NAV_ITEMS } from '@/components/nav-items';
import { NOT_TAX_ADVICE } from '@/components/shell-disclaimer';

const read = (relative: string): string =>
  readFileSync(join(import.meta.dirname, '..', relative), 'utf8');

describe('navigace aplikace', () => {
  it('sekce má jedno jméno — na telefonu se nejmenuje jinak (R1B-09)', () => {
    for (const item of [...APP_NAV_ITEMS, ...DEMO_NAV_ITEMS]) {
      // kratší popisek pro spodní lištu býval „Simulace“ vedle „Simulátor“
      expect(item).not.toHaveProperty('short');
      expect(item.label).not.toBe('Simulace');
    }
    expect(APP_NAV_ITEMS.find((item) => item.href === '/simulator')?.label).toBe('Simulátor');
    expect(DEMO_NAV_ITEMS.find((item) => item.href === '/demo/simulator')?.label).toBe('Simulátor');
    expect(read('components/nav-rail.tsx')).not.toContain('item.short');
  });

  it('aktivní položka podle adresy, i na podstránce', () => {
    expect(activeNavHref(APP_NAV_ITEMS, '/portfolio/IE00B5BMR087')).toBe('/portfolio');
    expect(activeNavHref(APP_NAV_ITEMS, '/nastaveni/ucet')).toBe('/nastaveni');
    expect(activeNavHref(DEMO_NAV_ITEMS, '/demo/report')).toBe('/demo/report');
    expect(activeNavHref(APP_NAV_ITEMS, '/neznama')).toBeUndefined();
  });

  it('uvítání nového účtu patří pod přehled — nějaká položka je zvýrazněná vždy (R1B-29)', () => {
    expect(activeNavHref(APP_NAV_ITEMS, '/vitejte')).toBe('/prehled');
  });

  it('sheet „Více“ na telefonu nabízí odhlášení (R1B-08)', () => {
    const source = read('components/nav-rail.tsx');
    const sheet = source.slice(source.indexOf('<Sheet'), source.indexOf('</Sheet>'));
    expect(sheet).toContain('<SignOutButton');
    // adresa účtu se zalamuje celá, nezkracuje se
    expect(sheet).toContain('{accountEmail}');
    expect(sheet).not.toContain('truncate');
  });

  it('zavíraný sheet jde hodem vrátit a rodič se o tom dozví', () => {
    for (const file of ['components/nav-rail.tsx', 'components/ui/info-popover.tsx']) {
      expect(read(file), file).toContain('onReopen=');
    }
  });
});

describe('skořápka aplikace', () => {
  it('výhradu „není daňové poradenství“ má aplikace i demo — krátce a odkazem na podmínky (R1B-23, R5-01)', () => {
    // přihlášený uživatel ji dřív neměl vůbec; demo mělo celou větu
    expect(NOT_TAX_ADVICE).toEqual({ href: '/podminky', label: 'Není daňové poradenství' });
    for (const file of ['app/(app)/layout.tsx', 'app/demo/layout.tsx']) {
      const source = read(file);
      expect(source, file).toContain('NOT_TAX_ADVICE');
      // dlouhé znění patří do podmínek užití, ne do patičky každé stránky
      expect(source, file).not.toContain('výpočetní a evidenční nástroj');
      expect(source, file).not.toContain('odpovídá poplatník');
    }
  });

  it('pruh dema se netiskne (R2-30)', () => {
    const layout = read('app/demo/layout.tsx');
    const banner = layout.slice(layout.indexOf('<header'), layout.indexOf('</header>'));
    expect(banner).toContain('print:hidden');
  });

  it('odkazy v pruhu a patičce dema reagují na stisk (R3-11)', () => {
    const layout = read('app/demo/layout.tsx');
    const links = [...layout.matchAll(/<Link[\s\S]*?className="([^"]*)"/g)].map((match) => match[1]!);
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const className of links) expect(className).toContain('active:');
  });
});

describe('kostra načítání', () => {
  it('lišta kostry má na telefonu stejné řádky jako hotová stránka (R3-08)', () => {
    // Přehled: přepínač roku na druhém řádku + tlačítko; kostra s jedním
    // řádkem byla o 52 px nižší a obsah po načtení poskočil
    expect(toolbarShape('/prehled')).toEqual({ switcher: true, action: true });
    expect(toolbarShape('/demo/prehled')).toEqual({ switcher: true, action: true });
    expect(toolbarShape('/report')).toEqual({ switcher: true, action: true });
    expect(toolbarShape('/demo/report')).toEqual({ switcher: true, action: false });
    expect(toolbarShape('/nastaveni/upozorneni')).toEqual({ switcher: true, action: false });
    expect(toolbarShape('/demo/portfolio/IE00B5BMR087')).toEqual({ switcher: false, action: true });
    expect(toolbarShape('/portfolio')).toEqual({ switcher: false, action: false });
    expect(toolbarShape('/simulator')).toEqual({ switcher: false, action: false });
  });

  it('kostra je vysoká aspoň jako okno — patička při načítání nevyskočí do obrazovky', () => {
    expect(read('components/app-skeleton.tsx')).toMatch(/className="min-h-dvh /);
  });
});

describe('vzhled', () => {
  it('barva lišty prohlížeče sleduje ručně zvolený vzhled (R3-21)', () => {
    const provider = read('components/theme-provider.tsx');
    expect(provider).toContain('meta[name="theme-color"]');
    expect(provider).toContain('resolvedTheme');
  });

  it('přepínač vzhledu se jmenuje všude stejně (R1B-23)', () => {
    const toggle = read('components/theme-toggle.tsx');
    expect(toggle).not.toContain("'Auto'");
    expect(toggle).toContain('Podle systému');
  });
});
