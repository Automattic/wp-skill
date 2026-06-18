import { chromium } from 'playwright';

// Full-page screenshot at a given viewport width.
//   node shot.mjs <url> <out.png> [width=1280] [height=900]
// Prefers Playwright's bundled Chromium; falls back to the system-installed Chrome when the
// bundled browser isn't installed (e.g. `npx playwright install` was blocked by a sandboxed
// network) — the same fallback the editor gate uses.
const [, , url, out, w = '1280', h = '900'] = process.argv;
if (!url || !out) { console.error('Usage: shot.mjs <url> <out.png> [width] [height]'); process.exit(2); }

async function launchBrowser() {
  try { return await chromium.launch(); }
  catch (e) {
    if (/Executable doesn't exist|playwright install/i.test(String(e))) return await chromium.launch({ channel: 'chrome' });
    throw e;
  }
}

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(800);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('shot ->', out);
