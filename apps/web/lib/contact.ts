/**
 * Kontaktní údaje provozovatele: jméno, IČO, **adresa sídla** a e-mail —
 * identifikace podnikatele na webu (§ 435 OZ) a totožnost správce osobních
 * údajů (čl. 13 GDPR). Telefon je volitelný: povinný byl jen u prodeje na
 * dálku (§ 1820 odst. 1 písm. c OZ) a ten skončil 8. 10. 2026, kdy se Danero
 * stalo celé bezplatným.
 *
 * ⚠️ **Žádný z těch údajů nepatří do repozitáře.** Repozitář je veřejný a pod
 * AGPL, takže by si každý, kdo si Danero rozjede sám, vozil s sebou identifikaci
 * cizího člověka — a hlavně: jednou commitnutá adresa z historie nezmizí, ani
 * když se provozovatel přestěhuje. Telefon se takhle držel od nálezu E-28,
 * zbytek se doplnil 10. 8. 2026 spolu s přepsáním historie.
 *
 * Nastavení (Vercel → Production i Preview, lokálně `.env.local`):
 * `DANERO_OPERATOR_NAME`, `DANERO_OPERATOR_ICO`, `DANERO_OPERATOR_ADDRESS`,
 * `DANERO_CONTACT_EMAIL`, `DANERO_CONTACT_PHONE`.
 *
 * Bez nich se vypíše zástupný text. To je schválně vidět na první pohled:
 * uživatel svěřuje službě svoje obchody a klíče k brokerovi a má právo vědět
 * komu, takže je lepší mít na stránce nápadné „nenastaveno" než tiše nic.
 * Hlídá to i `/api/health` (`operatorContact: 'incomplete'`).
 */
export interface OperatorContact {
  name: string;
  ico: string;
  address: string;
  email: string;
  /** `null`, když proměnná není nastavená — UI pak telefon prostě nevypíše. */
  phone: string | null;
}

/**
 * Zdroj hodnot: `process.env` i prostředí, které si podstrčí test. Schválně ne
 * `NodeJS.ProcessEnv` — Next si v něm vynucuje `NODE_ENV`, takže by se z něj
 * nedal poskládat holý objekt s jednou proměnnou.
 */
export type EnvSource = Record<string, string | undefined>;

/** Zástupný text pro nenastavený povinný údaj — musí být poznat na první pohled. */
export const OPERATOR_UNSET = 'nenastaveno';

const fromEnv = (value: string | undefined): string => value?.trim() || OPERATOR_UNSET;

/**
 * Identifikace z libovolného prostředí.
 *
 * Parametr existuje kvůli nástrojům provozovatele: `OPERATOR` se přečte jednou
 * při načtení modulu, ale předletová kontrola (`lib/operator-env.ts`) musí umět
 * posoudit i prostředí, které jí někdo podstrčí — jinak by se nedala otestovat.
 */
export function operatorFromEnv(env: EnvSource = process.env): OperatorContact {
  return {
    name: fromEnv(env.DANERO_OPERATOR_NAME),
    ico: fromEnv(env.DANERO_OPERATOR_ICO),
    address: fromEnv(env.DANERO_OPERATOR_ADDRESS),
    email: fromEnv(env.DANERO_CONTACT_EMAIL),
    phone: env.DANERO_CONTACT_PHONE?.trim() || null,
  };
}

export const OPERATOR: OperatorContact = operatorFromEnv();

/**
 * Které proměnné nesou který povinný údaj. Jediné místo, kde je ten seznam —
 * kopie podmínky jinde je přesně to, jak se rozejde chování s hláškou.
 */
const OPERATOR_ENV_NAMES = {
  name: 'DANERO_OPERATOR_NAME',
  ico: 'DANERO_OPERATOR_ICO',
  address: 'DANERO_OPERATOR_ADDRESS',
  email: 'DANERO_CONTACT_EMAIL',
} as const;

/** Nenastavené povinné údaje, pojmenované proměnnou — ať je z hlášky co nastavit. */
export function missingOperatorContactEnv(contact: OperatorContact = OPERATOR): string[] {
  return Object.entries(OPERATOR_ENV_NAMES)
    .filter(([field]) => contact[field as keyof typeof OPERATOR_ENV_NAMES] === OPERATOR_UNSET)
    .map(([, name]) => name);
}

/** Je identifikace provozovatele kompletní? Čte `/api/health`. */
export function operatorContactComplete(contact: OperatorContact = OPERATOR): boolean {
  return missingOperatorContactEnv(contact).length === 0;
}

/**
 * Patička služebních e-mailů (obnova hesla, ověření adresy, digest, upomínka).
 *
 * Obchodní sdělení to nejsou, takže identifikaci zákon nevyžaduje — jenže
 * e-mail bez odesílatele a bez kontaktu vypadá jako phishing přesně u těch
 * zpráv, které nesou odkaz ke změně hesla (nález E-46). Kontakt je navíc
 * jediná cesta, jak odpovědět: `From` je notifikace@danero.cz a ta schránka
 * poštu nepřijímá.
 *
 * **Poštovní adresa tu ale NENÍ.** Identifikaci proti phishingu obstará jméno
 * a IČO (podle nějž si kdokoli dohledá zbytek v rejstříku); adresa je na
 * `/podminky`. Rozesílat ji v každé zprávě o obnově hesla je zbytečné.
 */
export function operatorSignature(contact: OperatorContact = OPERATOR): string[] {
  return [
    `Danero — ${contact.name}, IČO ${contact.ico}`,
    `Napiš nám: ${contact.email}`,
  ];
}
