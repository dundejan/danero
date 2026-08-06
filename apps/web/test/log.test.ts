import { describe, expect, it } from 'vitest';
import { errorText } from '@/lib/log';

/**
 * Drizzle dává do `DrizzleQueryError.message` celý dotaz včetně HODNOT parametrů.
 * Jedno selhané zapsání ověřovacího tokenu by tak vysypalo do logu token, jedno
 * selhání importu obsah transakcí a jedna obsazená adresa cizí e-mail.
 */
describe('errorText — sanitizace chybových hlášek', () => {
  it('uřízne hodnoty parametrů z chyby Drizzle', async () => {
    const { DrizzleQueryError } = await import('drizzle-orm/errors');
    const error = new DrizzleQueryError(
      'insert into "verification" ("identifier","value") values ($1, $2)',
      ['reset-abc', 'TAJNY_TOKEN'],
      new Error('duplicate key value violates unique constraint'),
    );

    // ověření předpokladu: bez sanitizace token v hlášce opravdu je
    expect(error.message).toContain('TAJNY_TOKEN');

    const text = errorText(error);
    expect(text).not.toContain('TAJNY_TOKEN');
    expect(text).not.toContain('reset-abc');
    expect(text).not.toContain('params:');
    // dotaz sám o sobě je pro ladění potřeba a citlivý není
    expect(text).toContain('Failed query');
  });

  it('běžnou chybu nechá být a dlouhou zkrátí', () => {
    expect(errorText(new Error('Token je neplatný nebo expiroval'))).toBe(
      'Token je neplatný nebo expiroval',
    );
    expect(errorText('řetězec místo chyby')).toBe('řetězec místo chyby');
    expect(errorText(new Error('x'.repeat(900)))).toHaveLength(501);
  });
});
