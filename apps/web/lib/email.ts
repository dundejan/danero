import { type EnvSource, operatorSignature, OPERATOR, OPERATOR_UNSET } from '@/lib/contact';
import { renderHtml, renderText, type EmailBlock } from '@/lib/email-layout';
import { plural } from '@/lib/format';

/**
 * Odesílání e-mailů. Vytaženo z lib/notifications.ts, aby si auth vrstva
 * netahala celý daňový engine kvůli jednomu `send()`.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /**
   * Textová verze. Posílá se VŽDY vedle HTML: uvidí ji čtečka, klient
   * s vypnutým HTML i spamový filtr (zpráva jen s HTML si zhoršuje skóre),
   * a u potvrzení objednávky je to plnění na trvalém nosiči (§ 1824a OZ).
   */
  text: string;
  /** HTML verze — skládá ji `lib/email-layout.ts` z týchž bloků jako text. */
  html?: string;
  /**
   * Strojové hlavičky navíc — dnes jen `List-Unsubscribe` a
   * `List-Unsubscribe-Post` u hromadného digestu (RFC 8058). Bez nich Gmail
   * nenabídne vlastní tlačítko „Odhlásit odběr“ a uživatel místo něj sáhne po
   * „Nahlásit spam“, což poškodí doručitelnost i u obnovy hesla.
   */
  headers?: Record<string, string>;
}

/**
 * Kam míří odpovědi. `From` je `notifikace@danero.cz` — schránka, kterou nikdo
 * nečte — a „Odpovědět“ je přitom první, co uživatel udělá, když něčemu
 * nerozumí nebo chce e-maily zastavit. Bez `Reply-To` by jeho zpráva zmizela.
 *
 * Od 31. 8. 2026 má doména MX (přeposílání ImprovMX → schránka provozovatele)
 * a produkce nastavuje `RESEND_REPLY_TO=odpovedi@danero.cz`. Do té doby padal
 * fallback na `OPERATOR.email`, což byl freemail: SpamAssassin za to bere
 * `FREEMAIL_FORGED_REPLYTO`, tedy **2,095 bodu z prahu 5,0**. Změřeno
 * mail-testerem před i po — 2,1 bodu odpadlo, zpráva má 0,1 z 5,0.
 *
 * ⚠️ Fallback tu zůstává schválně: bez něj by odpovědi mizely na instanci,
 * kde `RESEND_REPLY_TO` nastavená není (cizí self-hosting, dev). Freemail
 * v Reply-To je horší než doménová adresa, ale nekonečně lepší než žádná.
 *
 * Dvě pojistky pro vlastní instanci (L10-08): prázdná `RESEND_REPLY_TO` je
 * nenastavená (`.env` s řádkem `RESEND_REPLY_TO=` nebo compose ji předají jako
 * `""` a `??` by u ní zůstalo stát), a když chybí i kontakt provozovatele,
 * hlavička se **vynechá** — dřív odcházelo `reply_to: "nenastaveno"`, tedy
 * zástupný text z `lib/contact.ts` místo adresy, a Resend zprávu odmítl.
 */
function replyToAddress(): string | undefined {
  const explicit = process.env.RESEND_REPLY_TO?.trim();
  if (explicit) return explicit;
  return OPERATOR.email === OPERATOR_UNSET ? undefined : OPERATOR.email;
}

/** Odesílatel, když `RESEND_FROM` není nastavená. */
const DEFAULT_FROM = 'Danero <notifikace@danero.cz>';

/**
 * Kam chodí provozní upozornění (dnes: „výpis jsme nepřečetli"). Není to zpráva
 * pro zákazníka, ale pro toho, kdo Danero provozuje — a jeho adresa **nesmí být
 * v kódu** (pravidlo 8: repozitář je veřejný a jednou commitnutá adresa
 * z historie nezmizí). Vlastní proměnná proto, že self-hoster může chtít
 * provozní poštu jinam než veřejný kontakt z § 435.
 *
 * `null` = není kam poslat (nenastavené proměnné) → volající to jen zaloguje.
 */
export function alertRecipient(): string | null {
  const explicit = process.env.DANERO_ALERT_EMAIL?.trim();
  if (explicit) return explicit;
  return OPERATOR.email === OPERATOR_UNSET ? null : OPERATOR.email;
}

