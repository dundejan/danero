import { describe, expect, it } from 'vitest';
import { OPERATOR, OPERATOR_UNSET, OPERATOR as operatorContact } from '@/lib/contact';
import { ADR, TERMS_VERSION } from '@/lib/legal';
import {
  alertRecipient,
  failedImportAlertEmail,
  failedImportResolvedEmail,
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

/**
 * Textová verze se od 10. 8. 2026 zalamuje na 78 znaků, takže dlouhý název
 * instituce může přeskočit na další řádek. Hlídá se, že informace v e-mailu
 * JE — ne na kterém je řádku.
 */
const bezZalomeni = (text: string): string => text.replace(/\s+/g, ' ');

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
        // nadpisy se v textové verzi píšou verzálkami — hlídá se obsah, ne zápis
        expect(email.text).toMatch(/doba trvání/i);
      });

      it('poučuje o právech z vadného plnění a kam je uplatnit', () => {
        expect(email.text).toMatch(/vadného plnění/);
      });

      it('uvádí subjekt mimosoudního řešení sporů (§ 14 z. 634/1992)', () => {
        expect(bezZalomeni(email.text)).toContain(ADR.online);
        expect(bezZalomeni(email.text)).toContain(ADR.authority);
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
 * § 2389i odst. 2 OZ chce, aby odchylku od zákonné jakosti spotřebitel potvrdil
 * ZVLÁŠŤ. Původní tři odchylky jsou dnes nula:
 *
 * - jednotný kurz běžného roku se po pokynu GFŘ dopočítá (a do té doby je
 *   viditelně označený jako orientační),
 * - u sporných výkladů aplikace počítá obě varianty a ukazuje rozdíl,
 * - dostupnost byla do verze podmínek 2.3 výhradou („negarantujeme"), od 2.4 je
 *   z ní závazek s nápravou: výpadek nad 24 hodin prodlužuje roční hlídání.
 *
 * Odchylka tím zmizela a s ní i druhý povinný checkbox u objednávky. Test hlídá,
 * že se výhrada nevrátí zadními vrátky — kdyby ji někdo do podmínek dopsal, musí
 * s ní vrátit i samostatné potvrzení, jinak je ujednání podle § 2389i neplatné.
 */
describe('u objednávky nezůstala nepotvrzená odchylka od jakosti (§ 2389i)', () => {
  const read = async (relativni: string): Promise<string> => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    return readFileSync(join(import.meta.dirname, '..', relativni), 'utf8');
  };

  it('podmínky slibují dostupnost s nápravou, ne výhradu', async () => {
    const podminky = await read('app/podminky/page.tsx');
    expect(podminky).toContain('id="dostupnost"');
    expect(podminky).toMatch(/nedostupné souvisle déle než 24 hodin/);
    expect(podminky).toMatch(/prodloužíme/);
    // stará formulace výhrady se nesmí vrátit bez samostatného potvrzení
    expect(podminky).not.toMatch(/nemá sjednanou garantovanou dostupnost/);
  });

  it('objednávka nemá druhý povinný checkbox — zbyl jen souhlas dle § 1837 l', async () => {
    // Objednávka má od 10. 8. 2026 vlastní stránky a jedno společné shrnutí;
    // zaškrtávátko je právě jedno a je jen v něm.
    const objednavka = await read('components/order-page.tsx');
    expect(objednavka).not.toContain('name="dostupnost"');
    expect((objednavka.match(/<SouhlasCheckbox /g) ?? []).length).toBe(1);
    expect((objednavka.match(/type="checkbox"/g) ?? []).length).toBe(1);

    for (const stranka of [
      'app/(app)/predplatne/page.tsx',
      'app/(app)/predplatne/hlidani/page.tsx',
      'app/(app)/predplatne/podklady/page.tsx',
    ]) {
      const zdroj = await read(stranka);
      expect(zdroj, `${stranka} přidává vlastní checkbox`).not.toContain('type="checkbox"');
      expect(zdroj).not.toContain('name="dostupnost"');
    }
  });
});

/**
 * Dávka textových nálezů z 3. auditu — každý z nich byl tvrzení, které
 * neplatilo. Hlídá se to, co je na nich ověřitelné z kódu.
 */
describe('veřejné texty nesmí slibovat víc, než aplikace dělá (audit 3)', () => {
  const read = async (relativni: string): Promise<string> => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    return readFileSync(join(import.meta.dirname, '..', relativni), 'utf8');
  };

  it('E-3-16: tarif zdarma neslibuje limity „v reálném čase“ — sync je placený', async () => {
    const plans = await read('lib/plans.ts');
    const free = plans.slice(plans.indexOf("id: 'free'"), plans.indexOf("id: 'report'"));
    expect(free).not.toMatch(/v reálném čase/);
    expect(free).toMatch(/po každém nahrání výpisu/);
  });

  it('E-3-11: soukromí neslibuje, že po odhlášení přestanou chodit VŠECHNY e-maily', async () => {
    const soukromi = await read('app/soukromi/page.tsx');
    expect(soukromi).not.toMatch(/e-maily ti přestanou chodit okamžitě/);
    // provozní zprávy musí být jmenované, jinak je slib zase příliš široký
    expect(soukromi).toMatch(/upomínka před automatickou obnovou/);
    expect(soukromi).toMatch(/obnova hesla/);
  });

  it('K4-02b: soukromí neslibuje obnovu „v řádu dnů“ — Neon Free drží 6 hodin', async () => {
    const soukromi = await read('app/soukromi/page.tsx');
    expect(soukromi).not.toMatch(/v řádu dnů/);
    expect(soukromi).toMatch(/6 hodin/);
  });

  it('E-3-12: kalkulačka netvrdí, že překročení 50k vyhazuje z paušálního režimu', async () => {
    const kalkulacka = await read('app/kalkulacka/page.tsx');
    expect(kalkulacka).not.toMatch(/smí mít max\. 50 000/);
    expect(kalkulacka).toMatch(/z režimu nevyhazuje/);
  });

  it('E-3-07: „Jak počítáme“ zná oznámení osvobozeného příjmu (§ 38v)', async () => {
    const jakPocitame = await read('app/jak-pocitame/page.tsx');
    expect(jakPocitame).toMatch(/38v/);
    expect(jakPocitame).toMatch(/5 000 000 Kč/);
  });
});

/**
 * Co /soukromi slibuje o nepřečteném výpisu × co `lib/failed-imports.ts`
 * s `lib/email.ts` opravdu dělají. Texty se sem píšou proto, že vzorek ze
 * souboru je jediné místo, kde aplikace posílá ven kus cizí obchodní historie —
 * slib o něm musí být přesný na slovo (nálezy K6a-04, K4-06, K4-05 4. auditu).
 */
describe('/soukromi × nepřečtený výpis', () => {
  const read = async (relativni: string): Promise<string> => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    return readFileSync(join(import.meta.dirname, '..', relativni), 'utf8');
  };

  it('K6a-04: neslibuje „první řádek s názvy sloupců“ — bere se první řádek, ať je v něm cokoli', async () => {
    const soukromi = await read('app/soukromi/page.tsx');
    // headerSample() v lib/failed-imports.ts nic nezkoumá: vezme firstLine().
    // U výpisu z banky to bylo číslo účtu, jméno a IBAN — ne názvy sloupců.
    expect(soukromi).not.toMatch(/první řádek s názvy sloupců/);
    expect(soukromi).toMatch(/první řádek souboru/);
    // a rovnou se přizná, že hlavička to být nemusí
    expect(soukromi).toMatch(/číslo účtu/);
  });

  it('K4-06: jmenuje i e-mailovou adresu a poznámku uživatele, které e-mail veze', async () => {
    const soukromi = await read('app/soukromi/page.tsx');
    const email = await read('lib/email.ts');
    // řádky, které failedImportAlertEmail skládá do tabulky upozornění
    expect(email).toMatch(/'Uživatel', args\.userEmail/);
    expect(email).toMatch(/'Poznámka', args\.reportedNote/);
    expect(soukromi).toMatch(/tvoje e-mailová adresa/);
    expect(soukromi).toMatch(/poznámku, pošle se provozovateli i to/);
  });

  it('K4-05: říká, že obsah mažeme při vyřízení případu, ne až 90denní retencí', async () => {
    const soukromi = await read('app/soukromi/page.tsx');
    const failedImports = await read('lib/failed-imports.ts');
    // resolveCase() nuluje `content` u obou výsledků (fixed i rejected)
    expect(failedImports).toMatch(/content: null/);
    expect(soukromi).toMatch(/jakmile případ vyřídíme/);
    expect(soukromi).toMatch(/nejpozději po 90 dnech/);
  });
});

