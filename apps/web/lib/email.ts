import { operatorLines, operatorSignature, OPERATOR } from '@/lib/contact';
import { renderHtml, renderText, type EmailBlock } from '@/lib/email-layout';
import { ADR, TERMS_VERSION } from '@/lib/legal';

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
 * Kam míří odpovědi. `From` je `notifikace@danero.cz` a doména **nemá MX
 * záznam**, takže odpověď na ni se nikam nedoručí — a „Odpovědět“ je přitom
 * první, co uživatel udělá, když chce zrušit předplatné. Adresa je stejná,
 * jakou už uvádí potvrzení objednávky.
 */
const REPLY_TO = process.env.RESEND_REPLY_TO ?? OPERATOR.email;
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
    if (process.env.NODE_ENV === 'production') {
      return async () => {
        throw new Error('RESEND_API_KEY není nastaven — e-mail se neodeslal.');
      };
    }
    return async (message) => {
      console.info(`[email:dev] to=${message.to} | ${message.subject}\n${message.text}`);
    };
  }
  const from = process.env.RESEND_FROM ?? 'Danero <notifikace@danero.cz>';
  return async (message) => {
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      replyTo: REPLY_TO,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(message.headers ? { headers: message.headers } : {}),
    });
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
      {
        kind: 'p',
        text: 'Ptáme se proto, že na tuhle adresu ti budou chodit upozornění na limity a termíny — a taky obnova hesla, kdybys ho zapomněl. Kdyby v adrese byl překlep, o účet i s naimportovanými daty bys přišel.',
      },
      { kind: 'note', text: 'Pokud sis účet nezakládal, nemusíš dělat nic.' },
    ],
    footer: operatorSignature(),
  });
}

/**
 * Potvrzení o uzavření smlouvy na trvalém nosiči (§ 1824a OZ) — musí odejít
 * po každém nákupu a nést i poučení o odstoupení. Ceny jsou konečné,
 * provozovatel není plátce DPH.
 *
 * Poučení o odstoupení se pro obě věci LIŠÍ (E-3 z auditu). Podklady jsou
 * digitální obsah dodaný okamžitě — právo zaniká jejich zpřístupněním
 * (§ 1837 písm. l). Roční hlídání je průběžně poskytovaná služba — právo
 * odstoupit trvá a zaniká až úplným poskytnutím (§ 1837 písm. a); při
 * odstoupení se doplácí poměrná část za využité dny (§ 1834). Tvrdit u něj
 * zánik práva by bylo ujednání, ke kterému se nepřihlíží (§ 1812 odst. 2).
 *
 * **Proč je e-mail tak dlouhý (nález E-30):** potvrzení musí obsahovat údaje
 * podle § 1820, ne na ně jen odkázat. Podle rozsudku SDEU C-49/11 (Content
 * Services) není webová stránka trvalý nosič — může se kdykoli změnit, takže
 * odkaz na danero.cz/podminky sám o sobě povinnost nesplní. Trvalým nosičem je
 * tenhle e-mail, proto v něm musí být doba trvání a obnova, práva z vadného
 * plnění, mimosoudní řešení sporů i verze podmínek, podle které se nakupovalo.
 * Nic se nepřikládá jako soubor — všechno podstatné je přímo v textu.
 */
