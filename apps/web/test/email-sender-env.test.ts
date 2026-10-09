import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Odesílání e-mailů na vlastní instanci (revize 5, dávka D10).
 *
 * L10-08: compose i ručně psaný `.env` umí proměnnou předat jako PRÁZDNÝ
 * řetězec a `??` ho k výchozí hodnotě nepustí — do Resendu pak odcházel
 * odesílatel `""` a `reply_to: "nenastaveno"` (zástupný text z `lib/contact.ts`).
 * Resend má `from` povinné a `reply_to` musí být adresa, takže instance
 * s klíčem neodeslala nic, ani ověření účtu.
 *
 * L10-01: bez klíče a v produkčním režimu se neodešle vůbec nic. To je
 * schválně (odkazy na ověření a obnovu hesla nepatří do logu), jen to musí
 * umět říct i stránka `/overeni-emailu` — proto predikát vedle odesílače.
 *
 * Zachytává se `fetch`, ne balíček `resend` (viz `email-timeout.test.ts`);
 * nic se neodesílá.
 */

const MESSAGE = { to: 'prijemce@priklad.test', subject: 'Zkouška', text: 'zkouška' };

/** Co by odešlo do Resendu. `lib/contact.ts` čte prostředí při načtení, proto čerstvý modul. */
async function capturedRequest(env: Record<string, string | undefined>) {
  vi.stubEnv('RESEND_API_KEY', 're_smysleny_klic');
  vi.stubEnv('DANERO_EMAIL_LOG', undefined);
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.resetModules();

  let body: Record<string, unknown> | null = null;
  vi.stubGlobal('fetch', async (_url: unknown, init: { body: string }) => {
    body = JSON.parse(init.body) as Record<string, unknown>;
    return Response.json({ id: 'msg_zachyceno' });
  });

  const { resolveEmailSender } = await import('@/lib/email');
  await resolveEmailSender()(MESSAGE);
  if (body === null) throw new Error('Požadavek na Resend neodešel.');
  return body as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('L10-08: odesílatel — prázdná proměnná je nenastavená proměnná', () => {
  it.each([
    ['chybí úplně', undefined],
    ['je prázdný řetězec (compose: ${RESEND_FROM:-})', ''],
    ['jsou jen mezery', '   '],
  ])('když RESEND_FROM %s, odchází výchozí odesílatel', async (_label, value) => {
    const body = await capturedRequest({ RESEND_FROM: value });
    expect(body.from).toMatch(/^Danero <[^\s@<>]+@[^\s@<>]+>$/);
  });

  it('vyplněný RESEND_FROM se použije (bez okolních mezer)', async () => {
    const body = await capturedRequest({ RESEND_FROM: ' Hlídač <posta@priklad.test> ' });
    expect(body.from).toBe('Hlídač <posta@priklad.test>');
  });
});

describe('L10-08: Reply-To — nikdy zástupný text místo adresy', () => {
  it('bez RESEND_REPLY_TO i bez kontaktu provozovatele se Reply-To vynechá', async () => {
    const body = await capturedRequest({
      RESEND_REPLY_TO: undefined,
      DANERO_CONTACT_EMAIL: undefined,
    });
    expect(body).not.toHaveProperty('reply_to');
    expect(JSON.stringify(body)).not.toContain('nenastaveno');
  });

  it('prázdný RESEND_REPLY_TO bez kontaktu provozovatele se taky vynechá', async () => {
    const body = await capturedRequest({ RESEND_REPLY_TO: '', DANERO_CONTACT_EMAIL: '' });
    expect(body).not.toHaveProperty('reply_to');
  });

  it('prázdný RESEND_REPLY_TO padá na kontakt provozovatele', async () => {
    const body = await capturedRequest({
      RESEND_REPLY_TO: '',
      DANERO_CONTACT_EMAIL: 'kontakt@priklad.test',
    });
    expect(body.reply_to).toBe('kontakt@priklad.test');
  });

  it('vyplněný RESEND_REPLY_TO má přednost před kontaktem', async () => {
    const body = await capturedRequest({
      RESEND_REPLY_TO: 'odpovedi@priklad.test',
      DANERO_CONTACT_EMAIL: 'kontakt@priklad.test',
    });
    expect(body.reply_to).toBe('odpovedi@priklad.test');
  });
});

describe('L10-01: emailDeliveryConfigured — má instance čím e-mail doručit?', () => {
  it.each([
    ['produkce bez klíče i bez souboru', { NODE_ENV: 'production' }, false],
    ['produkce s prázdným klíčem', { NODE_ENV: 'production', RESEND_API_KEY: '' }, false],
    ['produkce s klíčem Resendu', { NODE_ENV: 'production', RESEND_API_KEY: 're_x' }, true],
    [
      'produkce s přesměrováním do souboru (E2E)',
      { NODE_ENV: 'production', DANERO_EMAIL_LOG: '/tmp/maily.log' },
      true,
    ],
    ['vývoj bez klíče — zpráva se vypíše do konzole', { NODE_ENV: 'development' }, true],
    ['test bez klíče', { NODE_ENV: 'test' }, true],
  ])('%s', async (_label, env, expected) => {
    const { emailDeliveryConfigured } = await import('@/lib/email');
    expect(emailDeliveryConfigured(env)).toBe(expected);
  });

  it('predikát a odesílač se nerozcházejí: kde predikát říká ne, odeslání spadne', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', undefined);
    vi.stubEnv('DANERO_EMAIL_LOG', undefined);
    const { emailDeliveryConfigured, resolveEmailSender } = await import('@/lib/email');

    expect(emailDeliveryConfigured()).toBe(false);
    await expect(resolveEmailSender()(MESSAGE)).rejects.toThrow(/RESEND_API_KEY není nastaven/);
  });

  it('odesílač si podmínku nekopíruje — ptá se predikátu', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'lib', 'email.ts'), 'utf8');
    expect(source).toMatch(/if \(!emailDeliveryConfigured\(\)\)/);
    // režim běhu čte jen predikát (z `env`), nikde vedle něj druhá podmínka
    expect(source).not.toContain('process.env.NODE_ENV');
  });
});

