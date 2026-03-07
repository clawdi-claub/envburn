#!/usr/bin/env node
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const screenshotsDir = '/home/openclaw/projects/envburn/web/screenshots';

const viewports = [
  { name: 'mobile-sm', width: 375, height: 812 },   // iPhone X
  { name: 'mobile-lg', width: 414, height: 896 },   // iPhone Max
  { name: 'tablet', width: 768, height: 1024 },     // iPad
  { name: 'desktop-sm', width: 1024, height: 768 },
  { name: 'desktop-md', width: 1440, height: 900 },
  { name: 'desktop-lg', width: 1920, height: 1080 },
];

const pages = [
  { name: 'index', url: 'http://localhost:8888/' },
  { name: 'secret', url: 'http://localhost:8888/secret.html#test' },
  { name: 'pricing', url: 'http://localhost:8888/pricing.html' },
];

async function captureScreenshots() {
  await fs.mkdir(screenshotsDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/usr/bin/google-chrome-stable',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  for (const pageConfig of pages) {
    console.log(`\n📄 Capturing: ${pageConfig.name}`);
    
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
      });
      
      const page = await context.newPage();
      
      try {
        await page.goto(pageConfig.url, { waitUntil: 'networkidle' });
        await page.waitForTimeout(500); // Small delay for any animations
        
        const filename = `${pageConfig.name}-${viewport.name}-${viewport.width}x${viewport.height}.png`;
        const filepath = path.join(screenshotsDir, filename);
        
        await page.screenshot({ 
          path: filepath, 
          fullPage: true 
        });
        
        console.log(`  ✅ ${viewport.name}: ${filepath}`);
        
        // Also capture just the viewport (not full page) for some viewports
        if (viewport.name.startsWith('mobile') || viewport.name === 'tablet') {
          const viewportFilename = `${pageConfig.name}-${viewport.name}-viewport.png`;
          const viewportPath = path.join(screenshotsDir, viewportFilename);
          await page.screenshot({ path: viewportPath });
          console.log(`  ✅ ${viewport.name} viewport: ${viewportPath}`);
        }
        
      } catch (err) {
        console.error(`  ❌ ${viewport.name}: ${err.message}`);
      }
      
      await context.close();
    }
  }

  await browser.close();
  console.log(`\n🎉 All screenshots saved to: ${screenshotsDir}`);
}

captureScreenshots().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
