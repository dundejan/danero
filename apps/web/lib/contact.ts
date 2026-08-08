/**
 * Kontaktní údaje provozovatele, které vyžaduje § 1820 odst. 1 písm. c) OZ
 * u smluv uzavíraných na dálku: adresa sídla, **telefonní číslo** a e-mail.
 *
 * Telefon schválně NENÍ v repozitáři. Je to osobní číslo provozovatele a
 * repozitář je veřejný — jednou commitnuté číslo už z historie nezmizí.
 * Zákonná povinnost se přitom splní stejně dobře proměnnou prostředí, takže
 * na produkci je číslo vidět a ve zdrojácích ne (nález E-28).
 *
 * Nastavení: `DANERO_CONTACT_PHONE` ve Vercelu (Production). Bez ní se telefon
 * nikde nevypisuje — vlastní instance tím netrpí, provozovatel si tam vyplní
 * svůj vlastní kontakt.
 */
export interface OperatorContact {
  name: string;
  ico: string;
  address: string;
  email: string;
  /** `null`, když proměnná není nastavená — UI pak telefon prostě nevypíše. */
  phone: string | null;
}

export const OPERATOR: OperatorContact = {
  name: 'Jan Dunder',
  ico: '19642661',
  address: 'adresa-provozovatele-v-promenne-prostredi',
  email: 'dunder.jan@gmail.com',
  phone: process.env.DANERO_CONTACT_PHONE?.trim() || null,
};

/** Řádek „Prodávající: …“ do potvrzení objednávky a dalších dokladů. */
export function operatorLines(contact: OperatorContact = OPERATOR): string[] {
  return [
    `Prodávající: ${contact.name}, IČO ${contact.ico}, ${contact.address}.`,
    `Není plátcem DPH. Kontakt: ${contact.email}${contact.phone ? `, ${contact.phone}` : ''}`,
  ];
}

/**
 * Patička služebních e-mailů (obnova hesla, ověření adresy, digest).
 *
 * Obchodní sdělení to nejsou, takže identifikaci zákon nevyžaduje — jenže
 * e-mail bez odesílatele a bez kontaktu vypadá jako phishing přesně u těch
 * zpráv, které nesou odkaz ke změně hesla (nález E-46). Adresa je navíc jediná
 * cesta, jak odpovědět: `From` je notifikace@danero.cz a ta schránka poštu
 * nepřijímá.
 */
export function operatorSignature(contact: OperatorContact = OPERATOR): string[] {
  return [
    '—',
    `Danero — ${contact.name}, IČO ${contact.ico}, ${contact.address}`,
    `Napiš nám: ${contact.email}${contact.phone ? `, ${contact.phone}` : ''}`,
  ];
}
