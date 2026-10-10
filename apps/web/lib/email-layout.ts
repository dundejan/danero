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

/**
 * Barvy z `globals.css` — v e-mailu musí být natvrdo, proměnné tam neplatí.
 * Světlé hodnoty jdou do inline stylů (ty přečte každý klient), tmavé do
 * `<style>` v hlavičce (viz `DARK_STYLES`).
 */
const COLORS = {
  /** Pozadí zprávy — `canvas`. */
  page: '#f5f5f7',
  /** Plocha s obsahem — `surface`. */
  surface: '#ffffff',
  /** Tichý panel s přehledem — `canvas`. */
  panel: '#f5f5f7',
  ink: '#1d1d1f',
  muted: '#6e6e73',
  /** Tečka značky — `accent`. */
  accent: '#0071e3',
  /** Výplň tlačítka — `accent-fill` (bílý text 4,7 : 1, v obou režimech stejná). */
  accentFill: '#0071e3',
} as const;

const DARK = {
  /** `surface` tmavého režimu. */
  page: '#000000',
  /** `canvas` — obsah je o stupeň světlejší než pozadí. */
  surface: '#1c1c1e',
  /** `control` — panel uvnitř obsahu ještě o stupeň. */
  panel: '#2c2c2e',
  ink: '#f5f5f7',
  muted: '#98989d',
  accent: '#0a84ff',
} as const;

/**
 * Tmavý režim. Inline styly nejdou přebít jinak než `!important`, proto
 * každý obarvený prvek nese i třídu. Klient, který `prefers-color-scheme` umí
 * (Apple Mail, Outlook.com), dostane plnohodnotnou tmavou podobu; klient,
 * který ho neumí (Gmail), `<style>` ignoruje a světlou zprávu si případně
 * ztmaví po svém — proto je světlá podoba poskládaná tak, aby převrácení
 * snesla: text na ploše, žádný text přes barevné pozadí kromě tlačítka, jehož
 * modrá s bílým písmem obstojí na světlém i tmavém.
 */
const DARK_STYLES = `:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){
.e-page{background:${DARK.page}!important}
.e-surface{background:${DARK.surface}!important}
.e-panel{background:${DARK.panel}!important}
.e-ink{color:${DARK.ink}!important}
.e-muted{color:${DARK.muted}!important}
.e-dot{background:${DARK.accent}!important}
.e-bar{background:${DARK.ink}!important}
}`;

const FONT =
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
function wrapText(text: string, width = 78): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line === '') line = word;
    else if (`${line} ${word}`.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

/** Textová verze — to, co uvidí čtečka i klient bez HTML. */
export function renderText(blocks: EmailBlock[], footer: string[]): string {
  const parts = blocks.map((block) => {
    switch (block.kind) {
      case 'p':
        return wrapText(block.text);
      case 'h':
        return `${block.text.toUpperCase()}\n${'—'.repeat(Math.min(block.text.length, 40))}`;
      case 'cta':
        return `${block.label}:\n${block.url}`;
      case 'rows':
        return block.rows.map(([label, value]) => `${label}: ${value}`).join('\n');
      case 'note':
        return wrapText(block.text);
    }
  });
  return [...parts, '', ...footer].join('\n\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * Značka Danero: akcentní tečka (nákup) + tmavá linie (dnešek) + slovo —
 * stejné tvary a barvy jako `components/logo.tsx`.
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
function brandMark(): string {
  const shape = (className: string, style: string) =>
    `<div class="${className}" style="${style};font-size:0;line-height:0">&nbsp;</div>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding:0;vertical-align:bottom">${shape('e-dot', `width:11px;height:11px;border-radius:50%;background:${COLORS.accent}`)}</td>
<td style="padding:0 0 0 1px;vertical-align:bottom">${shape('e-bar', `width:3px;height:18px;border-radius:2px;background:${COLORS.ink}`)}</td>
<td style="padding:0 0 0 8px;vertical-align:bottom"><span class="e-ink" style="font-size:19px;font-weight:600;letter-spacing:-.02em;line-height:1;color:${COLORS.ink};font-family:${FONT}">Danero</span></td>
</tr></table>`;
}

/** HTML verze. */
export function renderHtml(args: {
  title: string;
  preheader: string;
  blocks: EmailBlock[];
  footer: string[];
}): string {
  const body = args.blocks
    .map((block) => {
      switch (block.kind) {
        case 'p':
          return `<p class="e-ink" style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COLORS.ink}">${escape(block.text)}</p>`;
        case 'h':
          // váha místo verzálek — stejně jako nadpisy v aplikaci
          return `<p class="e-ink" style="margin:28px 0 8px;font-size:15px;line-height:1.4;font-weight:600;color:${COLORS.ink}">${escape(block.text)}</p>`;
        case 'cta':
          // tabulka místo <a> s paddingem: Outlook padding na odkazu ignoruje
          return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr><td style="border-radius:980px;background:${COLORS.accentFill}"><a href="${escape(block.url)}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:500;color:#ffffff;text-decoration:none;border-radius:980px">${escape(block.label)}</a></td></tr></table>
<p class="e-muted" style="margin:-12px 0 20px;font-size:12px;line-height:1.6;color:${COLORS.muted}">Kdyby tlačítko nefungovalo, zkopíruj si tuhle adresu:<br><span style="word-break:break-all">${escape(block.url)}</span></p>`;
        case 'rows':
          return `<table class="e-panel" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;background:${COLORS.panel};border-radius:12px">
${block.rows
  .map(
    ([label, value], i) =>
      `<tr><td class="e-muted" style="padding:${i === 0 ? '14px' : '10px'} 16px ${i === block.rows.length - 1 ? '14px' : '0'};font-size:14px;line-height:1.5;color:${COLORS.muted}">${escape(label)}</td><td class="e-ink" style="padding:${i === 0 ? '14px' : '10px'} 16px ${i === block.rows.length - 1 ? '14px' : '0'};font-size:14px;line-height:1.5;font-weight:500;text-align:right;color:${COLORS.ink}">${escape(value)}</td></tr>`,
  )
  .join('\n')}
</table>`;
        case 'note':
          return `<p class="e-muted" style="margin:0 0 14px;font-size:13px;line-height:1.55;color:${COLORS.muted}">${escape(block.text)}</p>`;
      }
    })
    .join('\n');

  const footer = args.footer
    .map(
      (line) =>
        `<p class="e-muted" style="margin:0 0 6px;font-size:12px;line-height:1.6;color:${COLORS.muted}">${escape(line)}</p>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escape(args.title)}</title>
<style>${DARK_STYLES}</style>
</head>
<body class="e-page" style="margin:0;padding:0;background:${COLORS.page};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(args.preheader)}</div>
<table class="e-page" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${COLORS.page}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px">
<tr><td style="padding:0 4px 20px">
${brandMark()}
</td></tr>
<tr><td class="e-surface" style="background:${COLORS.surface};border-radius:16px;padding:32px 28px 20px;font-family:${FONT}">
${body}
</td></tr>
<tr><td style="padding:20px 4px 0;font-family:${FONT}">
${footer}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
