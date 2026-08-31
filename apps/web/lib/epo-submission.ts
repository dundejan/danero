/**
 * Vyhodnocení odpovědi OFICIÁLNÍ zkušební podatelny finanční správy
 * (`https://adisspr.mfcr.cz/dpr/epo_podani?test=1`) na zaslané XML.
 *
 * Čisté funkce bez I/O — samotné odesílání dělá `scripts/validate-epo.mjs`.
 * Bydlí to tady, a ne ve skriptu, protože do skriptu žádný test nedosáhne;
 * a přitom právě tohle rozhodování určuje, jestli CI spadne (nález K3-12).
 *
 * Klíčové rozlišení: **výpadek služby není odmítnutí obsahu.** Odmítnutí smí
 * hlásit jen odpověď, ve které podatelna opravdu vydala verdikt (HTTP 200
 * s aspoň jednou kontrolou `<Chyba>`). Cokoli jiného — HTTP 503, stránka
 * s údržbou vrácená se stavem 200, prázdné tělo — znamená, že se XML
 * neověřilo; to je `unreachable`, a psát u toho „podatelna odmítla“ by bylo
 * nepravdivé.
 */

/** Popis typů kontrol podatelny (dle dokumentace EPO). */
export const CHECK_TYPE_LABELS: Record<string, string> = {
  S: 'strukturální chyba (XML neodpovídá struktuře písemnosti)',
  N: 'nepropustná/věcná chyba',
  K: 'kritická chyba',
  P: 'propustná chyba (upozornění)',
  I: 'informace',
};

/**
 * Typy, které podání NEBLOKUJÍ. Schválně allowlist, ne denylist: podatelna
 * vrací i typy, které jsme neznali (`K` nám takhle proklouzl a skript hlásil
 * „podání by ostrá podatelna přijala“ i u písemnosti se dvěma kritickými
 * chybami — nález A3-02). Neznámý typ je proto blokující, ne tichý průchod.
 */
const NON_BLOCKING = new Set(['P', 'I']);

export interface PodatelnaCheck {
  Typ?: string;
  Polozka?: string;
  Zkr?: string;
  text: string;
}

export type PodatelnaVerdict = 'ok' | 'rejected' | 'unreachable';

export interface PodatelnaResult {
  verdict: PodatelnaVerdict;
  checks: PodatelnaCheck[];
  /** Proč se verdikt nedal vydat — jen u `unreachable`, česky pro výpis. */
  reason?: string;
}

const decodeEntities = (value: string): string =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** Vytáhne kontroly z odpovědi `<Chyby><Chyba Polozka=".." Typ=".." Zkr=".."><Text>…</Text></Chyba>…` */
export function parseChecks(xml: string): PodatelnaCheck[] {
  const checks: PodatelnaCheck[] = [];
  for (const match of xml.matchAll(/<Chyba\b([^>]*)>\s*<Text>([\s\S]*?)<\/Text>/g)) {
    const attrs = Object.fromEntries(
      [...(match[1] ?? '').matchAll(/(\w+)="([^"]*)"/g)].map(([, key, value]) => [
        key,
        decodeEntities(value ?? ''),
      ]),
    );
    checks.push({ ...attrs, text: decodeEntities((match[2] ?? '').trim()) });
  }
  return checks;
}

/**
 * Verdikt nad jednou odpovědí podatelny.
 *
 * `rejected` znamená „podatelna XML posoudila a našla v něm blokující chybu“ —
 * nic jiného. Do 31. 8. 2026 sem spadl i HTTP 503 a údržbová HTML stránka
 * vrácená se stavem 200, takže výpadek ADIS shodil CI a do souhrnu běhu se
 * zapsalo „Zkušební podatelna odmítla 1 z 1 vzorků“, ačkoli podatelna XML
 * nikdy neviděla (K3-12).
 */
export function classifyResponse(response: { status: number; body: string }): PodatelnaResult {
  if (response.status < 200 || response.status >= 300) {
    return {
      verdict: 'unreachable',
      checks: [],
      reason: `podatelna odpověděla HTTP ${response.status} — verdikt o obsahu XML to není`,
    };
  }
  const checks = parseChecks(response.body);
  if (checks.length === 0) {
    return {
      verdict: 'unreachable',
      checks: [],
      // Typicky údržbová stránka nebo přesměrování na HTML: stav 200, ale
      // v těle není jediná kontrola, takže se XML neposoudilo.
      reason: 'odpověď neobsahuje jedinou kontrolu <Chyba> — nevypadá jako odpověď podatelny',
    };
  }
  const blocking = checks.some((check) => !NON_BLOCKING.has(check.Typ ?? ''));
  return { verdict: blocking ? 'rejected' : 'ok', checks };
}
