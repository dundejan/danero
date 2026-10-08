/**
 * Katalog podporovaných platforem — jediný zdroj pravdy pro stránku Zdroje dat
 * i landing. Nový formát se přidává podle docs/06-import.md.
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
 *
 * Návody (`guide`) jsou ověřené proti nápovědám platforem 12. 8. 2026 — každý
 * z nich je cesta, kterou uživatel proklikává, takže přejmenovaná položka menu
 * je stejná vada jako rozbitý parser. Když platforma rozhraní změní, oprav to
 * TADY (texty se nikde jinde neopisují).
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

/** Počty platforem dle metody — jediný zdroj pro texty „ze 17 platforem…“
    (natvrdo zapsané počty při přidání parseru zdriftují). Doplněno níže pod PLATFORMS. */
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
      'Peníze → Peněženka a transakce → „Vaše Portu investice“ nastav na Všechny a „Časový horizont“ na Všechny transakce (zaškrtnutá políčka Vklady/Výběry/Nákupy/Prodeje/… nech být) → Stáhnout jako CSV. Dluhopisy z Portu Opportunity mají vlastní výpis (Transakce a peníze → Pokyny) — ten zatím číst neumíme: nahraj ho stejně, my se na formát podíváme a ozveme se, a než ho doplníme, zapiš dluhopisy univerzální šablonou.',
  },
  {
    id: 'xtb',
    logo: { src: '/loga/xtb.svg', kind: 'wordmark' },
    name: 'XTB',
    group: 'brokeri',
    method: 'file',
    color: '#E3001B',
    guide:
      'xStation → Historie → tlačítko „Export (new)“ → Nový report → období a účty → Vygenerovat → Stáhnout: přijde ZIP, rozbal ho a nahraj XLSX zevnitř (starší tlačítko „Export“ → Full report funguje taky). Období nastav od založení účtu — u letošních prodejů potřebujeme znát i dřívější nákupy. XTB neexportuje ISIN ani měnu instrumentu — při prvním importu tě požádáme o doplnění a zapamatujeme si je.',
  },
  {
    id: 'trading212',
    logo: { src: '/loga/trading212.png', kind: 'icon' },
    name: 'Trading 212',
    group: 'brokeri',
    method: 'api',
    color: '#00A7E1',
    guide:
      'Živě přes API klíč jen pro čtení (Nastavení → API v aplikaci T212), nebo CSV export z History — ten umí max. rok, takže starší historii stáhni po letech (duplicity odfiltrujeme).',
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
      'WebTrader → Transakce → záložka Obchodní pokyny → ⋮ vpravo nahoře → Export → Excel; dividendy stáhni stejně ze záložky Cash flow (ve starší aplikaci Historie aktivity → Obchodní pokyny / Cash Flow). Import zatím přes univerzální šablonu; splity a spin-offy výpis neobsahuje, ty doplň ručně.',
  },
  {
    id: 'degiro',
    logo: { src: '/loga/degiro.svg', kind: 'wordmark' },
    name: 'Degiro',
    group: 'brokeri',
    method: 'file',
    color: '#009FDF',
    guide:
      'Inbox → „Transakce“ (Transactions.csv) a „Přehled účtu“ (Account.csv) → Export CSV. Nahraj OBA soubory: obchody jsou v Transakcích, dividendy a poplatky v Přehledu účtu. Výpis čteme v češtině, angličtině, nizozemštině, němčině i francouzštině.',
  },
  {
    id: 'etoro',
    logo: { src: '/loga/etoro.svg', kind: 'wordmark' },
    name: 'eToro',
    group: 'brokeri',
    method: 'file',
    color: '#6AAC0E',
    guide:
      'Portfolio → History (ikona hodin) → ozubené kolo vpravo nahoře → Account Statement → období → Create → stáhni jako XLS.',
  },
  {
    id: 'ibkr',
    logo: { src: '/loga/ibkr.svg', kind: 'wordmark' },
    name: 'Interactive Brokers',
    group: 'brokeri',
    method: 'api',
    color: '#D81222',
    guide:
      'Živě přes Flex Web Service: Client Portal → Performance & Reports → Flex Queries (token se zapíná tamtéž ve Flex Web Service Configuration). Nebo si stejnou Flex Query stáhni jako XML — jeden běh pokrývá max. rok, starší historii stahuj po letech.',
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
      'Terminál (Ctrl+T) → Account History / Historie účtu → pravý klik → All History (celá historie) → Save as Report (.htm). V témže menu měj zapnuté sloupce Commissions a Taxes, jinak v reportu nebudou. Platí pro Purple Trading, InstaForex, Admirals i další MT4 brokery.',
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
      'Toolbox (Ctrl+T) → History / Historie → pravý klik → celá historie → Report → „Open XML“ (v novějších buildech „Open XML (MS Office Excel)“) nebo HTML. Volbu „XML“ bez Open nepoužívej — tu číst neumíme.',
  },
  {
    id: 'lynx',
    logo: { src: '/loga/lynx.svg', kind: 'wordmark' },
    name: 'Lynx',
    group: 'brokeri',
    method: 'api',
    color: '#0FA396',
    guide:
      'Účet Lynx běží na infrastruktuře Interactive Brokers — Flex API i výpisy fungují stejně: Client Portal → Performance & Reports → Flex Queries.',
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
      'SaxoTrader (dřív SaxoTraderGO) → Portfolio → Transactions → období → Export → Excel. Před exportem si přepni jazyk platformy na angličtinu.',
  },
  {
    id: 'swissquote',
    logo: { src: '/loga/swissquote.svg', kind: 'wordmark' },
    name: 'Swissquote',
    group: 'brokeri',
    method: 'file',
    color: '#E2001A',
    guide:
      'eTrading → Portfolio → Transactions → nastav období → šipka u pravého okraje → export CSV. Hlavičku čteme anglicky i německy.',
  },
  {
    id: 'tastytrade',
    logo: { src: '/loga/tastytrade.png', kind: 'wordmark' },
    name: 'Tastytrade',
    group: 'brokeri',
    method: 'file',
    color: '#E31837',
    guide:
      'History → Transactions → nastav období → ikona CSV vpravo nahoře. Tabulka se donačítá po ~200 řádcích, takže před stažením sjeď úplně dolů — jinak bude export neúplný a nikde se to nedozvíš.',
  },
  {
    id: 'roboforex',
    logo: { src: '/loga/roboforex.svg', kind: 'wordmark' },
    name: 'RoboForex',
    group: 'brokeri',
    method: 'file',
    color: '#0056A8',
    guide:
      'Účty na MT4/MT5: ulož report přímo z platformy (viz MetaTrader 4/5 výše). Účty R StocksTrader/cTrader report z MetaTraderu nemají — z klientské zóny (Trading account → Account history) stáhni Excel a přepiš ho do univerzální šablony.',
  },
  {
    id: 'schwab',
    logo: { src: '/loga/schwab.svg', kind: 'icon' },
    name: 'Charles Schwab',
    group: 'brokeri',
    method: 'file',
    color: '#009DDC',
    guide:
      'Accounts → Transaction History → období (jde i „All“) → Export vpravo nahoře → v dialogu zvol CSV. Web drží jen 4 roky historie a u velkých objemů vrací prázdný soubor — pak stahuj po čtvrtletích; starší roky jsou ve Statements & Tax Forms. Čteme Transaction History z brokerage účtu; výpis z účtu Equity Awards (akcie od zaměstnavatele) zatím ne — připsané akcie doplň univerzální šablonou.',
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
      'Můj Conseq → otevři smlouvu → Přehled transakcí → Pohyby na majetkovém účtu → Exportovat do XLS. Import zatím přes univerzální šablonu.',
  },
  {
    id: 'csob',
    logo: { src: '/loga/csob.svg', kind: 'icon' },
    name: 'ČSOB Investice',
    group: 'banky',
    method: 'template',
    color: '#009EE0',
    guide:
      'Portál ČSOB Investice → Objednávky → Historie objednávek → Filtrovat → Období „Od začátku“ (jinak ukáže jen rok) → Zobrazit → XLS. Dividendy, kupóny a poplatky jsou zvlášť v Objednávky → Peněžní toky. Import zatím přes univerzální šablonu.',
  },
  {
    id: 'amundi',
    logo: { src: '/loga/amundi.svg', kind: 'wordmark' },
    name: 'Amundi (KB)',
    group: 'banky',
    method: 'template',
    color: '#003C71',
    guide:
      'Portál Moje Amundi → Můj přehled → Transakce → Export (vpravo nahoře). Import zatím přes univerzální šablonu.',
  },
  {
    id: 'fio',
    logo: { src: '/loga/fio.svg', kind: 'wordmark' },
    name: 'Fio e-Broker',
    group: 'banky',
    method: 'file',
    color: '#1C4E9D',
    guide:
      'e-Broker → Obchody → nastav období → Zobraz → export CSV (kódování řešíme za tebe). Fio zobrazuje max. rok, takže starší historii stáhni po letech. Sloupce si volíš sám v !Nastavení — nech tam aspoň Datum obchodu, Směr, Symbol, Cena, Počet, Měna, Objem a Poplatky. ISIN Fio neexportuje: doplníš ho při prvním importu a zapamatujeme si ho.',
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
      'RBroker → Transakce → Transakce na majetkových účtech → Filtrovat → stažení XLS. Import zatím přes univerzální šablonu (dividendy jsou jen v pohledu na hotovostní účty).',
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
      'Nové bankovnictví → Přehled → Historie u investičního účtu → Pohyby → Stáhnout vše (CSV). Import zatím přes univerzální šablonu — výpis neuvádí ISIN ani symbol, takže instrumenty i dividendy dopiš do šablony ručně.',
  },
  {
    id: 'moventum',
    logo: { src: '/loga/moventum.png', kind: 'wordmark' },
    name: 'Moventum',
    group: 'banky',
    method: 'template',
    color: '#005EB8',
    guide:
      'MoventumOffice (platforma pro poradce) → Activity → období → Export. Jako klient máš Moventum AccountView, kde se pohyby tisknou do Excelu po 12 měsících — nebo si výpis vyžádej u svého poradce. Import zatím přes univerzální šablonu.',
  },
  {
    id: 'eic',
    logo: { src: '/loga/eic.png', kind: 'wordmark' },
    name: 'EIC',
    group: 'banky',
    method: 'template',
    color: '#1D4F91',
    guide:
      'Online aplikace EIC (online.eic.eu) → pohled Transakce → Export; dividendy z pohledu Transfery a dividendy. Import zatím přes univerzální šablonu.',
  },
  {
    id: 'juliusbaer',
    logo: { src: '/loga/juliusbaer.svg', kind: 'wordmark' },
    name: 'Julius Bär',
    group: 'banky',
    method: 'template',
    color: '#14213D',
    guide:
      'E-Services → Activity → Activity Details (ne Activity Summary) → Excel export. Import zatím přes univerzální šablonu.',
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
      'Akcie: Invest → More (⋯) → Documents → Stocks → Account statement → formát Excel a celé období. Krypto: Accounts → Documents & statements → Crypto → Account statement. Nahraj oba — přečteme CSV i sešit .xlsx. „Profit and loss statement“ z téže nabídky nepoužívej: ten nečteme, patří sem „Account statement“.',
  },
  {
    id: 'anycoin',
    logo: { src: '/loga/anycoin.svg', kind: 'icon' },
    name: 'Anycoin',
    group: 'krypto',
    method: 'file',
    color: '#00BBE0',
    guide:
      'Profil (vpravo nahoře) → Nastavení → Transakce → ve filtru měny zvol všechny měny → Export (CSV). Export jen jedné měny nepřečteme: každý obchod má v souboru dva řádky, platbu a připsání, každý v jiné měně. Sekci „Daně“ nepoužívej — generuje jiný soubor po jednotlivých letech.',
  },
  {
    id: 'coinmate',
    logo: { src: '/loga/coinmate.svg', kind: 'wordmark' },
    name: 'Coinmate',
    group: 'krypto',
    method: 'file',
    color: '#F7931E',
    guide:
      'Prostředky → Historie → Export (CSV — exportuje se vždy celá historie, období vybrat nejde). Čteme českou i anglickou hlavičku.',
  },
  {
    id: 'coinbase',
    logo: { src: '/loga/coinbase.svg', kind: 'wordmark' },
    name: 'Coinbase',
    group: 'krypto',
    method: 'file',
    color: '#0052FF',
    guide:
      'Manage account → Statements → záložka Transactions → Generate custom statement → přepni na All assets, All transactions a celé období (výchozí je jen část!) → formát CSV → Generate. Pozor: ne sekce „Taxes“ — ta generuje jiný soubor.',
  },
  {
    id: 'kraken',
    logo: { src: '/loga/kraken.svg', kind: 'wordmark' },
    name: 'Kraken',
    group: 'krypto',
    method: 'file',
    color: '#7132F5',
    guide:
      'Profil → Documents → Exports → Create Export → typ „Ledgers“, produkt Spot (a Futures, pokud je obchoduješ), pole nech všechna, období nastav od založení účtu a jako formát zvol CSV (ne PDF). Export se chvíli generuje (většinou minuty, podle Krakenu to ale může trvat i dny) a e-mail o něm nepřijde: stáhneš ho ze seznamu exportů na téže stránce. Pokud přijde ZIP, rozbal ho a nahraj ledgers.csv. Trades.csv nenahrávej, Ledgers obsahuje vše.',
  },
];

