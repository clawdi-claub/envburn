import { chromium } from 'playwright';

const BASE = 'http://localhost:3847';
const OUT = './screenshots/redesign';

const viewports = [
  { name: 'mobile',  width: 375,  height: 812 },
  { name: 'tablet',  width: 768,  height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

const pages = [
  { name: 'index',   path: '/index.html' },
  { name: 'pricing', path: '/pricing.html' },
  { name: 'secret-reveal',  path: '/secret.html#testkey' },
  { name: 'secret-burned',  path: '/secret.html' },
];

const browser = await chromium.launch({ headless: true });

for (const vp of viewports) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });

  for (const pg of pages) {
    const page = await context.newPage();
    await page.goto(`${BASE}${pg.path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    
    const filename = `${OUT}/${pg.name}-${vp.name}.png`;
    await page.screenshot({ path: filename, fullPage: true });
    console.log(`✓ ${filename}`);
    await page.close();
  }

  await context.close();
}

await browser.close();
console.log('Done');
