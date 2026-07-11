// Screenshoty všech veřejných stránek pro UI/UX panel (buffery → zápis až po
// zavření browseru, mimo public/ — žádný dev reload)
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const OUT = process.env.OUT!;
const PAGES: [name: string, path: string][] = [
  ['landing', '/'],
  ['kalkulacka', '/kalkulacka'],
  ['platformy', '/platformy'],
  ['cenik', '/cenik'],
  ['podminky', '/podminky'],
];

const run = async () => {
  const browser = await chromium.launch();
  const shots: [string, Buffer][] = [];
  for (const scheme of ['light', 'dark'] as const) {
    for (const [device, viewport] of [
      ['desktop', { width: 1440, height: 1000 }],
      ['mobile', { width: 390, height: 844 }],
    ] as const) {
      const page = await browser.newPage({ viewport, colorScheme: scheme });
      for (const [name, path] of PAGES) {
        await page.goto(`http://localhost:3000${path}`, { waitUntil: 'networkidle' });
        shots.push([`${name}-${device}-${scheme}.png`, await page.screenshot({ fullPage: true })]);
      }
      // mobilní menu otevřené (jen light)
      if (scheme === 'light' && device === 'mobile') {
        await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
        await page.getByRole('button', { name: 'Otevřít menu' }).click();
        shots.push(['menu-mobile-light.png', await page.screenshot()]);
      }
      await page.close();
    }
  }
  await browser.close();
  for (const [name, buf] of shots) writeFileSync(`${OUT}/${name}`, buf as unknown as Uint8Array);
  console.log(`OK ${shots.length} screenshotů`);
};
run();