/**
 * Identifikace provozovatele nepatří do repozitáře — je veřejný a pod AGPL,
 * takže by si ji s sebou vozil každý, kdo si Danero rozjede sám. A hlavně:
 * jednou commitnutá adresa z historie nezmizí ani po přestěhování. Historie
 * se kvůli tomu 10. 8. 2026 přepisovala; tenhle test hlídá, ať se to neopakuje.
 */
describe('osobní údaje provozovatele nejsou v kódu', () => {
  it('contact.ts bere jméno, IČO, adresu i e-mail z prostředí', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const zdroj = readFileSync(join(import.meta.dirname, '..', 'lib', 'contact.ts'), 'utf8');
    for (const env of [
      'DANERO_OPERATOR_NAME',
      'DANERO_OPERATOR_ICO',
      'DANERO_OPERATOR_ADDRESS',
      'DANERO_CONTACT_EMAIL',
      'DANERO_CONTACT_PHONE',
    ]) {
      // `env.` a ne `process.env.`: identifikace se od 4. auditu skládá
      // v `operatorFromEnv(env)`, aby ji předletová kontrola nástrojů
      // (lib/operator-env.ts) uměla posoudit i nad podstrčeným prostředím.
      // Hlídané zůstává to podstatné — hodnota pochází z proměnné toho jména.
      expect(zdroj).toContain(`env.${env}`);
    }
  });

  it('aplikace nemá adresu ani e-mail provozovatele natvrdo', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const korene = ['app', 'lib', 'components'].map((d) => join(import.meta.dirname, '..', d));
    const soubory = (dir: string): string[] =>
      readdirSync(dir).flatMap((e) => {
        const full = join(dir, e);
        if (statSync(full).isDirectory()) return soubory(full);
        return /\.(ts|tsx)$/.test(e) ? [full] : [];
      });

    // PSČ v české adrese („101 00") a zavináč v doméně poskytovatele pošty —
    // obojí je tvar, který se do zdrojáku dostane jedině ručním vepsáním
    const vzory: [RegExp, string][] = [
      [/\b\d{3} \d{2}\b\s+Praha/i, 'adresa provozovatele'],
      [/[\w.]+@gmail\.com/i, 'osobní e-mail'],
    ];
    // `lib/legal.ts` schválně nese adresu České obchodní inspekce (mimosoudní
    // řešení sporů, § 14 z. 634/1992) — veřejná instituce, ne provozovatel.
    const VYJIMKY = [join('lib', 'legal.ts')];
    for (const soubor of korene.flatMap(soubory)) {
      if (VYJIMKY.some((vyjimka) => soubor.endsWith(vyjimka))) continue;
      const zdroj = readFileSync(soubor, 'utf8');
      for (const [vzor, co] of vzory) {
        expect(vzor.test(zdroj), `${soubor} nese ${co} natvrdo`).toBe(false);
      }
    }
  });
});

