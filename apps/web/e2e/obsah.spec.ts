import { expect, test } from '@playwright/test';

/** Veřejné obsahové stránky: Jak počítáme, Průvodce a Bezpečnost. */

test('/jak-pocitame a průvodce se vykreslí s obsahem', async ({ page }) => {
  await page.goto('/jak-pocitame');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Každé pravidlo má svůj paragraf',
  );
  await expect(page.getByRole('heading', { name: 'Sporné výklady přiznáváme' })).toBeVisible();

  await page.goto('/pruvodce');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('link', { name: /objem prodejů, ne zisk|Limit 100 000/ }).first().click();
  await page.waitForURL('**/pruvodce/limit-100-000-kc');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('100 000');
});

test('/bezpecnost je dostupná', async ({ page }) => {
  await page.goto('/bezpecnost');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Co se děje s tvými daty');
  await expect(page.getByText('API klíče jen pro čtení', { exact: true })).toBeVisible();
});

/**
 * Otevřený kód je trust signál — musí být z webu poznat, a podmínky musí
 * oddělovat službu na danero.cz od softwaru pod AGPL (self-hoster nemá nárok
 * na to, co slibujeme my).
 */
test('otevřený kód: odkaz v patičce, sekce na /o-projektu i /bezpecnost', async ({ page }) => {
  await page.goto('/');
  const odkaz = page.locator('footer').getByRole('link', { name: 'Zdrojový kód' });
  await expect(odkaz).toHaveAttribute('href', 'https://github.com/dundejan/danero');

  await page.goto('/o-projektu');
  await expect(page.getByRole('heading', { name: 'Danero si můžeš přečíst' })).toBeVisible();

  await page.goto('/bezpecnost');
  await expect(page.getByText('Nemusíš nám věřit — můžeš si to přečíst')).toBeVisible();
});

test('podmínky oddělují službu danero.cz od softwaru pod AGPL', async ({ page }) => {
  await page.goto('/podminky');
  // bez čísla článku: přečíslování (nový článek výš) není změna obsahu
  // a nesmí shodit test
  await expect(
    page.getByRole('heading', { name: /Na co se tyhle podmínky vztahují/ }),
  ).toBeVisible();
  await expect(page.getByText('Služba na danero.cz', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'GNU AGPL-3.0' })).toBeVisible();

  // vlastní instance nesmí spadat pod naše podmínky
  await expect(page.getByText('nevztahují', { exact: true })).toBeVisible();

  await page.goto('/soukromi');
  await expect(page.getByText('Do veřejných issue nikdy nevkládej výpis od brokera')).toBeVisible();
});

test('menu a patička: 4 položky menu, zbytek žije v patičce', async ({ page }) => {
  await page.goto('/');
  // lišta: Platformy · Kalkulačka · Proč zdarma · Časté otázky — právě tyhle
  // čtyři a v tomhle pořadí (vedle nich jen přihlášení a výzva do dema)
  const nav = page.getByRole('banner').getByRole('navigation', { name: 'Hlavní navigace' });
  await expect(nav.getByRole('link')).toHaveText([
    'Platformy',
    'Kalkulačka',
    'Proč zdarma',
    'Časté otázky',
    'Přihlásit se',
    'Vyzkoušet demo',
  ]);
  // „O projektu“ z lišty vypadlo — jediná garantovaná cesta je patička
  await expect(nav.getByRole('link', { name: 'O projektu' })).toHaveCount(0);
  const footer = page.locator('footer');
  await expect(footer.getByRole('link', { name: 'O projektu' })).toHaveAttribute(
    'href',
    '/o-projektu',
  );
  // výhrada je v patičce krátký odkaz na článek podmínek se závazným zněním
  await expect(footer.getByRole('link', { name: 'Není daňové poradenství' })).toHaveAttribute(
    'href',
    '/podminky#co-danero-je',
  );

  // kalkulačka je v liště i v patičce; patička vede na tutéž stránku
  await footer.getByRole('link', { name: 'Kalkulačka' }).click();
  await page.waitForURL('**/kalkulacka');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Musím kvůli investicím podat daňové přiznání?',
  );
  await expect(
    page
      .getByRole('banner')
      .getByRole('navigation', { name: 'Hlavní navigace' })
      .getByRole('link', { name: 'Kalkulačka' }),
  ).toHaveAttribute('aria-current', 'page');
});