export type EmailSender = (message: EmailMessage) => Promise<void>;

/**
 * Testovací výstup: `DANERO_EMAIL_LOG=cesta` přesměruje e-maily do souboru
 * (JSON řádek na zprávu) místo odeslání. Nastavuje ho JEN Playwright, aby
 * E2E prošlo skutečný ověřovací odkaz místo obcházení ověření e-mailu.
 */
function fileSink(path: string): EmailSender {
  return async (message) => {
    const { appendFileSync, mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(message)}\n`);
  };
}

/**
 * Strop na jedno odeslání přes Resend (K5-11).
 *
 * Resend 4.8 volá holý `fetch(url, options)` bez `signal`, takže vlastní
 * timeout nepřijme — jediný způsob, jak čekání ukončit, je `Promise.race`.
 * Bez něj se čeká, dokud se neozve undici se svým `headersTimeout`, což je
 * **300 s**: jediný zaseknutý e-mail sežere celých 300 s `maxDuration` cronu.
 * Netrpí tím jen cron — na témž volání visí i uživatelské server actions
 * (obnova hesla, ověřovací e-mail).
 *
 * 15 s: odeslání jedné zprávy přes API trvá zlomek sekundy, takže je to
 * dvacetinásobná rezerva. I když se zasekne každé odeslání, dávka
 * notifikačního cronu skončí na svém časovém stropu (225 s) a štafeta se
 * pořád stihne předat dál. Pro člověka, který čeká na odpověď formuláře,
 * je 15 s horní mez toho, co se dá vydržet.
 *
 * Vypršení je SELHÁNÍ odeslání (výjimka), ne tichý úspěch: volající na tom
 * mají vrácení claimu u digestu i potvrzení objednávky a hlášku uživateli
 * u obnovy hesla.
 */
const SEND_TIMEOUT_MS = 15_000;

/**
 * `Promise.race` s úklidem časovače. Běžící `fetch` tím nezmizí (zrušit ho
 * bez `AbortSignal` nejde), ale přestáváme na něj čekat — a odmítnutí, které
 * dorazí později, má race pořád obsloužené, takže z něj nevznikne
 * unhandled rejection.
 */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Resend neodpověděl do ${ms / 1000} s — e-mail se neodeslal.`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Má instance čím e-mail doručit — nebo aspoň ukázat tomu, kdo ji spouští?
 *
 * Ne = produkční režim bez `RESEND_API_KEY` i bez `DANERO_EMAIL_LOG`, což je
 * přesně vlastní instance z compose bez Resendu (L10-01): `resolveEmailSender`
 * tam každé odeslání shodí. Stránka `/overeni-emailu` se ptá tady, aby
 * netvrdila „poslali jsme ti odkaz“ o zprávě, která neodešla. Mimo produkci
 * se zpráva vypíše do konzole, takže se k odkazu vývojář dostane.
 *
 * Podmínku má odesílač i stránka z jednoho místa — kopie by se rozešla.
 */
export function emailDeliveryConfigured(env: EnvSource = process.env): boolean {
  if (env.DANERO_EMAIL_LOG || env.RESEND_API_KEY) return true;
  return env.NODE_ENV !== 'production';
}

/** Resend za env klíčem; bez něj dev log (žádný setup, nic se neposílá). */
export function resolveEmailSender(): EmailSender {
  const logPath = process.env.DANERO_EMAIL_LOG;
  // Pojistka v duchu té u chybějícího RESEND_API_KEY níž: kde je nakonfigurované
  // skutečné odesílání, tam přesměrování do souboru znamená němou frontu —
  // a ověřovací i resetovací odkazy v plaintextu na disku. Podmínka schválně
  // není na NODE_ENV: `pnpm test:e2e:prod` běží taky v produkčním režimu, ale
  // Resend klíč nemá, takže ho to nesmí zastavit.
  if (logPath && process.env.RESEND_API_KEY) {
    throw new Error(
      'DANERO_EMAIL_LOG je nastaven vedle RESEND_API_KEY — e-maily by se neodeslaly a odkazy by ležely v souboru. Proměnnou odstraň.',
    );
  }
  if (logPath) {
    console.warn(`[email] DANERO_EMAIL_LOG je nastaven — e-maily jdou do ${logPath}, neodesílají se.`);
    return fileSink(logPath);
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // produkce bez klíče nesmí e-mail tiše „odeslat“ do console — u notifikací
    // by to označilo frontu za doručenou, u obnovy hesla by uživatel čekal
    // na zprávu, která nikdy nepřijde
    if (!emailDeliveryConfigured()) {
      return async () => {
        throw new Error('RESEND_API_KEY není nastaven — e-mail se neodeslal.');
      };
    }
    return async (message) => {
      console.info(`[email:dev] to=${message.to} | ${message.subject}\n${message.text}`);
    };
  }
  // `||`, ne `??`: compose (`${RESEND_FROM:-}`) i řádek `RESEND_FROM=` v .env
  // dají prázdný řetězec a zpráva by odešla s odesílatelem "" (L10-08).
  const from = process.env.RESEND_FROM?.trim() || DEFAULT_FROM;
  const replyTo = replyToAddress();
  return async (message) => {
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    const { error } = await withTimeout(
      resend.emails.send({
        from,
        ...(replyTo ? { replyTo } : {}),
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(message.headers ? { headers: message.headers } : {}),
      }),
      SEND_TIMEOUT_MS,
    );
    if (error) throw new Error(`Resend: ${error.message}`);
  };
}


/**
 * Složí zprávu z bloků — text i HTML z jednoho zdroje, aby se nerozešly.
 * `preheader` je řádek, který schránky ukazují v seznamu vedle předmětu;
 * bez něj tam Gmail vytáhne první větu těla, což u „Někdo požádal o…“
 * vypadá jako phishing.
 */
function zprava(args: {
  subject: string;
  preheader: string;
  blocks: EmailBlock[];
  footer: string[];
}): Omit<EmailMessage, 'to'> {
  return {
    subject: args.subject,
    text: renderText(args.blocks, args.footer),
    html: renderHtml({
      title: args.subject,
      preheader: args.preheader,
      blocks: args.blocks,
      footer: args.footer,
    }),
  };
}

/**
 * Obnova hesla. Záměrně nepotvrzuje, že účet existuje — text musí dávat smysl
 * i člověku, kterému někdo cizí zadal adresu do formuláře.
 */
export function resetPasswordEmail(url: string): Omit<EmailMessage, 'to'> {
  return zprava({
    subject: 'Obnova hesla do Danera',
    preheader: 'Odkaz na nastavení nového hesla platí hodinu.',
    blocks: [
      { kind: 'p', text: 'Někdo požádal o nastavení nového hesla k účtu v Daneru.' },
      { kind: 'cta', label: 'Nastavit nové heslo', url },
      {
        kind: 'p',
        text: 'Odkaz platí hodinu a použít ho jde jen jednou. Po změně hesla tě Danero odhlásí ze všech zařízení.',
      },
      {
        kind: 'note',
        text: 'Pokud jsi o obnovu nežádal, nemusíš dělat nic — heslo zůstává beze změny.',
      },
    ],
    footer: operatorSignature(),
  });
}

/** Potvrzení adresy po registraci — vysvětluje, proč to po uživateli chceme. */
export function verifyEmailEmail(url: string): Omit<EmailMessage, 'to'> {
  return zprava({
    subject: 'Potvrď svůj e-mail v Daneru',
    preheader: 'Poslední krok k účtu — odkaz platí 24 hodin.',
    blocks: [
      { kind: 'p', text: 'Vítej v Daneru. Potvrď prosím, že ti tahle adresa patří.' },
      { kind: 'cta', label: 'Potvrdit e-mail', url },
      { kind: 'p', text: 'Odkaz platí 24 hodin.' },
      // L8a-01: přijde-li na nepotvrzený účet registrace s jiným heslem, heslo
      // přestane platit (lib/auth-signup.ts). Věta je tu obecně, ať na to
      // nemusí být druhá šablona — tutéž zprávu dostane i ten, komu heslo platí.
      {
        kind: 'p',
        text: 'Kdyby ti po potvrzení nešlo přihlásit se heslem, nastav si nové přes „Zapomenuté heslo“ na přihlašovací stránce.',
      },
      // „Nemusíš dělat nic“ tu nestačilo: kdo na odkaz klikne, potvrdí účet,
      // který na jeho adresu založil někdo jiný.
      { kind: 'note', text: 'Pokud sis účet nezakládal, na odkaz neklikej.' },
    ],
    footer: operatorSignature(),
  });
}

/** Veřejná adresa aplikace pro odkazy v e-mailech (stejně jako v notifications.ts). */
const appUrl = (): string => process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';

/**
 * Provozní upozornění: uživateli jsme nepřečetli výpis.
 *
 * Nechodí zákazníkovi, ale provozovateli — je to jediný způsob, jak se
 * o změněném formátu brokera vůbec dozvědět dřív, než si někdo stěžuje.
 *
 * ⚠️ **Samotný soubor se sem nikdy nedává** (ani jako příloha): jsou to všechny
 * obchody jednoho člověka a e-mail je nejhorší možné úložiště. Originál leží
 * v `failed_imports` a dostane se k němu jen skript `scripts/failed-imports.ts`.
 * Ze souboru jde ven **první řádek** (pročištěný `printableSample`) a chybová
 * hláška — ta u parseru brokera cituje hodnotu z řádku, na kterém se zastavil,
 * takže jednu buňku ven vzít může. Není to nutně hlavička: reálné exporty
 * začínají preambulí a vzorek se bere bez ptaní (K6a-04). K tomu jde ven
 * e-mailová adresa uživatele a to, co k výpisu sám dopsal (platforma
 * a poznámka) — adresátem je provozovatel sám, ale slib na /soukromi to musí
 * jmenovat (K4-06). Přesně tak to /soukromi říká; kdyby se měl obsah e-mailu
 * změnit, musí se změnit obojí.
 */
export function failedImportAlertEmail(args: {
  caseId: string;
  filename: string;
  byteSize: number;
  reason: string;
  headerSample: string;
  userEmail: string;
  reportedPlatform?: string | null;
  reportedNote?: string | null;
  /**
   * Doplnil to UŽIVATEL? Neodvozovat z vyplněné platformy — u výpisu staženého
   * z API si ji Danero předvyplní samo, takže by první automatické upozornění
   * tvrdilo „uživatel nahlásil“ o někom, kdo neudělal nic, a v schránce by
   * nešly odlišit čerstvé nálezy od skutečných hlášení.
   */
  reported?: boolean;
}): Omit<EmailMessage, 'to'> {
  const reported = args.reported === true;
  return zprava({
    subject: reported
      ? `Danero: uživatel nahlásil nepřečtený výpis (${args.reportedPlatform ?? 'bez platformy'})`
      : `Danero: nepřečetli jsme výpis (${args.filename})`,
    preheader: args.reason.slice(0, 120),
    blocks: [
      {
        kind: 'p',
        text: reported
          ? 'Uživatel doplnil, odkud jeho nepřečtený výpis je. Originál čeká na rozbor.'
          : 'Import spadl na nepoznaném formátu. Originál je uložený, uživatel vidí, že se na to podíváme.',
      },
      {
        kind: 'rows',
        rows: [
          ['Případ', args.caseId],
          ['Soubor', args.filename],
          // pod kilobajt vypisuj bajty — „0 kB“ vypadá jako prázdný soubor,
          // a to je úplně jiná diagnóza
          [
            'Velikost',
            args.byteSize < 1024 ? `${args.byteSize} B` : `${Math.round(args.byteSize / 1024)} kB`,
          ],
          ['Uživatel', args.userEmail],
          ...(args.reportedPlatform ? ([['Platforma', args.reportedPlatform]] as [string, string][]) : []),
          ...(args.reportedNote ? ([['Poznámka', args.reportedNote]] as [string, string][]) : []),
        ],
      },
      { kind: 'h', text: 'Proč to spadlo' },
      { kind: 'p', text: args.reason },
      ...(args.headerSample
        ? ([{ kind: 'h', text: 'Hlavička souboru' }, { kind: 'p', text: args.headerSample }] as EmailBlock[])
        : []),
      {
        kind: 'note',
        text: `Rozbor: pnpm --filter @danero/web failed-imports dump ${args.caseId} — pak retry ${args.caseId}, až parser umí číst.`,
      },
    ],
    footer: ['Danero — provozní upozornění, nechodí zákazníkům.'],
  });
}

/**
 * Zpráva uživateli, jak dopadl jeho nepřečtený výpis.
 *
 * Posílá se PŘÍMO, ne přes digest v `api/cron/notify` — ten se řídí přepínači
 * v Nastavení, takže kdo má hlídací e-maily vypnuté, výsledek by se nikdy
 * nedozvěděl. Je to služební sdělení k jeho vlastnímu nahrání, ne hlídací
 * upozornění, takže do přepínačů nespadá.
 */
export function failedImportResolvedEmail(args: {
  filename: string;
  /** `fixed` = doimportováno, `rejected` = číst to neumíme. */
  outcome: 'fixed' | 'rejected';
  /** Kolik transakcí přibylo (jen u `fixed`). */
  added?: number;
  /**
   * Co má uživatel ještě udělat — odstavce oddělené prázdným řádkem.
   * U `rejected` vysvětlení, proč výpis nečteme. U `fixed` to, co import
   * nedotáhl sám (typicky tituly bez ISIN): zpráva pak NESMÍ slibovat
   * „dělat už nemusíš nic“.
   */
  note?: string | null;
}): Omit<EmailMessage, 'to'> {
  const url = `${appUrl()}/import`;
  const notes: EmailBlock[] = (args.note ?? '')
    .split(/\n{2,}/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ kind: 'p', text }));
  if (args.outcome === 'fixed') {
    const pending = notes.length > 0;
    const added = args.added ?? 0;
    // added === 0 bez poznámky znamená, že tytéž obchody už v Daneru máš
    // odjinud — slíbit „nově z něj máš 0 transakcí“ by znělo jako porucha.
    // S poznámkou to tvrdit nejde: nula může být i výpis, kde všechno čeká
    // na doplnění titulů.
    const result =
      added > 0
        ? `Doplnili jsme jeho formát do Danera a nahráli ho za tebe — nově z něj máš ${added} ${plural(added, 'transakci', 'transakce', 'transakcí')}.`
        : pending
          ? 'Jeho formát jsme do Danera doplnili a výpis nahráli za tebe — nic nového z něj ale zatím nepřibylo.'
          : 'Formát jsme do Danera doplnili a výpis načetli — všechny obchody z něj už jsi mezitím měl uložené odjinud, takže se ti čísla nezmění.';
    return zprava({
      subject: pending
        ? 'Tvůj výpis už umíme přečíst — zbývá ho doplnit'
        : 'Tvůj výpis už umíme přečíst — je naimportovaný',
      preheader: pending
        ? `${args.filename}: formát už umíme, se zbytkem potřebujeme pomoct.`
        : `${args.filename}: hotovo, nic dalšího dělat nemusíš.`,
      blocks: [
        {
          kind: 'p',
          text: `Výpis „${args.filename}“ jsme minule nepřečetli. ${result}${pending ? '' : ' Dělat už nemusíš nic.'}`,
        },
        ...notes,
        { kind: 'cta', label: pending ? 'Otevřít Zdroje dat' : 'Zkontrolovat import', url },
        {
          kind: 'note',
          text: 'Nic se nezdvojilo — Danero pozná obchody, které už máš uložené. Díky, že jsi nám tím pomohl vylepšit čtení výpisů.',
        },
      ],
      footer: operatorSignature(),
    });
  }
  return zprava({
    subject: 'Tvůj výpis se nám přečíst nepodařilo',
    preheader: `${args.filename}: co s tím dál.`,
    blocks: [
      {
        kind: 'p',
        text: `Prošli jsme si výpis „${args.filename}“, který se nám nepodařilo naimportovat. Bohužel ho číst neumíme.`,
      },
      ...notes,
      {
        kind: 'p',
        text: 'Data se do Danera dostanou i tak: stáhni od své platformy jiný typ exportu (v seznamu na stránce Zdroje dat je u každé napsané, který chceme), nebo je přepiš do univerzální šablony, kterou si tamtéž stáhneš.',
      },
      { kind: 'cta', label: 'Otevřít Zdroje dat', url },
    ],
    footer: operatorSignature(),
  });
}
