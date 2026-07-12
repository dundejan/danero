/**
 * Katalog podporovaných platforem — jediný zdroj pravdy pro stránku Zdroje dat
 * i landing. Pokrývá minimálně vše, co podporuje Taxomat (docs/11-plan-brokeri.md).
 *
 * `method`:
 *  - 'api'      — živé napojení (klíč jen pro čtení), plus jde nahrát i výpis
 *  - 'file'     — vlastní parser výpisu (autodetekce při nahrání)
 *  - 'template' — vedený import: návod kde výpis stáhnout + univerzální šablona
 *                 (vlastní parser doplníme, jakmile budeme mít reálný vzorek)
 *
 * `color` je orientační barva značky pro monogramovou dlaždici — fallback,
 * když platforma nemá `logo` (provenience log v docs/11); `ink: 'dark'` =
 * tmavý text na světlé dlaždici (např. žlutá RB).
 */
export interface PlatformInfo {
  id: string;
  name: string;
  group: 'brokeri' | 'banky' | 'krypto';
  method: 'api' | 'file' | 'template';
  color: string;
  ink?: 'dark';
  monogram?: string;
  /** Kde v aplikaci platformy uživatel výpis stáhne (jedna věta, česky). */
  guide: string;
  /** Kotva karty napojení na stránce Zdroje dat (jen method 'api'). */
  connectAnchor?: string;
  /** Oficiální logo v /public/loga (nominativní užití); bez něj monogram. */
  logo?: { src: string; kind: 'icon' | 'wordmark' };
}

