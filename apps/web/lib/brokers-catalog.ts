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
 * `color` je orientační barva značky pro monogramovou dlaždici (žádná cizí
 * loga nebundlujeme — CSP self + ochranné známky); `ink: 'dark'` = tmavý text
 * na světlé dlaždici (např. žlutá RB).
 */
export interface PlatformInfo {
  id: string;
  name: string;
  group: 'brokeri' | 'banky' | 'krypto';
  method: 'api' | 'file' | 'template';
  formats?: string;
  color: string;
  ink?: 'dark';
  monogram?: string;
  /** Kde v aplikaci platformy uživatel výpis stáhne (jedna věta, česky). */
  guide: string;
  /** Kotva karty napojení na stránce Zdroje dat (jen method 'api'). */
  connectAnchor?: string;
}

export const PLATFORMS: PlatformInfo[] = [
  // ── brokeři ────────────────────────────────────────────────────────────────
  {
    id: 'trading212',
    name: 'Trading 212',
    group: 'brokeri',
    method: 'api',
    formats: 'API · CSV',
    color: '#00A7E1',
    guide:
      'Živě přes API klíč jen pro čtení (Nastavení → API v aplikaci T212), nebo CSV export z History.',
    connectAnchor: '#trading212',
  },
  {
    id: 'ibkr',
    name: 'Interactive Brokers',
    group: 'brokeri',
    method: 'api',
    formats: 'Flex API · XML',
    color: '#D81222',
    guide:
      'Živě přes Flex Web Service (token + Query ID v Client Portalu), nebo stáhni Flex Query XML.',
    connectAnchor: '#ibkr',
  },
  {
    id: 'lynx',
    name: 'Lynx',
    group: 'brokeri',
    method: 'api',
    formats: 'Flex API · XML',
    color: '#0FA396',
    guide:
      'Účet Lynx běží na infrastruktuře Interactive Brokers — Flex API i výpisy fungují stejně: Performance & Reports → Flex Queries.',
    connectAnchor: '#ibkr',
  },
  {
    id: 'xtb',
    name: 'XTB',
    group: 'brokeri',
    method: 'file',
    formats: 'XLSX',
    color: '#E3001B',
    guide:
      'xStation → Historie účtu → export „Full report" (XLSX). XTB neexportuje ISIN ani měnu instrumentu — při prvním importu tě požádáme o doplnění a zapamatujeme si je.',
  },
  {
    id: 'degiro',
    name: 'Degiro',
    group: 'brokeri',
    method: 'file',
    formats: 'CSV',
    color: '#009FDF',
    guide:
      'Inbox → Přehled transakcí (Transactions.csv) a Výpis účtu (Account.csv) → Export CSV. Nahraj OBA soubory: obchody jsou v Transactions, dividendy a poplatky v Account.',
  },
  {
    id: 'etoro',
    name: 'eToro',
    group: 'brokeri',
    method: 'file',
    formats: 'XLSX',
    color: '#6AAC0E',
    guide: 'Portfolio → History (ikona hodin) → ozubené kolo → Account Statement → Excel.',
  },
  {
    id: 'schwab',
    name: 'Charles Schwab',
    group: 'brokeri',
    method: 'file',
    formats: 'CSV',
    color: '#009DDC',
    guide:
      'Accounts → History → Export (CSV). Web dává max. 4 roky a 1 500 řádků na export — delší historii stáhni po částech.',
  },
  {
    id: 'tastytrade',
    name: 'Tastytrade',
    group: 'brokeri',
    method: 'file',
    formats: 'CSV',
    color: '#E31837',
    guide:
      'History → Transactions → CSV (vpravo nahoře). Export umí max. rok — stáhni po letech, duplicity odfiltrujeme.',
  },
  {
    id: 'saxo',
    name: 'Saxo Bank',
    group: 'brokeri',
    method: 'file',
    formats: 'XLSX',
    color: '#14283C',
    guide:
      'SaxoTraderGO → profil → Transaction overview → Export → Excel. Před exportem si přepni jazyk platformy na angličtinu.',
  },
  {
    id: 'swissquote',
    name: 'Swissquote',
    group: 'brokeri',
    method: 'file',
    formats: 'CSV',
    color: '#E2001A',
    guide: 'Trading → Transactions → filtr období → Export CSV.',
  },
  {
    id: 'mt4',
    name: 'MetaTrader 4',
    group: 'brokeri',
    method: 'file',
    formats: 'HTML',
    color: '#F2A900',
    ink: 'dark',
    monogram: 'M4',
    guide:
      'Terminál (Ctrl+T) → Account History → pravý klik → celá historie → Save as Report (.htm). Platí pro Purple Trading, InstaForex, Admirals i další MT4 brokery.',
  },
  {
    id: 'mt5',
    name: 'MetaTrader 5',
    group: 'brokeri',
    method: 'file',
    formats: 'XLSX · HTML',
    color: '#0088CC',
    monogram: 'M5',
    guide:
      'Toolbox (Ctrl+T) → History → pravý klik → Report → „Open XML (MS Office Excel)" nebo HTML.',
  },
  {
    id: 'roboforex',
    name: 'RoboForex',
    group: 'brokeri',
    method: 'file',
    formats: 'MT4/MT5 report',
    color: '#0056A8',
    guide:
      'Účty RoboForex běží na MT4/MT5 — ulož report přímo z platformy (viz MetaTrader 4/5 výše).',
  },
  {
    id: 'portu',
    name: 'Portu',
    group: 'brokeri',
    method: 'file',
    formats: 'CSV',
    color: '#00B67A',
    guide:
      'Peníze → Peněženka a transakce → filtry „Všechny Portu investice" + „Všechny transakce" → Stáhnout jako CSV.',
  },
  {
    id: 'patria',
    name: 'Patria Finance',
    group: 'brokeri',
    method: 'template',
    formats: 'XLSX',
    color: '#003366',
    guide:
      'Transakce → Obchodní pokyny → ⋮ → Export → Excel; dividendy zvlášť ze záložky Cash flow. Import zatím přes univerzální šablonu.',
  },
  // ── banky a investiční společnosti ────────────────────────────────────────
  {
    id: 'fio',
    name: 'Fio e-Broker',
    group: 'banky',
    method: 'file',
    formats: 'CSV',
    color: '#1C4E9D',
    guide:
      'e-Broker → Obchody → export CSV (kódování řešíme za tebe). Fio neexportuje ISIN — doplníš ho při prvním importu a zapamatujeme si ho.',
  },
  {
    id: 'amundi',
    name: 'Amundi (KB)',
    group: 'banky',
    method: 'template',
    formats: 'XLS',
    color: '#003C71',
    guide:
      'Portál Moje Amundi → Transakce → Export (XLS). Import zatím přes univerzální šablonu.',
  },
  {
    id: 'conseq',
    name: 'Conseq',
    group: 'banky',
    method: 'template',
    formats: 'XLS',
    color: '#14477D',
    guide:
      'Můj Conseq → Přehled transakcí → Pohyby na majetkovém účtu → Exportovat do XLS. Import zatím přes univerzální šablonu.',
  },
  {
    id: 'csob',
    name: 'ČSOB Investice',
    group: 'banky',
    method: 'template',
    formats: 'XLS',
    color: '#009EE0',
    guide:
      'Portál ČSOB Investice → Objednávky → Historie objednávek → filtr „Od začátku" → stažení XLS. Import zatím přes univerzální šablonu.',
  },
  {
    id: 'jt',
    name: 'J&T Banka',
    group: 'banky',
    method: 'template',
    formats: 'CSV',
    color: '#333333',
    monogram: 'J&T',
    guide:
      'Nové bankovnictví → účet Investice → Historie → Pohyby → Stáhnout vše (CSV). Import zatím přes univerzální šablonu (výpis bohužel neuvádí ISIN).',
  },
  {
    id: 'juliusbaer',
    name: 'Julius Bär',
    group: 'banky',
    method: 'template',
    formats: 'XLS',
    color: '#14213D',
    guide: 'E-Services → Activity → Excel export. Import zatím přes univerzální šablonu.',
  },
  {
    id: 'moventum',
    name: 'Moventum',
    group: 'banky',
    method: 'template',
    formats: 'export',
    color: '#005EB8',
    guide:
      'MoventumOffice → Activity → zvol období → Export (případně požádej svého poradce). Import zatím přes univerzální šablonu.',
  },
  {
    id: 'raiffeisen',
    name: 'Raiffeisenbank',
    group: 'banky',
    method: 'template',
    formats: 'XLS',
    color: '#FFD500',
    ink: 'dark',
    guide:
      'RBroker → Transakce → Transakce na majetkových účtech → stažení XLS. Import zatím přes univerzální šablonu (dividendy výpis neobsahuje).',
  },
  {
    id: 'eic',
    name: 'EIC',
    group: 'banky',
    method: 'template',
    formats: 'export',
    color: '#1D4F91',
    guide:
      'Online zóna EIC → pohled Transakce → Export; dividendy z pohledu Transfery a dividendy. Import zatím přes univerzální šablonu.',
  },
  // ── krypto ────────────────────────────────────────────────────────────────
  {
    id: 'coinbase',
    name: 'Coinbase',
    group: 'krypto',
    method: 'file',
    formats: 'CSV',
    color: '#0052FF',
    guide:
      'Manage account → Statements → Transactions → Generate custom statement (CSV, všechna aktiva, celá historie). Pozor: ne sekce „Taxes" — ta generuje jiný soubor.',
  },
  {
    id: 'kraken',
    name: 'Kraken',
    group: 'krypto',
    method: 'file',
    formats: 'CSV',
    color: '#7132F5',
    guide:
      'Profil → Documents → Exports → Create Export → typ „Ledgers" (CSV, celá historie). Trades.csv nenahrávej — Ledgers obsahuje vše.',
  },
  {
    id: 'coinmate',
    name: 'Coinmate',
    group: 'krypto',
    method: 'file',
    formats: 'CSV',
    color: '#F7931E',
    guide: 'Historie transakcí → Export (CSV — exportuje se vždy celá historie).',
  },
  {
    id: 'anycoin',
    name: 'Anycoin',
    group: 'krypto',
    method: 'file',
    formats: 'CSV',
    color: '#2F4DE0',
    guide: 'Profil → Transakce → Export (CSV, soubor orders.csv).',
  },
  {
    id: 'revolut',
    name: 'Revolut',
    group: 'krypto',
    method: 'file',
    formats: 'CSV',
    color: '#191C1F',
    guide:
      'Akcie: Invest → ⋯ → Statements → Account statement → Excel. Krypto: Crypto → Documents → Account statement. Nahraj oba.',
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
