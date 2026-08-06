/**
 * Odesílání e-mailů. Vytaženo z lib/notifications.ts, aby si auth vrstva
 * netahala celý daňový engine kvůli jednomu `send()`.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
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

/** Resend za env klíčem; bez něj dev log (žádný setup, nic se neposílá). */
export function resolveEmailSender(): EmailSender {
  const logPath = process.env.DANERO_EMAIL_LOG;
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
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    if (error) throw new Error(`Resend: ${error.message}`);
  };
}

/**
 * Obnova hesla. Záměrně nepotvrzuje, že účet existuje — text musí dávat smysl
 * i člověku, kterému někdo cizí zadal adresu do formuláře.
 */
export function resetPasswordEmail(url: string): Omit<EmailMessage, 'to'> {
  return {
    subject: 'Obnova hesla do Danera',
    text: [
      'Někdo požádal o nastavení nového hesla k účtu v Daneru.',
      '',
      'Nové heslo si nastavíš tady:',
      url,
      '',
      'Odkaz platí hodinu a použít ho jde jen jednou. Po změně hesla tě Danero',
      'odhlásí ze všech zařízení.',
      '',
      'Pokud jsi o obnovu nežádal, nemusíš dělat nic — heslo zůstává beze změny.',
    ].join('\n'),
  };
}

/** Potvrzení adresy po registraci — vysvětluje, proč to po uživateli chceme. */
export function verifyEmailEmail(url: string): Omit<EmailMessage, 'to'> {
  return {
    subject: 'Potvrď svůj e-mail v Daneru',
    text: [
      'Vítej v Daneru. Potvrď prosím, že ti tahle adresa patří:',
      url,
      '',
      'Odkaz platí 24 hodin.',
      '',
      'Ptáme se proto, že na tuhle adresu ti budou chodit upozornění na limity',
      'a termíny — a taky obnova hesla, kdybys ho zapomněl. Kdyby v adrese byl',
      'překlep, o účet i s naimportovanými daty bys přišel.',
      '',
      'Pokud sis účet nezakládal, nemusíš dělat nic.',
    ].join('\n'),
  };
}

/**
 * Potvrzení o uzavření smlouvy na trvalém nosiči (§ 1824a OZ) — musí odejít
 * po každém nákupu a nést i poučení o odstoupení. Ceny jsou konečné,
 * provozovatel není plátce DPH.
 */
export function purchaseConfirmationEmail(args: {
  what: string;
  priceCzk: number;
  consentGiven: boolean;
}): Omit<EmailMessage, 'to'> {
  const odstoupeni = args.consentGiven
    ? [
        'Právo odstoupit od smlouvy do 14 dnů: u digitálního obsahu dodaného',
        'okamžitě zaniká, jakmile začneme plnit — a ty jsi při objednávce výslovně',
        'požádal, abychom začali hned, a vzal na vědomí, že tím právo odstoupit',
        'ztrácíš (§ 1837 písm. l občanského zákoníku).',
      ]
    : [
        'Od smlouvy můžeš odstoupit do 14 dnů bez udání důvodu — napiš na',
        'dunder.jan@gmail.com nebo použij formulář na danero.cz/odstoupeni.',
      ];

  return {
    subject: `Potvrzení objednávky — ${args.what}`,
    text: [
      'Díky za objednávku. Tohle je potvrzení uzavřené smlouvy, ulož si ho.',
      '',
      `Co sis pořídil: ${args.what}`,
      `Cena: ${args.priceCzk} Kč — cena je konečná`,
      '',
      'Prodávající: Jan Dunder, IČO 19642661, [adresa odstraněna] 640/3, Vršovice,',
      '101 00 Praha 10. Není plátcem DPH.',
      '',
      ...odstoupeni,
      '',
      'Doklad o zaplacení a historii plateb najdeš v aplikaci v sekci',
      'Předplatné. Podmínky užití: danero.cz/podminky',
    ].join('\n'),
  };
}
