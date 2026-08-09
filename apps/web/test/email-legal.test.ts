import { describe, expect, it } from 'vitest';
import { OPERATOR } from '@/lib/contact';
import { ADR, TERMS_VERSION } from '@/lib/legal';
import {
  purchaseConfirmationEmail,
  resetPasswordEmail,
  subscriptionRenewalEmail,
  verifyEmailEmail,
} from '@/lib/email';
import { PRICE_REPORT_CZK, PRICE_SUBSCRIPTION_CZK } from '@/lib/pricing';

/**
 * Povinný obsah odchozích e-mailů.
 *
 * Potvrzení o uzavření smlouvy je jediný **trvalý nosič**, který zákazník
 * dostane — podle rozsudku SDEU C-49/11 jím webová stránka není, takže odkaz
 * na danero.cz/podminky povinnost podle § 1824a OZ nesplní. Údaje podle § 1820
 * proto musí být v samotném e-mailu (nález E-30).
 *
 * Testuje se **podstata**, ne formulace: že tam ta informace je, ne jakou
 * větou. Doslovné znění se smí přepsat kdykoli.
 */

const subscription = purchaseConfirmationEmail({
  what: 'Celoroční hlídání daní z investic (roční předplatné)',
  priceCzk: PRICE_SUBSCRIPTION_CZK,
  consentGiven: true,
  kind: 'subscription',
});

const report = purchaseConfirmationEmail({
  what: 'Podklady k přiznání za rok 2025',
  priceCzk: PRICE_REPORT_CZK,
  consentGiven: true,
  kind: 'report',
});

describe('potvrzení o uzavření smlouvy nese údaje podle § 1820 (E-30)', () => {
  for (const [nazev, email] of [
    ['předplatné', subscription],
    ['podklady', report],
  ] as const) {
    describe(nazev, () => {
      it('identifikuje prodávajícího včetně IČO a kontaktu', () => {
        expect(email.text).toContain(OPERATOR.ico);
        expect(email.text).toContain(OPERATOR.email);
      });

      it('uvádí dobu trvání závazku', () => {
        expect(email.text).toMatch(/[Dd]oba trvání/);
      });

      it('poučuje o právech z vadného plnění a kam je uplatnit', () => {
        expect(email.text).toMatch(/vadného plnění/);
      });

      it('uvádí subjekt mimosoudního řešení sporů (§ 14 z. 634/1992)', () => {
        expect(email.text).toContain(ADR.online);
        expect(email.text).toContain(ADR.authority);
      });

      it('říká, podle které verze podmínek se nakupovalo', () => {
        expect(email.text).toContain(TERMS_VERSION);
      });

      it('popisuje, co je k užívání technicky potřeba (§ 1820/1 r)', () => {
        expect(email.text).toMatch(/prohlížeč/);
      });
    });
  }

  it('u předplatného popisuje automatickou obnovu i její zrušení', () => {
    expect(subscription.text).toMatch(/automaticky obnov/);
    expect(subscription.text).toMatch(/zrušíš/);
    expect(subscription.text).toContain(String(PRICE_SUBSCRIPTION_CZK));
  });

  it('u jednorázových podkladů naopak říká, že se nic neobnovuje', () => {
    expect(report.text).toMatch(/neobnovuje/);
    // a nesmí u nich slíbit obnovu ani odečet dalších peněz
    expect(report.text).not.toMatch(/automaticky obnov/);
  });

  it('nepředstírá přílohu, kterou e-mail neveze', () => {
    // dřívější návrh zněl „podmínky jsou přílohou“ — žádný soubor se ale
    // nepřikládá a nesplnitelný slib je horší než odkaz
    expect(subscription.text).not.toMatch(/přílohou|v příloze/);
  });
});

