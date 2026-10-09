import { describe, expect, it } from 'vitest';
import { getIp } from 'better-auth/api';
import { resolveTrustedProxies } from '@/lib/auth';

/**
 * D-1: klíč rate limitu Better Authu = IP klienta z X-Forwarded-For. Bez
 * `advanced.ipAddress.trustedProxies` se důvěřuje jen hlavičce s jedinou
 * hodnotou — za běžnou nginx proxy (`$proxy_add_x_forwarded_for`) jich je víc,
 * IP se nerozřeší a všichni sdílí jeden kbelík.
 */
const options = (trustedProxies: string[]) => ({
  advanced: { ipAddress: { trustedProxies } },
});

describe('rozřešení IP klienta pro rate limit (D-1)', () => {
  it('řetězec od proxy: klientská IP se vezme zprava, hopy proxy se přeskočí', () => {
    const headers = new Headers({ 'x-forwarded-for': '198.51.100.7, 10.0.0.5' });
    expect(getIp(headers, options(resolveTrustedProxies()))).toBe('198.51.100.7');
  });

  it('dva různí klienti za toutéž proxy nesdílí jeden kbelík', () => {
    const opts = options(resolveTrustedProxies());
    const first = getIp(new Headers({ 'x-forwarded-for': '198.51.100.7, 10.0.0.5' }), opts);
    const second = getIp(new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.5' }), opts);
    expect(first).not.toBe(second);
  });

  it('podvržená hlavička před hopem proxy klientskou IP nepřebije', () => {
    const opts = options(resolveTrustedProxies());
    // útočník si sám pošle `X-Forwarded-For: 1.2.3.4`, proxy za něj doplní
    // jeho skutečnou adresu — ta je vpravo a rozhoduje
    const headers = new Headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9, 10.0.0.5' });
    expect(getIp(headers, opts)).toBe('203.0.113.9');
  });

  it('produkce (Vercel): jediná veřejná hodnota v hlavičce projde jako klient', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.9' });
    expect(getIp(headers, options(resolveTrustedProxies()))).toBe('203.0.113.9');
  });

  it('všechny výchozí rozsahy jsou platné CIDR (jinak je Better Auth tiše zahodí)', () => {
    const opts = options(resolveTrustedProxies());
    // z každého výchozího rozsahu jedna adresa — musí se přeskočit jako hop proxy
    const hops = ['127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.1', '100.64.0.1'];
    for (const hop of hops) {
      const headers = new Headers({ 'x-forwarded-for': `203.0.113.9, ${hop}` });
      expect(getIp(headers, opts)).toBe('203.0.113.9');
    }
    // IPv6 varianty (loopback a ULA) — klient je taky IPv6
    const ipv6 = new Headers({ 'x-forwarded-for': '2001:db8::1, fd00::1' });
    expect(getIp(ipv6, opts)).toBe('2001:0db8:0000:0000:0000:0000:0000:0000');
  });

  it('DANERO_TRUSTED_PROXIES přepíše výchozí seznam', () => {
    withTrustedProxiesEnv('192.0.2.10, 10.0.0.0/24', () => {
      expect(resolveTrustedProxies()).toEqual(['192.0.2.10', '10.0.0.0/24']);
    });
  });
});

/**
 * D07-R1-01: `env_file` v compose předá kontejneru i řádek `DANERO_TRUSTED_PROXIES=`
 * ze šablony `.env.example` — jako prázdný řetězec, ne jako chybějící proměnnou.
 * Šablona i návod u něj slibují „nevyplněno = výchozí privátní rozsahy“. Dokud
 * se prázdná hodnota četla jako „žádná důvěryhodná proxy“, vyšla IP u hlavičky
 * se dvěma hodnotami `null` a všichni takoví klienti sdíleli jeden kbelík:
 * pět špatných pokusů jednoho z nich na minutu zablokovalo přihlášení ostatním.
 */
describe('prázdná DANERO_TRUSTED_PROXIES se čte jako nevyplněná (D07-R1-01)', () => {
  const unset = withTrustedProxiesEnv(undefined, () => resolveTrustedProxies());

  it('kontrola: nenastavená proměnná dává neprázdný výchozí seznam', () => {
    expect(unset.length).toBeGreaterThan(0);
  });

  // prázdný řádek šablony, mezery po smazané hodnotě, samé oddělovače
  for (const value of ['', '   ', ' , ,']) {
    it(`hodnota ${JSON.stringify(value)}: platí výchozí seznam a klienti mají každý svůj kbelík`, () => {
      withTrustedProxiesEnv(value, () => {
        expect(resolveTrustedProxies()).toEqual(unset);
        const opts = options(resolveTrustedProxies());
        // dvě hodnoty v hlavičce: klient za další proxy, CDN před proxy, podvrh
        const first = getIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 198.51.100.9' }), opts);
        const second = getIp(new Headers({ 'x-forwarded-for': '192.0.2.44, 198.51.100.77' }), opts);
        expect(first).toBe('198.51.100.9');
        expect(second).toBe('198.51.100.77');
      });
    });
  }
});

/** Pustí `run` s danou hodnotou proměnné (`undefined` = nenastavená) a prostředí vrátí. */
function withTrustedProxiesEnv<T>(value: string | undefined, run: () => T): T {
  const before = process.env.DANERO_TRUSTED_PROXIES;
  if (value === undefined) delete process.env.DANERO_TRUSTED_PROXIES;
  else process.env.DANERO_TRUSTED_PROXIES = value;
  try {
    return run();
  } finally {
    if (before === undefined) delete process.env.DANERO_TRUSTED_PROXIES;
    else process.env.DANERO_TRUSTED_PROXIES = before;
  }
}