test('/platformy a /cenik se vykreslí s obsahem', async ({ page }) => {
  await page.goto('/platformy');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('Trading 212').first()).toBeVisible();

  await page.goto('/cenik');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // žádný tarif a žádná cena, kterou by šlo zaplatit
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Danero je zdarma');
  await expect(
    page.getByText('Bez placené verze, bez zkušební doby a bez karty.'),
  ).toBeVisible();
  await expect(page.getByText(/\b[49]90\sKč/)).toHaveCount(0);
  // pět důvodů, proč je zdarma — každý s odkazem, kde si ho ověřit
  await expect(
    page.getByRole('list', { name: 'Proč je Danero zdarma' }).getByRole('listitem'),
  ).toHaveCount(5);
  // v jediném výčtu je i to, co dřív bylo placené — výčet funkcí je za
  // rozbalením, na stránce je vidět až po klepnutí
  const features = page.locator('details').filter({
    has: page.getByRole('heading', { name: 'Co všechno Danero umí' }),
  });
  await expect(features.getByText('Výpisy z více platforem najednou')).toBeHidden();
  await features.locator('summary').click();
  await expect(features.getByText('Výpisy z více platforem najednou')).toBeVisible();
  await expect(features.getByText(/XML pro elektronické podání/)).toBeVisible();
  // obyčejnými slovy: celé jméno brokera, žádná zkratka
  await expect(
    features.getByText('Živé napojení na Trading 212, Interactive Brokers a Lynx'),
  ).toBeVisible();
  // spojovník v „E-mailová“ je obyčejný — nezlomitelný (U+2011) nenašlo
  // hledání v prohlížeči a tenhle řetězec by na něm neprošel
  await expect(features.getByText('E-mailová upozornění na limity a termíny')).toBeVisible();
  // Sekce o příspěvku se vykreslí jen s nastaveným účtem nebo odkazem
  // (lib/support.ts). Tahle sada je nemá — a bez nich nesmí web o peníze žádat.
  await expect(page.getByRole('heading', { name: 'Příspěvek na provoz' })).toHaveCount(0);
  await expect(page.getByText(/přisp[ěí]v/i)).toHaveCount(0);
});

/**
 * Podmínky 3.0: služba je zdarma, takže z nich zmizelo všechno o objednávkách
 * a 14denním odstoupení (do 8. 10. 2026 tu stál test distančního balíčku).
 * Hlídá se podstata nového znění a to, že starší účty nepřišly o slíbených
 * 30 dní — předchozí znění pro ně platí dál a je na něj odkaz.
 */
test('podmínky: zdarma, bez objednávek, se starým zněním na dosah', async ({ page }) => {
  await page.goto('/podminky');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Podmínky užití');
  await expect(page.getByText('Danero je zdarma, a to celé')).toBeVisible();
  await expect(page.getByText(/není platbou za\s+službu/)).toBeVisible();
  // odejít jde kdykoli — lhůta na odstoupení by byla míň než tohle
  await expect(page.getByRole('heading', { name: /Jak dlouho to trvá a jak skončit/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Placené objednávky/ })).toHaveCount(0);

  // přechodné ustanovení: verze, datum a odkaz na předchozí znění
  await expect(page.getByText(/Verze\s3\.0\s·\súčinnost\sod\s8\.\sříjna\s2026/)).toBeVisible();
  const previousTerms = page.getByRole('link', { name: 'předchozí znění 2.4' });
  await expect(previousTerms).toHaveAttribute('href', /placene-tarify/);

  // kdo službu provozuje, musí být vidět i u bezplatné
  await expect(page.getByRole('heading', { name: /Provozovatel a kontakt/ })).toBeVisible();
});

/**
 * Hlídací e-maily i upozornění na časové testy jsou součást služby pro každého
 * — landing je nesmí podmiňovat tarifem, který už neexistuje.
 */
test('landing: hlídací e-maily nejsou podmíněné placeným tarifem', async ({ page }) => {
  await page.goto('/');
  // obojí říká třetí krok „Jak začít“ jednou větou; text prochází českou sazbou,
  // takže mezery mohou být pevné — spojovník v „E-mail“ je ale obyčejný
  const steps = page.getByRole('region', { name: 'Jak začít' });
  await expect(steps.getByText(/E-mail\spošle\spři\s60,\s85\sa\s100\s%\slimitu/)).toBeVisible();
  await expect(steps.getByText(/30\sa\s7\sdní\spřed\sosvobozením/)).toBeVisible();
  await expect(page.getByText(/celoročním hlídáním/)).toHaveCount(0);
  await expect(page.getByText(/tarif/i)).toHaveCount(0);
});

/**
 * FAQ říká, že je Danero zdarma celé (podmínky 3.0), a E-11: netvrdí, že
 * zkušební podatelnou proženeme každé vygenerované XML.
 */
test('FAQ: cena popsaná pravdivě, EPO taky', async ({ page }) => {
  await page.goto('/caste-otazky');

  const cena = page.locator('details', { hasText: 'Kolik Danero stojí?' });
  await cena.locator('summary').click();
  await expect(cena.getByText('Danero je zdarma celé')).toBeVisible();
  // příspěvek nesmí vypadat jako cena za něco
  await expect(cena.getByText('nic se tím neodemyká')).toBeVisible();

  const epo = page.locator('details', { hasText: 'ověřeno zkušební podatelnou EPO' });
  await epo.locator('summary').click();
  // Hlídá se PODSTATA, ne formulace: posíláme vzorky (ne uživatelovo XML)
  // a děláme to automaticky. Doslovné znění se mění — dřív tenhle test spadl
  // jen kvůli přeformulování věty, přestože tvrzení zůstalo pravdivé.
  await expect(epo.getByText('Posíláme jí vzorová podání')).toBeVisible();
  await expect(epo.getByText('automaticky při každé změně kódu')).toBeVisible();
  // nesmí se vrátit slib, že se ověřuje KAŽDÉ uživatelovo XML — to není pravda
  await expect(page.getByText('Každou vygenerovanou písemnost XML tam ověřujeme')).toHaveCount(0);
  await expect(epo.getByText('Tvoje konkrétní XML tam neposíláme')).toBeVisible();
});
