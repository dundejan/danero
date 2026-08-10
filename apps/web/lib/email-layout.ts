/**
 * Skladba a vzhled odchozích e-mailů.
 *
 * Obsah se popisuje JEDNOU jako bloky a vykresluje se z něj text i HTML.
 * Kdyby se psaly zvlášť, rozejdou se — a rozejít se nesmí: textová verze je
 * to, co uvidí čtečka, spamový filtr a klient s vypnutým HTML, a u potvrzení
 * objednávky je to navíc plnění na trvalém nosiči (§ 1824a OZ).
 *
 * HTML je schválně staré a hloupé: tabulky, inline styly, žádné obrázky ani
 * externí zdroje. Gmail, Outlook ani Seznam nic modernějšího spolehlivě
 * nevykreslí a externí obrázek by navíc prozradil, kdy si člověk zprávu
 * otevřel.
 */

/** Barvy z `globals.css` — v e-mailu musí být natvrdo, proměnné tam neplatí. */
const BARVY = {
  pozadi: '#f6f5f1',
  plocha: '#ffffff',
  inkoust: '#171930',
  tlumeny: '#5a5d78',
  ruzova: '#d6336c',
  linka: '#e4e2da',
  zvyrazneni: '#faf7f8',
} as const;

const PISMO =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export type EmailBlock =
  /** Běžný odstavec. */
  | { kind: 'p'; text: string }
  /** Mezinadpis. */
  | { kind: 'h'; text: string }
  /** Hlavní tlačítko. V textové verzi se vypíše jako popisek a URL pod ním. */
  | { kind: 'cta'; label: string; url: string }
  /** Dvousloupcový přehled (co / za kolik). */
  | { kind: 'rows'; rows: [string, string][] }
  /** Vysvětlivka drobným písmem — právní poučení, které nemá překřičet obsah. */
  | { kind: 'note'; text: string };

const escape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Zalomení textové verze na 78 znaků. Delší řádky některé klienty zalomí samy
 * a ošklivě (uprostřed slova nebo za URL), takže si to raději uděláme sami —
 * ale URL se nikdy nezalamuje, jinak přestane být klikatelná.
 */
function zalom(text: string, sirka = 78): string {
  const slova = text.split(' ');
  const radky: string[] = [];
  let radek = '';
  for (const slovo of slova) {
    if (radek === '') radek = slovo;
    else if (`${radek} ${slovo}`.length <= sirka) radek += ` ${slovo}`;
    else {
      radky.push(radek);
      radek = slovo;
    }
  }
  if (radek) radky.push(radek);
  return radky.join('\n');
}

/** Textová verze — to, co uvidí čtečka i klient bez HTML. */
export function renderText(blocks: EmailBlock[], footer: string[]): string {
  const casti = blocks.map((block) => {
    switch (block.kind) {
      case 'p':
        return zalom(block.text);
      case 'h':
        return `${block.text.toUpperCase()}\n${'—'.repeat(Math.min(block.text.length, 40))}`;
      case 'cta':
        return `${block.label}:\n${block.url}`;
      case 'rows':
        return block.rows.map(([klic, hodnota]) => `${klic}: ${hodnota}`).join('\n');
      case 'note':
        return zalom(block.text);
    }
  });
  return [...casti, '', ...footer].join('\n\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * Značka Danero: růžová tečka (nákup) + tmavá linie (dnešek) + slovo.
 *
 * Skládá se z HTML, ne z obrázku — schválně. Obrázek by musel viset na
 * danero.cz (data: URI Gmail u `<img>` zahazuje), takže by prozrazoval, kdy
 * si příjemce zprávu otevřel, a půlka klientů ho stejně blokuje, dokud
 * uživatel neklikne na „zobrazit obrázky". Tvary jsou dost jednoduché na to,
 * aby je zvládl obyčejný `border-radius`.
 *
 * ⚠️ Outlook pro Windows (jádro Wordu) `border-radius` ignoruje — tečka tam
 * vyjde jako čtvereček a linie jako obdélník. Značka se tím nerozpadne, jen
 * zhranatí; alternativa (hostovaný PNG) by stála za to leda tehdy, kdyby se
 * ukázalo, že tenhle klient používá reálná část zákazníků.
 */
function znacka(): string {
  const tvar = (styl: string) => `<div style="${styl};font-size:0;line-height:0">&nbsp;</div>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding:0;vertical-align:bottom">${tvar(`width:11px;height:11px;border-radius:50%;background:${BARVY.ruzova}`)}</td>
<td style="padding:0 0 0 1px;vertical-align:bottom">${tvar(`width:3px;height:18px;border-radius:2px;background:${BARVY.inkoust}`)}</td>
<td style="padding:0 0 0 8px;vertical-align:bottom"><span style="font-size:19px;font-weight:700;letter-spacing:-.02em;line-height:1;color:${BARVY.inkoust};font-family:${PISMO}">Danero</span></td>
</tr></table>`;
}

/** HTML verze. */
export function renderHtml(args: {
  title: string;
  preheader: string;
  blocks: EmailBlock[];
  footer: string[];
}): string {
  const telo = args.blocks
    .map((block) => {
      switch (block.kind) {
        case 'p':
          return `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${BARVY.inkoust}">${escape(block.text)}</p>`;
        case 'h':
          return `<p style="margin:28px 0 12px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${BARVY.tlumeny}">${escape(block.text)}</p>`;
        case 'cta':
          // tabulka místo <a> s paddingem: Outlook padding na odkazu ignoruje
          return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr><td style="border-radius:8px;background:${BARVY.ruzova}"><a href="${escape(block.url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${escape(block.label)}</a></td></tr></table>
<p style="margin:-12px 0 20px;font-size:12px;line-height:1.6;color:${BARVY.tlumeny}">Kdyby tlačítko nefungovalo, zkopíruj si tuhle adresu:<br><span style="word-break:break-all;color:${BARVY.tlumeny}">${escape(block.url)}</span></p>`;
        case 'rows':
          return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;background:${BARVY.zvyrazneni};border:1px solid ${BARVY.linka};border-radius:10px">
${block.rows
  .map(
    ([klic, hodnota], i) =>
      `<tr><td style="padding:${i === 0 ? '14px' : '10px'} 18px ${i === block.rows.length - 1 ? '14px' : '0'};font-size:14px;line-height:1.5;color:${BARVY.tlumeny}">${escape(klic)}</td><td style="padding:${i === 0 ? '14px' : '10px'} 18px ${i === block.rows.length - 1 ? '14px' : '0'};font-size:14px;line-height:1.5;font-weight:600;text-align:right;color:${BARVY.inkoust}">${escape(hodnota)}</td></tr>`,
  )
  .join('\n')}
</table>`;
        case 'note':
          return `<p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:${BARVY.tlumeny}">${escape(block.text)}</p>`;
      }
    })
    .join('\n');

  const paticka = args.footer
    .map(
      (radek) =>
        `<p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:${BARVY.tlumeny}">${escape(radek)}</p>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escape(args.title)}</title>
</head>
<body style="margin:0;padding:0;background:${BARVY.pozadi};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(args.preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BARVY.pozadi}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px">
<tr><td style="padding:0 0 20px">
${znacka()}
</td></tr>
<tr><td style="background:${BARVY.plocha};border:1px solid ${BARVY.linka};border-radius:14px;padding:32px 28px;font-family:${PISMO}">
${telo}
</td></tr>
<tr><td style="padding:20px 4px 0;font-family:${PISMO}">
${paticka}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