/** Univerzální šablona jako poslední položka mimo skupiny (vždy funguje). */
export const UNIVERSAL_INFO = {
  name: 'Kterýkoli jiný broker',
  guide:
    'Stáhni si předvyplněnou univerzální šablonu (soubor CSV, otevřeš ho v Excelu), ukázkové řádky přepiš daty ze svého výpisu a soubor nahraj. Každý ukázkový řádek má v posledním sloupci poznámku, k čemu slouží.',
} as const;

/**
 * Pravidla pro vyplnění šablony — stojí tam, kde se šablona stahuje (L2c-02).
 * Dřív katalog sliboval, že formát popisuje sám soubor, a v něm byly jen
 * ukázkové řádky: tvar data, desetinný oddělovač a povolené hodnoty se
 * uživatel dozvěděl až z chyb po nahrání.
 *
 * Musí sedět na parser (`packages/importers/src/universal/csv.ts`): výčet typů
 * i druhů aktiv a oba příklady hlídá `test/platformy-katalog.test.ts`.
 */
export const TEMPLATE_RULES: { label: string; text: string }[] = [
  {
    label: 'Datum',
    text: 'piš jako 2026-03-05 (rok-měsíc-den) nebo česky 5.3.2026. Když ho Excel sám přepíše do českého tvaru, nevadí to. Lomítka (5/3/2026) nebereme — nepozná se z nich, co je den a co měsíc.',
  },
  {
    label: 'Čísla',
    text: 'jen číslo, bez značky měny a bez oddělovače tisíců. Desetinná čárka i tečka fungují stejně (1250,50 nebo 1250.50). Měna má vlastní sloupec a píše se třípísmenným kódem: CZK, USD, EUR.',
  },
  {
    label: 'Druh pohybu (sloupec type)',
    text: 'BUY nákup, SELL prodej, DIVIDEND dividenda, INTEREST úrok, FEE poplatek, DEPOSIT vklad peněz, WITHDRAWAL výběr peněz, TRANSFER_IN a TRANSFER_OUT převod cenných papírů od jiného brokera a k němu, CORPORATE_ACTION změna u titulu, kterou neprovádíš ty — o kterou jde, říká sloupec subtype: SPLIT (štěpení akcií), ISIN_CHANGE (nový ISIN), MERGER (fúze), SPINOFF (oddělení části firmy), DELISTING (stažení z burzy).',
  },
  {
    label: 'Druh aktiva (sloupec asset_class)',
    text: 'STOCK akcie — platí i pro prázdné pole, ETF fond obchodovaný na burze, BOND dluhopis, CRYPTO kryptoměna, DERIVATIVE opce, futures a CFD, OTHER cokoli jiného. U krypta a derivátů ho vyplň vždy, daní se jinak než akcie.',
  },
];

export const PLATFORM_GROUPS: { key: PlatformInfo['group']; label: string }[] = [
  { key: 'brokeri', label: 'Brokeři a platformy' },
  { key: 'banky', label: 'Banky a investiční společnosti' },
  { key: 'krypto', label: 'Krypto burzy a směnárny' },
];

/** Odvozené počty pro marketingové texty — viz komentář u PLATFORMS. */
export const PLATFORM_COUNTS = {
  api: PLATFORMS.filter((p) => p.method === 'api').length,
  file: PLATFORMS.filter((p) => p.method === 'file').length,
  template: PLATFORMS.filter((p) => p.method === 'template').length,
} as const;