describe('služební e-maily se identifikují (E-46)', () => {
  for (const [nazev, email] of [
    ['obnova hesla', resetPasswordEmail('https://danero.cz/nove-heslo?token=x')],
    ['ověření adresy', verifyEmailEmail('https://danero.cz/overeni?token=x')],
    ['upomínka před obnovou', subscriptionRenewalEmail({ renewsOn: '7. 8. 2027', priceCzk: PRICE_SUBSCRIPTION_CZK })],
  ] as const) {
    it(`${nazev}: nese odesílatele i kontakt, kam odpovědět`, () => {
      // From je notifikace@danero.cz a ta schránka poštu nepřijímá — bez
      // kontaktu v textu nemá příjemce kam napsat a zpráva vypadá jako phishing
      expect(email.text).toContain(OPERATOR.name);
      expect(email.text).toContain(OPERATOR.ico);
      expect(email.text).toContain(OPERATOR.email);
    });
  }
});

/**
 * E-3-08/E-3-09: texty nesmí slibovat, co v kódu není, a naopak musí slíbit to,
 * co je hlavní protiplnění. Veřejná architektura tvrdila „passkeys“ a
 * „Sentry + Vercel Analytics“ (v repozitáři nula výskytů, a tentýž soubor si
 * o pár řádků níž odporoval), zatímco podmínky mlčely o každoročních
 * aktualizacích, které README prodává jako důvod platit 990 Kč.
 */
describe('texty odpovídají skutečnosti (E-3-08, E-3-09)', () => {
  const read = async (relativni: string): Promise<string> => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    return readFileSync(join(import.meta.dirname, '..', relativni), 'utf8');
  };

  it('architektura neslibuje passkeys ani externí monitoring, dokud nasazené nejsou', async () => {
    const doc = await read('../../docs/04-architektura.md');
    const kod = [
      await read('lib/auth.ts'),
      await read('lib/log.ts'),
      await read('package.json'),
    ].join('\n');

    for (const tvrzeni of ['passkey', 'Sentry', 'Vercel Analytics']) {
      const slibuje = new RegExp(`\\| .*\\*\\*.*${tvrzeni}`, 'i').test(doc);
      const existuje = new RegExp(tvrzeni.replace(' ', '.?'), 'i').test(kod);
      expect(slibuje && !existuje, `docs/04 slibuje ${tvrzeni}, ale v kódu není`).toBe(false);
    }
  });

  it('podmínky slibují každoroční aktualizace, které README prodává', async () => {
    const podminky = await read('app/podminky/page.tsx');
    expect(podminky).toContain('jednotný kurz');
    expect(podminky).toContain('elektronické podání');
  });
});

/**
 * E-3-01: § 2389i odst. 2 OZ chce, aby odchylku od zákonné jakosti spotřebitel
 * potvrdil ZVLÁŠŤ — samostatným projevem vůle, ne odkazem na podmínky. Ze tří
 * původních odchylek dvě odchylkou být přestaly (kurz se po pokynu GFŘ
 * dopočítá, sporné výklady aplikace počítá oběma způsoby a ukazuje rozdíl),
 * takže se potvrzuje jen chybějící garance dostupnosti.
 */
describe('odchylka od jakosti se potvrzuje zvlášť (E-3-01)', () => {
  const read = async (relativni: string): Promise<string> => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    return readFileSync(join(import.meta.dirname, '..', relativni), 'utf8');
  };

  it('objednávka má vlastní checkbox o dostupnosti a odkaz do podmínek', async () => {
    const page = await read('app/(app)/predplatne/page.tsx');
    expect(page).toContain('name="dostupnost"');
    expect(page).toContain('required');
    expect(page).toContain('/podminky#odchylky-od-jakosti');
    // u obou plnění, ne jen u jednoho
    expect((page.match(/<DostupnostCheckbox /g) ?? []).length).toBe(2);
  });

  it('podmínky mají kotvu, na kterou checkbox míří', async () => {
    expect(await read('app/podminky/page.tsx')).toContain('id="odchylky-od-jakosti"');
  });
});