export function purchaseConfirmationEmail(args: {
  what: string;
  priceCzk: number;
  consentGiven: boolean;
  kind: 'subscription' | 'report';
}): Omit<EmailMessage, 'to'> {
  const trvani =
    args.kind === 'subscription'
      ? [
          // částka je cena z ceníku, ne fakturovaná částka ze Stripe — s promo
          // kódem se liší, proto se tu neslibuje jako konečná (souvisí s E-25)
          `Předplatné trvá jeden rok ode dneška a pak se automaticky obnovuje na další rok za cenu podle ceníku (dnes ${args.priceCzk} Kč; uplatněný slevový kód ji může snížit). Přibližně dva týdny před obnovou ti přijde e-mail; obnovu zrušíš kdykoli jedním kliknutím v aplikaci (Předplatné → Spravovat platby) a do konce zaplaceného období ti služba běží dál.`,
          'Nejkratší doba závazku je těch dvanáct měsíců, žádná výpovědní lhůta ani poplatek za ukončení se neúčtují.',
        ]
      : [
          'Jednorázový nákup, nic se neobnovuje a nic dalšího se nestrhne. Zaplacený daňový rok ti v účtu zůstává odemčený i později — včetně pozdějších oprav výpočtu za ten rok.',
        ];
  const odstoupeni =
    args.kind === 'subscription'
      ? [
          'Právo odstoupit od smlouvy do 14 dnů ti u ročního hlídání zůstává — je to průběžně poskytovaná služba. Když odstoupíš, vrátíme ti zaplacenou částku sníženou o poměrnou část za dny, kdy ti hlídání běželo (§ 1834 občanského zákoníku). Formulář najdeš na danero.cz/odstoupeni.',
        ]
      : args.consentGiven
        ? [
            'Právo odstoupit od smlouvy do 14 dnů u digitálního obsahu dodaného okamžitě zaniká, jakmile ti ho zpřístupníme — a ty jsi při objednávce výslovně požádal, abychom začali hned, a vzal na vědomí, že tím právo odstoupit ztrácíš (§ 1837 písm. l občanského zákoníku).',
          ]
        : [
            `Od smlouvy můžeš odstoupit do 14 dnů bez udání důvodu — napiš na ${OPERATOR.email} nebo použij formulář na danero.cz/odstoupeni.`,
          ];

  return zprava({
    subject: `Potvrzení objednávky — ${args.what}`,
    preheader: `Uzavřená smlouva a poučení o odstoupení. Cena ${args.priceCzk} Kč.`,
    blocks: [
      {
        kind: 'p',
        text: 'Díky za objednávku. Tohle je potvrzení uzavřené smlouvy — ulož si ho, shrnuje všechno podstatné, co jsme si ujednali.',
      },
      {
        kind: 'rows',
        rows: [
          ['Co sis pořídil', args.what],
          ['Cena', `${args.priceCzk} Kč — konečná`],
          ['Podmínky užití', `verze ${TERMS_VERSION}`],
        ],
      },
      // § 1824a odkazuje na § 1820: potvrzení na trvalém nosiči musí nést
      // i adresu prodávajícího. Tohle je jediný e-mail, kde adresa je —
      // ve zbytku stačí jméno a IČO (viz `operatorSignature`).
      { kind: 'h', text: 'Prodávající' },
      { kind: 'p', text: operatorLines().join(' ').replace(/^Prodávající: /, '') },
      { kind: 'h', text: 'Doba trvání' },
      ...trvani.map((text): EmailBlock => ({ kind: 'p', text })),
      { kind: 'h', text: 'Odstoupení od smlouvy' },
      ...odstoupeni.map((text): EmailBlock => ({ kind: 'p', text })),
      { kind: 'h', text: 'Co je k užívání potřeba' },
      {
        kind: 'p',
        text: 'Běžný webový prohlížeč a funkční e-mailová adresa, nic se neinstaluje. Soubory, které si z Danera stáhneš (XML pro portál MOJE daně, export dat v JSON), nejsou chráněné žádným technickým opatřením ani vázané na zařízení.',
      },
      { kind: 'h', text: 'Když něco nefunguje' },
      {
        kind: 'p',
        text: `Když Danero nedělá, co slibujeme, máš zákonná práva z vadného plnění a nijak je neomezujeme. Uplatni je na ${OPERATOR.email} — tamtéž patří i případná stížnost.`,
      },
      {
        kind: 'note',
        text: `Když se nedohodneme a jsi spotřebitel, můžeš se obrátit na subjekt mimosoudního řešení spotřebitelských sporů — ${ADR.authority}, ${ADR.address}, ${ADR.web}; návrh jde podat online na ${ADR.online}.`,
      },
      {
        kind: 'note',
        text: `Doklad o zaplacení a historii plateb najdeš v aplikaci v sekci Předplatné. Úplné znění podmínek je na danero.cz/podminky a na požádání ti ho pošleme e-mailem.`,
      },
    ],
    footer: operatorSignature(),
  });
}

/**
 * Oznámení před automatickou obnovou předplatného. Slibují ho /podminky,
 * /cenik i /predplatne — bez něj by šlo o tichý auto-renew, který docs/19 §5
 * výslovně zakazuje, a o nepravdivé tvrzení ve smluvních podmínkách.
 *
 * Jde o službní sdělení ke smlouvě, ne obchodní sdělení — proto bez opt-outu.
 */
export function subscriptionRenewalEmail(args: {
  renewsOn: string;
  priceCzk: number;
}): Omit<EmailMessage, 'to'> {
  return zprava({
    subject: `Předplatné Danera se obnoví ${args.renewsOn}`,
    preheader: `Za ${args.priceCzk} Kč na další rok. Nechceš-li pokračovat, zruš obnovu do toho data.`,
    blocks: [
      {
        kind: 'p',
        text: `Tvoje roční hlídání daní z investic se ${args.renewsOn} automaticky obnoví na další rok a strhneme ${args.priceCzk} Kč. Cena je konečná.`,
      },
      {
        kind: 'rows',
        rows: [
          ['Obnoví se', args.renewsOn],
          ['Částka', `${args.priceCzk} Kč`],
        ],
      },
      { kind: 'p', text: 'Chceš-li pokračovat, nemusíš dělat nic.' },
      {
        kind: 'p',
        text: 'Pokud pokračovat nechceš, zruš obnovu do toho data v aplikaci — Předplatné → Spravovat platby → zrušit obnovu. Do konce zaplaceného období ti služba poběží dál.',
      },
      { kind: 'cta', label: 'Spravovat předplatné', url: 'https://danero.cz/predplatne' },
      { kind: 'note', text: 'Podmínky užití: danero.cz/podminky' },
    ],
    footer: operatorSignature(),
  });
}
