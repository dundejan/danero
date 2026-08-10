/**
 * Testovací identita provozovatele pro E2E.
 *
 * Skutečné údaje (jméno, IČO, adresa, e-mail) jdou od 10. 8. 2026 z prostředí
 * a v repozitáři nejsou — viz `lib/contact.ts` a pravidlo 8 v CLAUDE.md.
 * E2E si proto nastaví vlastní, zjevně smyšlené: testy tak ověřují, že se
 * údaje z prostředí opravdu propíšou do stránek, a zároveň v repu nezůstává
 * ničí identifikace.
 */
export const E2E_OPERATOR = {
  name: 'Zkušební Provozovatel',
  ico: '00000019',
  address: 'Zkušební 1, 100 00 Zkušebno',
  email: 'provozovatel@priklad.test',
} as const;