/**
 * E-maily byly do 10. 8. 2026 holý text a `operatorSignature()` vozil adresu
 * provozovatele v každé zprávě — i v obnově hesla. HTML verze se skládá
 * z týchž bloků jako text, takže se obě nemůžou rozejít.
 */
describe('vzhled a obsah odchozích e-mailů', () => {
  const vsechny = [
    ['obnova hesla', resetPasswordEmail('https://danero.cz/nove-heslo?token=x')],
    ['ověření adresy', verifyEmailEmail('https://danero.cz/overeni?token=x')],
    ['potvrzení předplatného', subscription],
    ['potvrzení podkladů', report],
    [
      'upomínka před obnovou',
      subscriptionRenewalEmail({ renewsOn: '7. 8. 2027', priceCzk: PRICE_SUBSCRIPTION_CZK }),
    ],
    [
      'výpis doimportován',
      failedImportResolvedEmail({ filename: 'vypis.csv', outcome: 'fixed', added: 12 }),
    ],
    [
      'výpis číst neumíme',
      failedImportResolvedEmail({ filename: 'vypis.csv', outcome: 'rejected', note: 'Stáhni Historii transakcí.' }),
    ],
  ] as const;

  it.each(vsechny.map(([nazev]) => nazev))('%s má textovou i HTML verzi', (nazev) => {
    const email = vsechny.find(([n]) => n === nazev)![1];
    expect(email.text.length).toBeGreaterThan(80);
    expect(email.html).toBeDefined();
    expect(email.html).toMatch(/^<!doctype html>/);
    // žádný externí zdroj — prozradil by, kdy si příjemce zprávu otevřel
    expect(email.html).not.toMatch(/<img|src="http|@import|<link/i);
  });

  it.each(vsechny.map(([nazev]) => nazev))('%s: HTML nese totéž co text', (nazev) => {
    const email = vsechny.find(([n]) => n === nazev)![1];
    const html = bezZalomeni(email.html!.replace(/<[^>]+>/g, ' '));
    // věty z textové verze musí být i v HTML (bere se první delší odstavec)
    const prvniVeta = bezZalomeni(email.text).split('. ')[0]!;
    expect(html).toContain(prvniVeta);
  });

  it('adresu provozovatele nese JEN potvrzení objednávky (§ 1824a)', () => {
    for (const [nazev, email] of vsechny) {
      const maAdresu =
        bezZalomeni(email.text).includes(OPERATOR.address) ||
        bezZalomeni(email.html ?? '').includes(OPERATOR.address);
      const smiMitAdresu = nazev.startsWith('potvrzení');
      expect(maAdresu, `${nazev}: adresa ${maAdresu ? 'JE' : 'CHYBÍ'}`).toBe(smiMitAdresu);
    }
  });

  it('všechny e-maily se identifikují jménem, IČO i kontaktem (proti phishingu)', () => {
    for (const [nazev, email] of vsechny) {
      expect(bezZalomeni(email.text), nazev).toContain(operatorContact.name);
      expect(bezZalomeni(email.text), nazev).toContain(operatorContact.ico);
      // K2-04: kontaktní adresa se hlídala jen u služebních e-maily výš, takže
      // zprávy o nepřečteném výpisu ji sem mohly ztratit bez povšimnutí —
      // a `From` je notifikace@danero.cz, která poštu nepřijímá
      expect(bezZalomeni(email.text), nazev).toContain(operatorContact.email);
    }
  });
});

/**
 * Upozornění na nepřečtený výpis chodí PROVOZOVATELI, ne zákazníkovi — a nese
 * cizí data. Obsah výpisu (celá obchodní historie jednoho člověka) se do něj
 * nesmí dostat ani omylem: originál leží v `failed_imports` a sahá na něj jen
 * skript provozovatele. Ven jde jenom hlavička, kterou tam dáváme schválně —
 * podle názvů sloupců se formát pozná.
 */
describe('upozornění na nepřečtený výpis (provozovateli)', () => {
  const podklady = {
    caseId: 'case-1',
    filename: 'vypis.csv',
    byteSize: 2048,
    reason: 'Formát souboru nepoznáváme — v hlavičce jsme našli: Obchodni den, Titul.',
    headerSample: 'Obchodni den;Titul;Operace',
    userEmail: 'zakaznik@example.test',
    reportedPlatform: 'Fio e-Broker',
    reportedNote: 'Export z Obchody → Historie.',
  };
  const alert = failedImportAlertEmail({ ...podklady, reported: true });

  it('nese to, podle čeho se formát dohledá', () => {
    expect(alert.text).toContain('case-1');
    expect(alert.text).toContain('vypis.csv');
    expect(alert.text).toContain('Obchodni den');
    expect(alert.text).toContain('Fio e-Broker');
    expect(alert.subject).toContain('Fio e-Broker');
  });

  /**
   * U výpisu staženého z API si platformu předvyplní Danero samo. Kdyby se
   * „uživatel nahlásil“ odvozovalo z vyplněné platformy, první automatické
   * upozornění by tvrdilo, že to nahlásil někdo, kdo neudělal nic — a čerstvé
   * nálezy by ve schránce nešly odlišit od skutečných hlášení.
   */
  it('nehlásí „uživatel nahlásil“, když platformu doplnil Danero sám', () => {
    const automat = failedImportAlertEmail({ ...podklady, reportedNote: null, reported: false });
    expect(automat.subject).not.toContain('uživatel nahlásil');
    expect(automat.text).not.toContain('Uživatel doplnil');
    // platformu ale vypsat musí — provozovateli šetří hledání
    expect(automat.text).toContain('Fio e-Broker');
  });

  it('míří na adresu z prostředí, ne z kódu', () => {
    const puvodni = process.env.DANERO_ALERT_EMAIL;
    process.env.DANERO_ALERT_EMAIL = 'provoz@example.test';
    expect(alertRecipient()).toBe('provoz@example.test');
    delete process.env.DANERO_ALERT_EMAIL;
    // bez proměnné padá zpátky na veřejný kontakt (taky z prostředí)
    expect(alertRecipient()).toBe(OPERATOR.email === OPERATOR_UNSET ? null : OPERATOR.email);
    if (puvodni !== undefined) process.env.DANERO_ALERT_EMAIL = puvodni;
  });
});