describe('L10-01: /overeni-emailu netvrdí „poslali jsme“, když není čím odeslat', () => {
  const PAGE = readFileSync(
    join(import.meta.dirname, '..', 'app', '(auth)', 'overeni-emailu', 'page.tsx'),
    'utf8',
  );
  const FORM = readFileSync(
    join(import.meta.dirname, '..', 'components', 'resend-verification-form.tsx'),
    'utf8',
  );

  it('stránka se ptá predikátu při požadavku a výsledek předá formuláři', () => {
    expect(PAGE).toMatch(/^\s*const deliveryConfigured = emailDeliveryConfigured\(\);/m);
    expect(PAGE).toContain(
      '<ResendVerificationForm defaultEmail={email} deliveryConfigured={deliveryConfigured} />',
    );
  });

  it('věta „Poslali jsme ti odkaz“ i rada se spamem jsou jen ve větvi s nastaveným odesíláním', () => {
    const sentAt = PAGE.indexOf('Poslali jsme ti odkaz');
    const spamAt = PAGE.indexOf('Zkontroluj spam');
    expect(sentAt).toBeGreaterThan(-1);
    expect(spamAt).toBeGreaterThan(-1);
    // obě věty stojí až za rozhodnutím podle predikátu, ne před ním
    const notConfiguredAt = PAGE.indexOf('!deliveryConfigured ?');
    expect(notConfiguredAt).toBeGreaterThan(-1);
    expect(sentAt).toBeGreaterThan(notConfiguredAt);
    expect(PAGE).toMatch(/\{deliveryConfigured \? \(\s*<>\s*Nepřišel\? Zkontroluj spam\./);
    expect(PAGE).toContain('nemá nastavené odesílání e-mailů');
  });

  it('formulář po neúspěšném „Poslat znovu“ bere hlášku z lib/auth-errors', () => {
    expect(FORM).toContain('resendVerificationErrorMessage(result.error, deliveryConfigured)');
    expect(FORM).not.toContain('E-mail se nepodařilo odeslat');
  });
});