export const PLATFORMS: PlatformInfo[] = [
  // ── brokeři a platformy (řazeno dle počtu českých uživatelů — docs/11) ──
  {
    id: 'portu',
    logo: { src: '/loga/portu.png', kind: 'icon' },
    name: 'Portu',
    group: 'brokeri',
    method: 'file',
    color: '#00B67A',
    guide:
      'Peníze → Peněženka a transakce → filtry „Všechny Portu investice" + „Všechny transakce" → Stáhnout jako CSV.',
  },
  {
    id: 'xtb',
    logo: { src: '/loga/xtb.svg', kind: 'wordmark' },
    name: 'XTB',
    group: 'brokeri',
    method: 'file',
    color: '#E3001B',
    guide:
      'xStation → Historie účtu → export „Full report" (XLSX). XTB neexportuje ISIN ani měnu instrumentu — při prvním importu tě požádáme o doplnění a zapamatujeme si je.',
  },
  {
    id: 'trading212',
    logo: { src: '/loga/trading212.png', kind: 'icon' },
    name: 'Trading 212',
    group: 'brokeri',
    method: 'api',
    color: '#00A7E1',
    guide:
      'Živě přes API klíč jen pro čtení (Nastavení → API v aplikaci T212), nebo CSV export z History.',
    connectAnchor: '#trading212',
  },
  {
    id: 'patria',
    logo: { src: '/loga/patria.png', kind: 'wordmark' },
    name: 'Patria Finance',
    group: 'brokeri',
    method: 'template',
    color: '#003366',
    guide:
      'Transakce → Obchodní pokyny → ⋮ → Export → Excel; dividendy zvlášť ze záložky Cash flow. Import zatím přes univerzální šablonu.',
  },
  {
    id: 'degiro',
    logo: { src: '/loga/degiro.svg', kind: 'wordmark' },
    name: 'Degiro',
    group: 'brokeri',
    method: 'file',
    color: '#009FDF',
    guide:
      'Inbox → Přehled transakcí (Transactions.csv) a Výpis účtu (Account.csv) → Export CSV. Nahraj OBA soubory: obchody jsou v Transactions, dividendy a poplatky v Account.',
  },
  {
    id: 'etoro',
    logo: { src: '/loga/etoro.svg', kind: 'wordmark' },
    name: 'eToro',
    group: 'brokeri',
    method: 'file',
    color: '#6AAC0E',
    guide: 'Portfolio → History (ikona hodin) → ozubené kolo → Account Statement → Excel.',
  },
  {
    id: 'ibkr',
    logo: { src: '/loga/ibkr.svg', kind: 'wordmark' },
    name: 'Interactive Brokers',
    group: 'brokeri',
    method: 'api',
    color: '#D81222',
    guide:
      'Živě přes Flex Web Service (token + Query ID v Client Portalu), nebo stáhni Flex Query XML.',
    connectAnchor: '#ibkr',
  },
  {
    id: 'mt4',
    logo: { src: '/loga/mt4.png', kind: 'wordmark' },
    name: 'MetaTrader 4',
    group: 'brokeri',
    method: 'file',
    color: '#F2A900',
    ink: 'dark',
    monogram: 'M4',
    guide:
      'Terminál (Ctrl+T) → Account History → pravý klik → celá historie → Save as Report (.htm). Platí pro Purple Trading, InstaForex, Admirals i další MT4 brokery.',
  },
  {
    id: 'mt5',
    logo: { src: '/loga/mt5.png', kind: 'wordmark' },
    name: 'MetaTrader 5',
    group: 'brokeri',
    method: 'file',
    color: '#0088CC',
    monogram: 'M5',
    guide:
      'Toolbox (Ctrl+T) → History → pravý klik → Report → „Open XML (MS Office Excel)" nebo HTML.',
  },
  {
    id: 'lynx',
    logo: { src: '/loga/lynx.svg', kind: 'wordmark' },
    name: 'Lynx',
    group: 'brokeri',
    method: 'api',
    color: '#0FA396',
    guide:
      'Účet Lynx běží na infrastruktuře Interactive Brokers — Flex API i výpisy fungují stejně: Performance & Reports → Flex Queries.',
    connectAnchor: '#ibkr',
  },
  {
    id: 'saxo',
    logo: { src: '/loga/saxo.svg', kind: 'wordmark' },
    name: 'Saxo Bank',
    group: 'brokeri',
    method: 'file',
    color: '#14283C',
    guide:
      'SaxoTraderGO → profil → Transaction overview → Export → Excel. Před exportem si přepni jazyk platformy na angličtinu.',
  },
  {
    id: 'swissquote',
    logo: { src: '/loga/swissquote.svg', kind: 'wordmark' },
    name: 'Swissquote',
    group: 'brokeri',
    method: 'file',
    color: '#E2001A',
    guide: 'Trading → Transactions → filtr období → Export CSV.',
  },
  {
    id: 'tastytrade',
    logo: { src: '/loga/tastytrade.png', kind: 'wordmark' },
    name: 'Tastytrade',
    group: 'brokeri',
    method: 'file',
    color: '#E31837',
    guide:
      'History → Transactions → CSV (vpravo nahoře). Export umí max. rok — stáhni po letech, duplicity odfiltrujeme.',
  },
  {
    id: 'roboforex',
    logo: { src: '/loga/roboforex.svg', kind: 'wordmark' },
    name: 'RoboForex',
    group: 'brokeri',
    method: 'file',
    color: '#0056A8',
    guide:
      'Účty RoboForex běží na MT4/MT5 — ulož report přímo z platformy (viz MetaTrader 4/5 výše).',
  },
  {
    id: 'schwab',
    logo: { src: '/loga/schwab.svg', kind: 'icon' },
    name: 'Charles Schwab',
    group: 'brokeri',
    method: 'file',
    color: '#009DDC',
    guide:
      'Accounts → History → Export (CSV). Web dává max. 4 roky a 1 500 řádků na export — delší historii stáhni po částech.',
  },
  // ── banky a investiční společnosti (dtto) ──
  {
    id: 'conseq',
    logo: { src: '/loga/conseq.svg', kind: 'wordmark' },
    name: 'Conseq',
    group: 'banky',
    method: 'template',
    color: '#14477D',
    guide:
      'Můj Conseq → Přehled transakcí → Pohyby na majetkovém účtu → Exportovat do XLS. Import zatím přes univerzální šablonu.',
  },
  {
    id: 'csob',
    logo: { src: '/loga/csob.svg', kind: 'icon' },
    name: 'ČSOB Investice',
    group: 'banky',
    method: 'template',
    color: '#009EE0',
    guide:
      'Portál ČSOB Investice → Objednávky → Historie objednávek → filtr „Od začátku" → stažení XLS. Import zatím přes univerzální šablonu.',
  },
  {
    id: 'amundi',
    logo: { src: '/loga/amundi.svg', kind: 'wordmark' },
    name: 'Amundi (KB)',
    group: 'banky',
    method: 'template',
    color: '#003C71',
    guide:
      'Portál Moje Amundi → Transakce → Export (XLS). Import zatím přes univerzální šablonu.',
  },
  {
    id: 'fio',
    logo: { src: '/loga/fio.svg', kind: 'wordmark' },
    name: 'Fio e-Broker',
    group: 'banky',
    method: 'file',
    color: '#1C4E9D',
    guide:
      'e-Broker → Obchody → export CSV (kódování řešíme za tebe). Fio neexportuje ISIN — doplníš ho při prvním importu a zapamatujeme si ho.',
  },
  {
    id: 'raiffeisen',
    logo: { src: '/loga/raiffeisen.svg', kind: 'wordmark' },
    name: 'Raiffeisenbank',
    group: 'banky',
    method: 'template',
    color: '#FFD500',
    ink: 'dark',
    guide:
      'RBroker → Transakce → Transakce na majetkových účtech → stažení XLS. Import zatím přes univerzální šablonu (dividendy výpis neobsahuje).',
  },
  {
    id: 'jt',
    logo: { src: '/loga/jt.svg', kind: 'wordmark' },
    name: 'J&T Banka',
    group: 'banky',
    method: 'template',
    color: '#333333',
    monogram: 'J&T',
    guide:
      'Nové bankovnictví → účet Investice → Historie → Pohyby → Stáhnout vše (CSV). Import zatím přes univerzální šablonu (výpis bohužel neuvádí ISIN).',
  },
  {
    id: 'moventum',
    logo: { src: '/loga/moventum.png', kind: 'wordmark' },
    name: 'Moventum',
    group: 'banky',
    method: 'template',
    color: '#005EB8',
    guide:
      'MoventumOffice → Activity → zvol období → Export (případně požádej svého poradce). Import zatím přes univerzální šablonu.',
  },
  {
    id: 'eic',
    logo: { src: '/loga/eic.png', kind: 'wordmark' },
    name: 'EIC',
    group: 'banky',
    method: 'template',
    color: '#1D4F91',
    guide:
      'Online zóna EIC → pohled Transakce → Export; dividendy z pohledu Transfery a dividendy. Import zatím přes univerzální šablonu.',
  },
  {
    id: 'juliusbaer',
    logo: { src: '/loga/juliusbaer.svg', kind: 'wordmark' },
    name: 'Julius Bär',
    group: 'banky',
    method: 'template',
    color: '#14213D',
    guide: 'E-Services → Activity → Excel export. Import zatím přes univerzální šablonu.',
  },
  // ── krypto (dtto; Revolut = nejširší krypto expozice v ČR) ──
  {
    id: 'revolut',
    logo: { src: '/loga/revolut.svg', kind: 'icon' },
    name: 'Revolut',
    group: 'krypto',
    method: 'file',
    color: '#191C1F',
    guide:
      'Akcie: Invest → ⋯ → Statements → Account statement → Excel. Krypto: Crypto → Documents → Account statement. Nahraj oba.',
  },
  {
    id: 'anycoin',
    logo: { src: '/loga/anycoin.svg', kind: 'icon' },
    name: 'Anycoin',
    group: 'krypto',
    method: 'file',
    color: '#2F4DE0',
    guide: 'Profil → Transakce → Export (CSV, soubor orders.csv).',
  },
  {
    id: 'coinmate',
    logo: { src: '/loga/coinmate.svg', kind: 'wordmark' },
    name: 'Coinmate',
    group: 'krypto',
    method: 'file',
    color: '#F7931E',
    guide: 'Historie transakcí → Export (CSV — exportuje se vždy celá historie).',
  },
  {
    id: 'coinbase',
    logo: { src: '/loga/coinbase.svg', kind: 'icon' },
    name: 'Coinbase',
    group: 'krypto',
    method: 'file',
    color: '#0052FF',
    guide:
      'Manage account → Statements → Transactions → Generate custom statement (CSV, všechna aktiva, celá historie). Pozor: ne sekce „Taxes" — ta generuje jiný soubor.',
  },
  {
    id: 'kraken',
    logo: { src: '/loga/kraken.svg', kind: 'wordmark' },
    name: 'Kraken',
    group: 'krypto',
    method: 'file',
    color: '#7132F5',
    guide:
      'Profil → Documents → Exports → Create Export → typ „Ledgers" (CSV, celá historie). Trades.csv nenahrávej — Ledgers obsahuje vše.',
  },
];

/** Univerzální šablona jako poslední položka mimo skupiny (vždy funguje). */
export const UNIVERSAL_INFO = {
  name: 'Kterýkoli jiný broker',
  guide:
    'Stáhni si předvyplněnou univerzální CSV šablonu, přepiš ji daty z výpisu a nahraj — formát je popsaný přímo v souboru.',
} as const;

export const PLATFORM_GROUPS: { key: PlatformInfo['group']; label: string }[] = [
  { key: 'brokeri', label: 'Brokeři a platformy' },
  { key: 'banky', label: 'Banky a investiční společnosti' },
  { key: 'krypto', label: 'Krypto burzy a směnárny' },
];
