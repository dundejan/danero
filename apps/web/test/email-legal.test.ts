import { describe, expect, it } from 'vitest';
import { OPERATOR, OPERATOR_UNSET, OPERATOR as operatorContact } from '@/lib/contact';
import {
  alertRecipient,
  failedImportAlertEmail,
  failedImportResolvedEmail,
  resetPasswordEmail,
  verifyEmailEmail,
} from '@/lib/email';

/**
 * Textová verze se od 10. 8. 2026 zalamuje na 78 znaků, takže dlouhý název
 * instituce může přeskočit na další řádek. Hlídá se, že informace v e-mailu
 * JE — ne na kterém je řádku.
 */
const bezZalomeni = (text: string): string => text.replace(/\s+/g, ' ');

describe('služební e-maily se identifikují (E-46)', () => {
  for (const [nazev, email] of [
    ['obnova hesla', resetPasswordEmail('https://danero.cz/nove-heslo?token=x')],
    ['ověření adresy', verifyEmailEmail('https://danero.cz/overeni?token=x')],
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
 * aktualizacích, které README slibovalo.
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

  it('podmínky říkají, jak je to s každoročními aktualizacemi', async () => {
    const podminky = await read('app/podminky/page.tsx');
    expect(podminky).toContain('jednotný kurz');
    expect(podminky).toContain('elektronické podání');
  });
});

/**
 * Danero je od 8. 10. 2026 celé zdarma (podmínky 3.0). Hlídá se, že se do
 * textů ani do kódu nevrátí zbytek placené služby — polovičatý stav je horší
 * než kterýkoli z obou čistých:
 *
 * - veřejný text, který by cokoli prodával, by z dobrovolného příspěvku udělal
 *   cenu a z bezplatné služby smlouvu na dálku se vším, co k ní patří
 *   (§ 1820 a násl. OZ: odstoupení, potvrzení na trvalém nosiči, telefon),
 * - a je to i podmínka hostingu: Vercel Hobby dovoluje žádat o dary, ale ne
 *   prodávat (viz `lib/support.ts`).
 *
 * Do verze 2.4 tu stál test odchylek od jakosti podle § 2389i OZ (dostupnost
 * s nápravou místo výhrady, jediný checkbox u objednávky). S objednávkou
 * zanikl i on; poslední podoba je pod značkou `placene-tarify`.
 */
describe('bezplatná služba nenese zbytky placené (podmínky 3.0)', () => {
  const read = async (relativni: string): Promise<string> => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    return readFileSync(join(import.meta.dirname, '..', relativni), 'utf8');
  };

  it('podmínky říkají, že je služba zdarma a že příspěvek nic neodemyká', async () => {
    const podminky = await read('app/podminky/page.tsx');
    expect(podminky).toMatch(/Danero je zdarma, a to celé/);
    expect(podminky).toMatch(/není platbou za\s+službu/);
    expect(podminky).toMatch(/bez tvojí výslovné objednávky/);
  });

  it('podmínky neslibují náhradu, kterou není z čeho dát', async () => {
    const podminky = await read('app/podminky/page.tsx');
    // kotva zůstává — vedou na ni starší odkazy
    expect(podminky).toContain('id="dostupnost"');
    // „prodloužíme ti roční hlídání“ a „vrátíme ti peníze“ byly závazky placené
    // služby; v bezplatné by byly slibem, který nejde splnit
    expect(podminky).not.toMatch(/prodloužíme/);
    expect(podminky).not.toMatch(/vrátíme ti/);
  });

  /**
   * Prochází se CELÁ aplikace, ne ručně psaný seznam stránek. První verze
   * četla šest veřejných souborů a přehlédla chybovou hlášku v `/import`
   * („…to je ale součást placeného hlídání"), kterou uživatel uvidí při
   * nahrání příliš velkého souboru — nový soubor se do seznamu sám nedopíše.
   *
   * Hledají se tvary, které jdou napsat jedině úmyslem něco prodat: cena
   * dřívějších tarifů, výzva k objednání, odkaz na zaniklou stránku. Zmínky
   * o historii („do října 2026 mělo placené tarify") jimi neprojdou a zůstat
   * smějí — zamlčet ji by bylo horší.
   */
  it('nikde v aplikaci nezbyla cena, výzva k objednání ani odkaz na zaniklý tarif', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join, relative } = await import('node:path');
    const root = join(import.meta.dirname, '..');
    const sourceFiles = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return sourceFiles(full);
        return /\.(ts|tsx)$/.test(entry) ? [full] : [];
      });

    const SALES_LEFTOVERS: RegExp[] = [
      /\b[49]90\s?Kč/,
      /hlídání za (\{|\d)/,
      /součást\w* (placeného |ročního )?hlídání/i,
      /placen\w+ hlídání/i,
      /Objednat hlídání/,
      /Koupit (podklady|další rok)/,
      /Ceny jsou konečné/,
      /bez předplatného/i,
      /['"`]\/predplatne/,
      /['"`]\/odstoupeni/,
    ];

    const found: string[] = [];
    for (const file of ['app', 'components', 'lib'].flatMap((dir) => sourceFiles(join(root, dir)))) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of SALES_LEFTOVERS) {
        if (pattern.test(source)) found.push(`${relative(root, file)}: ${pattern}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('veřejné stránky nemluví o předplatném ani v jiném tvaru', async () => {
    // přísnější síto jen pro stránky, které čte každý návštěvník — tam nemá
    // slovo „předplatné" co dělat ani v komentáři
    for (const page of [
      'app/podminky/page.tsx',
      'app/cenik/page.tsx',
      'app/page.tsx',
      'app/caste-otazky/faq.tsx',
      'app/o-projektu/page.tsx',
      'components/platform-catalog.tsx',
    ]) {
      expect(/předplatn/i.test(await read(page)), `${page} mluví o předplatném`).toBe(false);
    }
  });

  it('aplikace nemá platební bránu ani v závislostech', async () => {
    const manifest = JSON.parse(await read('package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies)).not.toContain('stripe');
  });

  it('stránky zaniklých tarifů přesměrovávají, nekončí na 404', async () => {
    // odkazy na ně žijí ve starých e-mailech (potvrzení objednávky, upomínka);
    // `:path*` bere i nula úseků, takže kryje `/predplatne` samotné
    const { default: config } = await import('../next.config');
    const redirects = await config.redirects!();
    const targets = Object.fromEntries(redirects.map((r) => [r.source, r.destination]));
    expect(targets['/predplatne/:path*']).toBe('/cenik');
    expect(targets['/odstoupeni']).toBe('/podminky');
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

  it('E-3-11: soukromí neslibuje, že po odhlášení přestanou chodit VŠECHNY e-maily', async () => {
    const soukromi = await read('app/soukromi/page.tsx');
    expect(soukromi).not.toMatch(/e-maily ti přestanou chodit okamžitě/);
    // provozní zprávy musí být jmenované, jinak je slib zase příliš široký
    expect(soukromi).toMatch(/obnova hesla/);
    expect(soukromi).toMatch(/oznámení o změně podmínek/);
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
    [
      'výpis doimportován',
      failedImportResolvedEmail({ filename: 'vypis.csv', outcome: 'fixed', added: 12 }),
    ],
    [
      'doimport, po kterém ještě něco zbývá',
      failedImportResolvedEmail({
        filename: 'vypis.xlsx',
        outcome: 'fixed',
        added: 4,
        note: 'Výpis ale u 2 titulů neuvádí ISIN.\n\nNahraj report za celou historii účtu.',
      }),
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

  it('adresu provozovatele nenese žádný e-mail', () => {
    // nesl ji jen doklad o uzavřené smlouvě (§ 1824a OZ); bez prodeje ji
    // není důvod rozesílat — je na /podminky
    for (const [nazev, email] of vsechny) {
      const maAdresu =
        bezZalomeni(email.text).includes(OPERATOR.address) ||
        bezZalomeni(email.html ?? '').includes(OPERATOR.address);
      expect(maAdresu, `${nazev}: nese adresu provozovatele`).toBe(false);
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

/**
 * L8a-01: ověřovací e-mail chodí i člověku, na jehož adresu si účet založil
 * někdo cizí. „Nemusíš dělat nic“ mu neřeklo to podstatné — že kliknutím
 * potvrdí účet, který nezaložil. A komu při druhé registraci přestalo platit
 * heslo (`lib/auth-signup.ts`), musí se z téže zprávy dozvědět, kudy dál.
 */
describe('ověřovací e-mail (L8a-01)', () => {
  const email = verifyEmailEmail('https://danero.cz/overeni?token=x');
  const text = bezZalomeni(email.text);

  it('kdo si účet nezakládal, ten na odkaz klikat nemá', () => {
    expect(text).toContain('Pokud sis účet nezakládal, na odkaz neklikej.');
    expect(text).not.toContain('nemusíš dělat nic');
  });

  it('říká, co dělat, když po potvrzení nejde přihlásit heslem', () => {
    expect(text).toContain('Zapomenuté heslo');
    // HTML verze se skládá z týchž bloků — nesmí se rozejít
    expect(email.html).toContain('Zapomenuté heslo');
  });

  it('první odkaz ve zprávě je ten ověřovací', () => {
    // testy i E2E berou z e-mailu první URL; věta o hesle proto odkaz nenese
    expect(email.text.match(/https?:\/\/\S+/)?.[0]).toBe('https://danero.cz/overeni?token=x');
  });
});
